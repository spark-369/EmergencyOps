package com.pstu.backend.service;

import com.pstu.backend.dto.ResourceRequest;
import com.pstu.backend.dto.ResourceResponse;
import com.pstu.backend.entity.Resource;
import com.pstu.backend.enums.ResourceStatus;
import com.pstu.backend.enums.ResourceType;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.ResourceRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Fleet registration and status changes.
 *
 * <p>Two behaviours carry real risk and are pinned here: the denormalised
 * {@code available} flag must stay in step with the {@code status} enum (the optimizer
 * trusts the enum, but the console reads the flag), and every status change must
 * publish a {@code RESOURCE_STATUS_CHANGED} fact so a unit going offline is visible
 * without polling.
 */
class ResourceServiceTest {

    private ResourceRepository resourceRepository;
    private EventPublisher eventPublisher;
    private ResourceService service;

    @BeforeEach
    void setUp() {
        resourceRepository = mock(ResourceRepository.class);
        eventPublisher = mock(EventPublisher.class);
        when(resourceRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service = new ResourceService(resourceRepository, eventPublisher);
    }

    private static Resource stored(long id, ResourceStatus status, int load, int capacity) {
        return Resource.builder()
                .id(id).resourceId("AMB-" + id)
                .type(ResourceType.AMBULANCE)
                .latitude(23.8).longitude(90.4)
                .status(status).capacity(capacity).currentLoad(load)
                .available(status == ResourceStatus.AVAILABLE)
                .build();
    }

    private EventEnvelope publishedEnvelope() {
        ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(eventPublisher).publish(captor.capture());
        return captor.getValue();
    }

    @Test
    void registrationGeneratesAnIdAndStartsTheUnitAvailable() {
        ResourceResponse response = service.registerResource(ResourceRequest.builder()
                .type(ResourceType.AMBULANCE)
                .latitude(23.8).longitude(90.4)
                .capacity(4).travelSpeedKmh(80.0)
                .build());

        assertThat(response.getResourceId()).isNotBlank();
        assertThat(response.getStatus()).isEqualTo(ResourceStatus.AVAILABLE);
        assertThat(response.getCurrentLoad()).isZero();
        assertThat(response.getAvailable()).isTrue();
    }

    @Test
    void aStatusChangeKeepsTheAvailableFlagInStep() {
        Resource unit = stored(1L, ResourceStatus.AVAILABLE, 0, 4);
        when(resourceRepository.findById(1L)).thenReturn(Optional.of(unit));

        ResourceResponse response = service.updateResourceStatus(1L, ResourceStatus.MAINTENANCE);

        assertThat(response.getStatus()).isEqualTo(ResourceStatus.MAINTENANCE);
        // MAINTENANCE is not AVAILABLE/STANDBY, so the unit must drop out of the pool.
        assertThat(unit.getAvailable()).isFalse();
    }

    @Test
    void standbyCountsAsAvailable() {
        Resource unit = stored(1L, ResourceStatus.BUSY, 4, 4);
        when(resourceRepository.findById(1L)).thenReturn(Optional.of(unit));

        service.updateResourceStatus(1L, ResourceStatus.STANDBY);

        assertThat(unit.getAvailable()).isTrue();
    }

    @Test
    void aStatusChangePublishesTheFleetFactWithPreviousAndNewStatus() {
        Resource unit = stored(1L, ResourceStatus.AVAILABLE, 0, 4);
        when(resourceRepository.findById(1L)).thenReturn(Optional.of(unit));

        service.updateResourceStatus(1L, ResourceStatus.OFFLINE);

        EventEnvelope envelope = publishedEnvelope();
        assertThat(envelope.type().name()).isEqualTo("RESOURCE_STATUS_CHANGED");
        // Keyed by resourceId so every event for one unit stays ordered on one partition.
        assertThat(envelope.partitionKey()).isEqualTo("AMB-1");
        assertThat(envelope.payload())
                .containsEntry("previousStatus", "AVAILABLE")
                .containsEntry("status", "OFFLINE")
                .containsEntry("available", false);
    }

    @Test
    void reportingFailureTakesTheUnitOfflineAndPublishes() {
        Resource unit = stored(1L, ResourceStatus.AVAILABLE, 1, 4);
        when(resourceRepository.findById(1L)).thenReturn(Optional.of(unit));

        service.reportResourceFailure(1L);

        assertThat(unit.getStatus()).isEqualTo(ResourceStatus.OFFLINE);
        assertThat(unit.getAvailable()).isFalse();
        assertThat(publishedEnvelope().payload()).containsEntry("reason", "unit reported failed");
    }

    @Test
    void restoringAUnitMakesItAvailableAgain() {
        Resource unit = stored(1L, ResourceStatus.MAINTENANCE, 0, 4);
        when(resourceRepository.findById(1L)).thenReturn(Optional.of(unit));

        service.restoreResource(1L);

        assertThat(unit.getStatus()).isEqualTo(ResourceStatus.AVAILABLE);
        assertThat(unit.getAvailable()).isTrue();
        assertThat(publishedEnvelope().payload()).containsEntry("reason", "unit restored");
    }

    @Test
    void aUnitFilledToCapacityIsTakenOutOfTheAvailablePool() {
        Resource unit = stored(1L, ResourceStatus.AVAILABLE, 0, 4);
        when(resourceRepository.findById(1L)).thenReturn(Optional.of(unit));

        service.updateResourceLoad(1L, 4);

        assertThat(unit.getCurrentLoad()).isEqualTo(4);
        assertThat(unit.getAvailable()).isFalse();
    }

    @Test
    void lookupByUnknownResourceIdIs404Not500() {
        when(resourceRepository.findByResourceId("nope")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getResourceByResourceId("nope"))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessageContaining("nope");
    }
}
