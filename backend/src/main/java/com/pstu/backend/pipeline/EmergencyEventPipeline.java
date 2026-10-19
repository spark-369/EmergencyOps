package com.pstu.backend.pipeline;

import com.pstu.backend.dto.AllocationRequest;
import com.pstu.backend.dto.IncidentRequest;
import com.pstu.backend.dto.IncidentResponse;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.service.AllocationService;
import com.pstu.backend.service.IncidentLifecycleService;
import com.pstu.backend.service.IncidentService;
import com.pstu.backend.service.OptimizationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The ingest side of the pipeline: turns inbound commands into domain writes.
 *
 * <p>This is what makes the platform "end to end". A field device, an external
 * CAD system or another service can publish an {@code INCIDENT_REPORTED} envelope
 * and get the full chain without touching HTTP: the incident is created, its
 * priority is computed, {@code INCIDENT_CREATED} is published, and an
 * optimisation pass runs and publishes {@code OPTIMIZATION_COMPLETED}. The same
 * holds for a dispatch command ({@code ALLOCATION_REQUESTED}) and a status report
 * ({@code INCIDENT_STATUS_REQUESTED}).
 *
 * <p><strong>Exactly-once effect.</strong> Kafka delivers at least once, and the
 * outbox retry can publish a duplicate. Every command is therefore checked against
 * the {@code pipeline_events} store: the processed {@code eventId} is recorded in
 * the same transaction as the write it triggered, so a redelivery finds the id and
 * acknowledges without repeating the effect.
 */
@Service
public class EmergencyEventPipeline {

    private static final Logger log = LoggerFactory.getLogger(EmergencyEventPipeline.class);

    private final EventStore eventStore;
    private final IncidentService incidentService;
    private final AllocationService allocationService;
    private final IncidentLifecycleService lifecycleService;
    private final OptimizationService optimizationService;

    public EmergencyEventPipeline(EventStore eventStore,
                                  IncidentService incidentService,
                                  AllocationService allocationService,
                                  IncidentLifecycleService lifecycleService,
                                  OptimizationService optimizationService) {
        this.eventStore = eventStore;
        this.incidentService = incidentService;
        this.allocationService = allocationService;
        this.lifecycleService = lifecycleService;
        this.optimizationService = optimizationService;
    }

    /**
     * Applies one inbound command.
     *
     * <p>The correlation id from the envelope is put into the MDC for the duration
     * of the call, so every log line of the resulting write — including the ones
     * emitted by the services it calls — carries the id of the original reporter.
     *
     * @return a short description of the effect, for logging and metrics
     */
    public String handle(EventEnvelope envelope) {
        String previous = MDC.get(CorrelationIdFilter.MDC_KEY);
        MDC.put(CorrelationIdFilter.MDC_KEY, envelope.correlationId());
        try {
            return switch (envelope.type()) {
                case INCIDENT_REPORTED -> reportIncident(envelope);
                case ALLOCATION_REQUESTED -> requestAllocation(envelope);
                case INCIDENT_STATUS_REQUESTED -> reportStatus(envelope);
                default -> {
                    log.debug("Ignoring {} on the command path", envelope.type());
                    yield "ignored";
                }
            };
        } finally {
            if (previous == null) {
                MDC.remove(CorrelationIdFilter.MDC_KEY);
            } else {
                MDC.put(CorrelationIdFilter.MDC_KEY, previous);
            }
        }
    }

    private String reportIncident(EventEnvelope envelope) {
        IncidentRequest request = IncidentRequest.builder()
                .latitude(requiredDouble(envelope, "latitude"))
                .longitude(requiredDouble(envelope, "longitude"))
                .locationDescription(stringOrDefault(envelope, "locationDescription", "Reported via event stream"))
                .severity(parseSeverity(envelope.payloadValue("severity", String.class)))
                .affectedPeople(intOrDefault(envelope, "affectedPeople", 1))
                .timeSensitivityMinutes(intOrDefault(envelope, "timeSensitivityMinutes", 30))
                .build();

        IncidentResponse created = incidentService.createIncident(request);
        // The recommendation is useful but not critical: a failure here must not
        // fail the ingest and cause the report to be re-applied.
        try {
            optimizationService.optimizeForIncident(created.getIncidentId());
        } catch (RuntimeException e) {
            log.warn("Optimisation after ingest of {} failed: {}", created.getIncidentId(), e.getMessage());
        }
        log.info("Ingested incident {} from event {}", created.getIncidentId(), envelope.eventId());
        return "incident:" + created.getIncidentId();
    }

