package com.pstu.backend.pipeline;

import com.pstu.backend.config.EventPipelineProperties;

/**
 * The complete vocabulary of the pipeline.
 *
 * <p>Each constant answers three questions: who produces it, which topic it
 * travels on, and whether the outbox replays it. The topic names are never
 * hard-coded in listeners or services — they come from
 * {@link EventPipelineProperties}, so a deployment can prefix them
 * ({@code prod-emergency.incidents.v1}) without touching code.
 *
 * <p><strong>Naming.</strong> {@code *_REQUESTED} events are commands produced by
 * the HTTP layer; {@code *_CREATED} / {@code *_UPDATED} are facts produced by the
 * domain services once the database commit succeeded. The distinction matters for
 * replay: commands are never replayed (the client can retry), facts are.
 */
public enum DomainEventType {

    /* ------------------------------------------------------------- inbound commands */
    /** An incident reported through the event API; consumed by the incident ingest loop. */
    INCIDENT_REPORTED,
    /** A dispatch decision taken by a human; consumed by the allocation ingest loop. */
    ALLOCATION_REQUESTED,
    /** A status a field operator reported; consumed by the status ingest loop. */
    INCIDENT_STATUS_REQUESTED,

    /* ---------------------------------------------------------------- domain facts */
    INCIDENT_CREATED,
    INCIDENT_STATUS_CHANGED,
    ALLOCATION_CREATED,
    ALLOCATION_STATUS_CHANGED,
    ALLOCATION_CANCELLED,
    RESOURCE_STATUS_CHANGED,
    OPTIMIZATION_COMPLETED,
    OPTIMIZATION_SKIPPED,
    USER_CREATED,
    USER_DELETED,

    /* -------------------------------------------------------------------- failures */
    /** Recorded by the ingest loop when an inbound command could not be applied. */
    PROCESSING_FAILED;

    /** Topic carrying this event, per the deployment configuration. */
    public String topic(EventPipelineProperties properties) {
        return switch (this) {
            case INCIDENT_REPORTED,
                 INCIDENT_CREATED,
                 INCIDENT_STATUS_CHANGED,
                 INCIDENT_STATUS_REQUESTED -> properties.incidentsTopic();
            case ALLOCATION_REQUESTED,
                 ALLOCATION_CREATED,
                 ALLOCATION_STATUS_CHANGED,
                 ALLOCATION_CANCELLED -> properties.allocationsTopic();
            case RESOURCE_STATUS_CHANGED -> properties.resourcesTopic();
            case OPTIMIZATION_COMPLETED,
                 OPTIMIZATION_SKIPPED -> properties.optimizationTopic();
            case USER_CREATED,
                 USER_DELETED -> properties.accountsTopic();
            case PROCESSING_FAILED -> properties.failureTopic();
        };
    }

    /** True for facts the outbox replays after a broker outage. */
    public boolean replayable() {
        return this != INCIDENT_REPORTED
                && this != ALLOCATION_REQUESTED
                && this != INCIDENT_STATUS_REQUESTED
                && this != PROCESSING_FAILED;
    }

    /** True for events the ingest loop consumes. */
    public boolean isCommand() {
        return switch (this) {
            case INCIDENT_REPORTED, ALLOCATION_REQUESTED, INCIDENT_STATUS_REQUESTED -> true;
            default -> false;
        };
    }
}
