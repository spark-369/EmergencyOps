package com.pstu.backend.service;

import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.exception.InvalidStateTransitionException;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.IncidentRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The single choke point for every incident status change.
 *
 * <p>Whatever the caller — REST controller, optimizer or ingest loop — a move goes
 * through {@link IncidentLifecycleService#transition}, which asks the graph whether the
 * move is legal and stores the {@code INCIDENT_STATUS_CHANGED} fact in the caller's
 * transaction so the state and its announcement cannot disagree.
 */
class IncidentLifecycleServiceTest {

    private IncidentRepository incidentRepository;
    private EventPublisher eventPublisher;
    private IncidentLifecycleService service;

    @BeforeEach
    void setUp() {
        incidentRepository = mock(IncidentRepository.class);
        eventPublisher = mock(EventPublisher.class);
        when(incidentRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service = new IncidentLifecycleService(incidentRepository, eventPublisher);
    }

    private EmergencyIncident stored(IncidentStatus status) {
        return EmergencyIncident.builder()
                .id(1L).incidentId("inc-1").status(status).priorityScore(90).build();
    }

    @Test
    void aLegalMoveUpdatesTheStatusAndPublishesTheFact() {
        when(incidentRepository.findByIncidentId("inc-1"))
                .thenReturn(Optional.of(stored(IncidentStatus.PRIORITIZED)));

        EmergencyIncident result = service.transition("inc-1", IncidentStatus.ALLOCATING,
                "unit A-1 dispatched");

        assertThat(result.getStatus()).isEqualTo(IncidentStatus.ALLOCATING);
        verify(incidentRepository).save(result);

        ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(eventPublisher).publish(captor.capture());
        EventEnvelope envelope = captor.getValue();
        assertThat(envelope.type().name()).isEqualTo("INCIDENT_STATUS_CHANGED");
        // Keyed by incidentId so all events for one incident stay ordered.
        assertThat(envelope.partitionKey()).isEqualTo("inc-1");
        assertThat(envelope.payload())
                .containsEntry("previousStatus", "PRIORITIZED")
                .containsEntry("status", "ALLOCATING")
                .containsEntry("reason", "unit A-1 dispatched");
    }

    @Test
    void anIllegalMoveIsRejectedAndNothingIsWritten() {
        when(incidentRepository.findByIncidentId("inc-1"))
                .thenReturn(Optional.of(stored(IncidentStatus.RESOLVED)));

        assertThatThrownBy(() -> service.transition("inc-1", IncidentStatus.ALLOCATING, "retry"))
                .isInstanceOf(InvalidStateTransitionException.class)
                .hasMessageContaining("Allowed next statuses");

        // The guard runs before the write, so no fact is published for a move that failed.
        verify(eventPublisher, never()).publish(any());
    }

    @Test
    void anUnknownIncidentIdIs404() {
        when(incidentRepository.findByIncidentId("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.transition("missing", IncidentStatus.ALLOCATING, "x"))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessageContaining("missing");
    }

    @Test
    void allowedTransitionsExposeTheGraphForTheConsole() {
        when(incidentRepository.findByIncidentId("inc-1"))
                .thenReturn(Optional.of(stored(IncidentStatus.PRIORITIZED)));

        assertThat(service.allowedTransitions("inc-1"))
                .containsExactlyInAnyOrder(IncidentStatus.ALLOCATING,
                        IncidentStatus.IN_PROGRESS, IncidentStatus.CANCELLED, IncidentStatus.FAILED);
    }

    @Test
    void theIdOverloadResolvesTheBusinessIdBeforeTransitioning() {
        EmergencyIncident incident = stored(IncidentStatus.IN_PROGRESS);
        when(incidentRepository.findById(1L)).thenReturn(Optional.of(incident));
        when(incidentRepository.findByIncidentId("inc-1")).thenReturn(Optional.of(incident));

        EmergencyIncident result = service.transition(1L, IncidentStatus.RESOLVED);

        assertThat(result.getStatus()).isEqualTo(IncidentStatus.RESOLVED);
        assertThat(result.getIncidentId()).isEqualTo("inc-1");
    }
}
