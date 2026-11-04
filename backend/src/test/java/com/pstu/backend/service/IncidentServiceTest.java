package com.pstu.backend.service;

import com.pstu.backend.dto.IncidentRequest;
import com.pstu.backend.dto.IncidentResponse;
import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.repository.IncidentRepository;
import com.pstu.backend.repository.ResourceRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The incident write path: what a report becomes the moment it is stored.
 *
 * <p>The two numbers computed here — the priority score and the response-time promise
 * — are what the triage board sorts on and what a dispatcher is measured against, and
 * both are derived, not supplied. These tests pin the derivation and the decision to
 * store a new report as {@code PRIORITIZED} (never the never-observed {@code RECEIVED}).
 */
class IncidentServiceTest {

    private IncidentRepository incidentRepository;
    private IncidentLifecycleService lifecycleService;
    private IncidentService service;

    @BeforeEach
    void setUp() {
        incidentRepository = mock(IncidentRepository.class);
        lifecycleService = mock(IncidentLifecycleService.class);
        // save() must echo its argument: the service reads the returned entity to build
        // the response, and Mockito would otherwise hand back null.
        when(incidentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service = new IncidentService(incidentRepository, mock(ResourceRepository.class), lifecycleService);
    }

    private static IncidentRequest request(IncidentSeverity severity, int people, int sensitivity) {
        return IncidentRequest.builder()
                .latitude(23.8103).longitude(90.4125)
                .locationDescription("Bridge collapse")
                .severity(severity).affectedPeople(people)
                .timeSensitivityMinutes(sensitivity)
                .build();
    }

    @Test
    void aNewReportIsStoredAsPrioritizedWithAComputedScore() {
        IncidentResponse response = service.createIncident(request(IncidentSeverity.CRITICAL, 12, 5));

        // 80 + min(12/10,30)=1 + (20-5/5)=19 = 100
        assertThat(response.getPriorityScore()).isEqualTo(100);
        // RECEIVED is never observable: the score is computed in the same transaction.
        assertThat(response.getStatus()).isEqualTo(IncidentStatus.PRIORITIZED);
        assertThat(response.getIncidentId()).isNotBlank();
    }

    @Test
    void responseTimeIsTheSeverityBudgetTightenedByUrgencyAndFlooredAtFive() {
        assertThat(service.createIncident(request(IncidentSeverity.LOW, 1, 5))
                .getEstimatedResponseTimeMinutes()).isEqualTo(55);
        assertThat(service.createIncident(request(IncidentSeverity.CATASTROPHIC, 1, 5))
                .getEstimatedResponseTimeMinutes()).isEqualTo(5);
        // HIGH budget 30, sensitivity 40 -> max(-10, 5) = 5, never negative.
        assertThat(service.createIncident(request(IncidentSeverity.HIGH, 1, 40))
                .getEstimatedResponseTimeMinutes()).isEqualTo(5);
    }

    @Test
    void creationPublishesTheCreatedFact() {
        service.createIncident(request(IncidentSeverity.HIGH, 3, 10));

        verify(lifecycleService).publishCreated(any(EmergencyIncident.class));
    }

    @Test
    void lookupByUnknownBusinessIdIs404Not500() {
        when(incidentRepository.findByIncidentId("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getIncidentByIncidentId("missing"))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessageContaining("missing");
    }

    @Test
    void reassignPriorityRecomputesTheScoreInPlace() {
        EmergencyIncident stored = EmergencyIncident.builder()
                .id(7L).incidentId("inc-7")
                .severity(IncidentSeverity.CATASTROPHIC)
                .affectedPeople(300).timeSensitivityMinutes(0)
                .priorityScore(10)
                .build();
        when(incidentRepository.findById(7L)).thenReturn(Optional.of(stored));

        service.reassignPriority(7L);

        assertThat(stored.getPriorityScore()).isEqualTo(100);
        assertThat(stored.getEstimatedResponseTimeMinutes()).isEqualTo(10);
        verify(incidentRepository).save(stored);
    }

    @Test
    void deleteRemovesTheIncident() {
        EmergencyIncident stored = EmergencyIncident.builder().id(7L).incidentId("inc-7").build();
        when(incidentRepository.findById(7L)).thenReturn(Optional.of(stored));

        service.deleteIncident(7L);

        verify(incidentRepository).delete(stored);
    }
}
