package com.pstu.backend.service;

import com.pstu.backend.dto.AllocationRequest;
import com.pstu.backend.dto.AllocationResponse;
import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.entity.Resource;
import com.pstu.backend.entity.ResourceAllocation;
import com.pstu.backend.enums.AllocationStatus;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.enums.ResourceStatus;
import com.pstu.backend.enums.ResourceType;
import com.pstu.backend.exception.InvalidStateTransitionException;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.AllocationRepository;
import com.pstu.backend.repository.IncidentRepository;
import com.pstu.backend.repository.ResourceRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Dispatch: the guards that stop a unit being double-booked or a closed incident
 * being re-opened, and the capacity accounting that must survive every terminal path.
 *
 * <p>The subtle one is the incident advance: {@code moveIncident} asks the lifecycle
 * graph <em>before</em> calling {@code transition}, because a thrown exception from a
 * participating {@code @Transactional} bean would poison the shared transaction and
 * discard the allocation (see {@code AllocationIncidentTransitionTest}). These tests
 * assert the effect that fix protects.
 */
class AllocationServiceTest {

    private AllocationRepository allocationRepository;
    private IncidentRepository incidentRepository;
    private ResourceRepository resourceRepository;
    private IncidentLifecycleService lifecycleService;
    private EventPublisher eventPublisher;
    private AllocationService service;

