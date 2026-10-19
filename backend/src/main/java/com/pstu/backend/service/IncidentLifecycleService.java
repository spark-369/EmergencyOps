package com.pstu.backend.service;

import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.exception.IncidentLifecycle;
import com.pstu.backend.pipeline.CorrelationIdFilter;
import com.pstu.backend.pipeline.DomainEventType;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.IncidentRepository;
import jakarta.persistence.EntityNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * The write side of the incident aggregate.
 *
 * <p>Every status change in the system — from the REST controller, from the
 * optimizer, from the Kafka ingest loop — goes through {@link #transition}. That
 * single choke point is what makes the lifecycle real: the graph in
 * {@link IncidentLifecycle} decides whether the move is legal, and the
 * {@code INCIDENT_STATUS_CHANGED} fact is stored in the caller's transaction so
 * the state and its announcement cannot disagree.
 *
 * <p>Publishing the status change is also what drives the rest of the pipeline:
 * a dashboard, a downstream service or the next optimisation pass learns about
 * the move from the broker, not by polling this database.
 */
@Service
@Transactional
public class IncidentLifecycleService {

    private static final Logger log = LoggerFactory.getLogger(IncidentLifecycleService.class);

    private final IncidentRepository incidentRepository;
    private final EventPublisher eventPublisher;

    public IncidentLifecycleService(IncidentRepository incidentRepository,
                                    EventPublisher eventPublisher) {
        this.incidentRepository = incidentRepository;
        this.eventPublisher = eventPublisher;
    }

    /**
     * Moves the incident to {@code target} and publishes the fact.
     *
     * @throws EntityNotFoundException when no incident has that business id
     * @throws com.pstu.backend.exception.InvalidStateTransitionException when the move is not legal
     */
    public EmergencyIncident transition(String incidentId, IncidentStatus target, String reason) {
        EmergencyIncident incident = incidentRepository.findByIncidentId(incidentId)
                .orElseThrow(() -> new EntityNotFoundException("Incident not found: " + incidentId));
        IncidentStatus previous = incident.getStatus();
        IncidentLifecycle.requireTransition(incidentId, previous, target);

        incident.setStatus(target);
        incident = incidentRepository.save(incident);
        publishStatusChange(incident, previous, target, reason);

        log.info("Incident {} {} -> {}", incidentId, previous, target);
        return incident;
    }

    public EmergencyIncident transition(Long id, IncidentStatus target) {
        EmergencyIncident incident = incidentRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Incident not found with id: " + id));
        return transition(incident.getIncidentId(), target, "status update");
    }

    /** Statuses the incident may legally move to next. */
    @Transactional(readOnly = true)
    public Set<IncidentStatus> allowedTransitions(String incidentId) {
        EmergencyIncident incident = incidentRepository.findByIncidentId(incidentId)
                .orElseThrow(() -> new EntityNotFoundException("Incident not found: " + incidentId));
        return IncidentLifecycle.allowedTargets(incident.getStatus());
    }

    /** Publishes {@code INCIDENT_CREATED}; called by {@link IncidentService} after its insert. */
    public void publishCreated(EmergencyIncident incident) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("incidentId", incident.getIncidentId());
        payload.put("severity", incident.getSeverity() == null ? null : incident.getSeverity().name());
        payload.put("status", incident.getStatus() == null ? null : incident.getStatus().name());
        payload.put("priorityScore", incident.getPriorityScore());
        payload.put("estimatedResponseTimeMinutes", incident.getEstimatedResponseTimeMinutes());
        payload.put("latitude", incident.getLatitude());
        payload.put("longitude", incident.getLongitude());
        payload.put("locationDescription", incident.getLocationDescription());
        payload.put("createdAt", iso(incident.getCreatedAt()));

        eventPublisher.publish(EventEnvelope.of(
                DomainEventType.INCIDENT_CREATED.name(),
                incident.getIncidentId(),
                incident.getIncidentId(),
                payload,
                CorrelationIdFilter.currentOrRandom()));
    }

    private void publishStatusChange(EmergencyIncident incident, IncidentStatus previous,
                                     IncidentStatus target, String reason) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("incidentId", incident.getIncidentId());
        payload.put("previousStatus", previous == null ? null : previous.name());
        payload.put("status", target.name());
        payload.put("priorityScore", incident.getPriorityScore());
        payload.put("reason", reason == null ? "status update" : reason);

        eventPublisher.publish(EventEnvelope.of(
                DomainEventType.INCIDENT_STATUS_CHANGED.name(),
                incident.getIncidentId(),
                incident.getIncidentId(),
                payload,
                CorrelationIdFilter.currentOrRandom()));
    }

    private static String iso(LocalDateTime value) {
        return value == null ? null : Timestamp.valueOf(value).toInstant().toString();
    }
}