    private String requestAllocation(EventEnvelope envelope) {
        String incidentId = requiredString(envelope, "incidentId");
        String resourceId = requiredString(envelope, "resourceId");
        allocationService.allocateResource(AllocationRequest.builder()
                .incidentId(incidentId)
                .resourceId(resourceId)
                // Defaulted, not passed through as null: both columns are NOT NULL,
                // and an event that omits them would otherwise fail at flush with a
                // constraint violation rather than being applied.
                .estimatedTravelTimeMinutes(intOrDefault(envelope, "estimatedTravelTimeMinutes", 0))
                .estimatedResolutionTimeMinutes(intOrDefault(envelope, "estimatedResolutionTimeMinutes", 60))
                .decisionRationale(stringOrDefault(envelope, "decisionRationale", "dispatched via event stream"))
                .build());
        log.info("Ingested dispatch of {} to incident {}", resourceId, incidentId);
        return "allocation:" + incidentId + "/" + resourceId;
    }

    private String reportStatus(EventEnvelope envelope) {
        String incidentId = requiredString(envelope, "incidentId");
        String status = requiredString(envelope, "status");
        IncidentStatus target;
        try {
            target = IncidentStatus.valueOf(status.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            // IllegalArgumentException is non-retryable in KafkaConfig: a misspelt
            // status will never become valid, so it goes straight to the DLT.
            throw new IllegalArgumentException("Unknown incident status '" + status + "'");
        }
        lifecycleService.transition(incidentId, target,
                stringOrDefault(envelope, "reason", "reported via event stream"));
        return "status:" + incidentId + "=" + target;
    }

    /**
     * Records a {@code PROCESSING_FAILED} fact, outside the failed transaction, so
     * it survives the rollback that caused it.
     */
    public void reportFailure(EventEnvelope envelope, Throwable failure) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("originalEventId", envelope == null ? null : envelope.eventId());
        payload.put("originalType", envelope == null || envelope.type() == null ? null : envelope.type().name());
        payload.put("aggregateId", envelope == null ? null : envelope.aggregateId());
        payload.put("error", failure == null ? null : failure.getMessage());
        payload.put("errorType", failure == null ? null : failure.getClass().getSimpleName());
        payload.put("payload", envelope == null ? null : envelope.payload());

        eventStore.storeIndependently(EventEnvelope.of(
                DomainEventType.PROCESSING_FAILED.name(),
                envelope == null ? "unknown" : envelope.aggregateId(),
                envelope == null ? "unknown" : envelope.partitionKey(),
                payload,
                envelope == null ? CorrelationIdFilter.currentOrRandom() : envelope.correlationId()));
    }

    private static double requiredDouble(EventEnvelope envelope, String key) {
        Double value = envelope.payloadValue(key, Double.class);
        if (value == null) {
            throw new IllegalArgumentException("Event " + envelope.type() + " is missing '" + key + "'");
        }
        return value;
    }

    private static String requiredString(EventEnvelope envelope, String key) {
        String value = envelope.payloadValue(key, String.class);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Event " + envelope.type() + " is missing '" + key + "'");
        }
        return value;
    }

    private static String stringOrDefault(EventEnvelope envelope, String key, String fallback) {
        String value = envelope.payloadValue(key, String.class);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static int intOrDefault(EventEnvelope envelope, String key, int fallback) {
        Integer value = envelope.payloadValue(key, Integer.class);
        return value == null ? fallback : value;
    }

    private static IncidentSeverity parseSeverity(String severity) {
        if (severity == null || severity.isBlank()) {
            // Missing severity is a data-quality issue, not a poison message:
            // MEDIUM is the documented default of the HTTP path too.
            return IncidentSeverity.MEDIUM;
        }
        return IncidentSeverity.valueOf(severity.trim().toUpperCase());
    }
}