    @BeforeEach
    void setUp() {
        allocationRepository = mock(AllocationRepository.class);
        incidentRepository = mock(IncidentRepository.class);
        resourceRepository = mock(ResourceRepository.class);
        lifecycleService = mock(IncidentLifecycleService.class);
        eventPublisher = mock(EventPublisher.class);

        when(allocationRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(resourceRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service = new AllocationService(allocationRepository, incidentRepository,
                resourceRepository, lifecycleService, eventPublisher);
    }

    private static EmergencyIncident incident(IncidentStatus status) {
        return EmergencyIncident.builder()
                .id(100L).incidentId("inc-100")
                .severity(IncidentSeverity.CRITICAL)
                .status(status).priorityScore(90)
                .affectedPeople(5).timeSensitivityMinutes(5)
                .build();
    }

    private static Resource unit(long id, int load, int capacity, boolean available) {
        return Resource.builder()
                .id(id).resourceId("AMB-" + id)
                .type(ResourceType.AMBULANCE)
                .latitude(23.8).longitude(90.4)
                .status(ResourceStatus.AVAILABLE).capacity(capacity)
                .currentLoad(load).available(available)
                .build();
    }

    private static AllocationRequest request() {
        return AllocationRequest.builder()
                .incidentId("inc-100").resourceId("AMB-1")
                .estimatedTravelTimeMinutes(9)
                .estimatedResolutionTimeMinutes(30)
                .decisionRationale("closest unit")
                .build();
    }

    @Test
    void dispatchRecordsTheAllocationConsumesCapacityAndAdvancesTheIncident() {
        EmergencyIncident incident = incident(IncidentStatus.PRIORITIZED);
        Resource resource = unit(1L, 0, 2, true);
        when(incidentRepository.findByIncidentId("inc-100")).thenReturn(Optional.of(incident));
        when(resourceRepository.findByResourceId("AMB-1")).thenReturn(Optional.of(resource));

        AllocationResponse response = service.allocateResource(request());

        assertThat(response.getStatus()).isEqualTo(AllocationStatus.PENDING);
        assertThat(response.getIncidentId()).isEqualTo("inc-100");
        // One unit consumed, still under capacity, so the unit stays available.
        assertThat(resource.getCurrentLoad()).isEqualTo(1);
        assertThat(resource.getAvailable()).isTrue();
        verify(lifecycleService).transition("inc-100", IncidentStatus.ALLOCATING,
                "unit AMB-1 dispatched");
    }

    @Test
    void fillingAUnitToCapacityTakesItOutOfThePool() {
        when(incidentRepository.findByIncidentId("inc-100"))
                .thenReturn(Optional.of(incident(IncidentStatus.PRIORITIZED)));
        Resource resource = unit(1L, 1, 2, true);
        when(resourceRepository.findByResourceId("AMB-1")).thenReturn(Optional.of(resource));

        service.allocateResource(request());

        assertThat(resource.getCurrentLoad()).isEqualTo(2);
        assertThat(resource.getAvailable()).isFalse();
    }

    @Test
    void aTerminalIncidentRejectsNewUnits() {
        when(incidentRepository.findByIncidentId("inc-100"))
                .thenReturn(Optional.of(incident(IncidentStatus.RESOLVED)));

        assertThatThrownBy(() -> service.allocateResource(request()))
                .isInstanceOf(InvalidStateTransitionException.class)
                .hasMessageContaining("Terminal incidents cannot receive new allocations");
    }

    @Test
    void anUnavailableUnitIsRejected() {
        when(incidentRepository.findByIncidentId("inc-100"))
                .thenReturn(Optional.of(incident(IncidentStatus.PRIORITIZED)));
        when(resourceRepository.findByResourceId("AMB-1"))
                .thenReturn(Optional.of(unit(1L, 0, 2, false)));

        assertThatThrownBy(() -> service.allocateResource(request()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("not available");
    }

    @Test
    void aUnitAtFullCapacityIsRejected() {
        when(incidentRepository.findByIncidentId("inc-100"))
                .thenReturn(Optional.of(incident(IncidentStatus.PRIORITIZED)));
        when(resourceRepository.findByResourceId("AMB-1"))
                .thenReturn(Optional.of(unit(1L, 2, 2, true)));

        assertThatThrownBy(() -> service.allocateResource(request()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("full capacity");
    }

    @Test
    void aSecondDispatchDoesNotAttemptAnIllegalIncidentTransition() {
        // The incident is already ALLOCATING; asking the graph first means transition()
        // is never called, so the transaction stays committable.
        when(incidentRepository.findByIncidentId("inc-100"))
                .thenReturn(Optional.of(incident(IncidentStatus.ALLOCATING)));
        when(resourceRepository.findByResourceId("AMB-1"))
                .thenReturn(Optional.of(unit(2L, 0, 2, true)));

        service.allocateResource(request());

        verify(lifecycleService, never()).transition(any(), any(), any());
    }

    private ResourceAllocation allocation(AllocationStatus status, Resource resource) {
        return ResourceAllocation.builder()
                .id(5L)
                .incident(incident(IncidentStatus.IN_PROGRESS))
                .resource(resource)
                .status(status)
                .estimatedTravelTimeMinutes(9)
                .estimatedResolutionTimeMinutes(30)
                .build();
    }

    @Test
    void resendingTheSameStatusIsAnIdempotentNoOp() {
        Resource resource = unit(1L, 1, 2, true);
        ResourceAllocation existing = allocation(AllocationStatus.EN_ROUTE, resource);
        when(allocationRepository.findById(5L)).thenReturn(Optional.of(existing));

        service.updateAllocationStatus(5L, AllocationStatus.EN_ROUTE);

        // No second capacity release, no duplicate event.
        assertThat(resource.getCurrentLoad()).isEqualTo(1);
        verify(allocationRepository, never()).save(any());
        verify(eventPublisher, never()).publish(any());
    }

    @Test
    void completingAnAllocationReleasesTheUnitAndResolvesTheIncident() {
        Resource resource = unit(1L, 1, 2, false);
        ResourceAllocation existing = allocation(AllocationStatus.EN_ROUTE, resource);
        when(allocationRepository.findById(5L)).thenReturn(Optional.of(existing));
        // No other live allocations on the incident, so it resolves.
        when(allocationRepository.findByIncidentIdOrderByAllocatedAtAsc(100L)).thenReturn(List.of());

        service.updateAllocationStatus(5L, AllocationStatus.COMPLETED);

        assertThat(existing.getStatus()).isEqualTo(AllocationStatus.COMPLETED);
        assertThat(existing.getCompletedAt()).isNotNull();
        assertThat(resource.getCurrentLoad()).isZero();
        assertThat(resource.getAvailable()).isTrue();
        verify(lifecycleService).transition("inc-100", IncidentStatus.RESOLVED, "all allocations completed");
    }

    @Test
    void cancellingReleasesCapacityAndIsIdempotent() {
        Resource resource = unit(1L, 1, 2, true);
        ResourceAllocation existing = allocation(AllocationStatus.EN_ROUTE, resource);
        when(allocationRepository.findById(5L)).thenReturn(Optional.of(existing));

        service.cancelAllocation(5L);

        assertThat(existing.getStatus()).isEqualTo(AllocationStatus.CANCELLED);
        assertThat(resource.getCurrentLoad()).isZero();

        // A second cancel is a no-op: the unit is not released twice.
        service.cancelAllocation(5L);
        assertThat(resource.getCurrentLoad()).isZero();
    }

    @Test
    void anUnknownAllocationIdIs404() {
        when(allocationRepository.findById(9L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getAllocationById(9L))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessageContaining("9");
    }
}
