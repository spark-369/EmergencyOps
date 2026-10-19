package com.pstu.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.util.List;

/**
 * Topic names and fan-out settings for the end-to-end event pipeline, bound from
 * {@code app.events.*}.
 *
 * <p>Every field is read together on the first publish, so the settings are kept
 * as one record rather than several separately-bound keys.
 *
 * <p>Topic names carry a {@code .v1} suffix because the payload shape of a topic
 * is a contract; a breaking change ships as {@code .v2} consumed side by side
 * with the old one rather than mutating the live contract.
 *
 * @param incidentsTopic    Inbound reports and incident facts.
 * @param allocationsTopic  Dispatch commands and allocation facts.
 * @param resourcesTopic    Fleet status facts.
 * @param optimizationTopic Results of a full re-optimisation run.
 * @param allTopic          Reserved summary topic. Nothing publishes to it today, and
 *                          the ingest loop does not subscribe to it; it is kept in the
 *                          configuration so a fan-out topic can be added without a
 *                          schema change to this record.
 * @param accountsTopic     Account lifecycle facts (created / deleted).
 * @param failureTopic      In-database {@code PROCESSING_FAILED} records. The
 *                          dead-letter stream is this name plus {@code .DLT}, kept
 *                          separate so a dead-lettered record is not re-consumed.
 * @param outboxMaxAttempts Stored-but-unpublished events are retried this many times
 *                          before being flagged {@code exhausted} (they stay queued).
 * @param payloadRetention  How many payloads to keep per topic in Redis. The topic
 *                          list is a transport buffer for readers and debugging; the
 *                          outbox table remains the system of record.
 * @param outboxSweepIntervalSeconds How often the JobRunr-driven outbox sweep runs.
 *                          It is a safety net for rows whose delivery job never
 *                          completed, so it is much slower than delivery itself.
 * @param outboxRelayEnabled Whether the outbox relay — and with it the recurring
 *                          JobRunr sweep — is switched on. Off in tests, where a
 *                          sweeper firing at a mocked transport only adds noise; the
 *                          flag is read before registering the recurring job so a
 *                          disabled relay leaves no scheduled job behind in the store.
 * @param consumerPattern   Comma-separated topics the in-process subscriber consumes.
 *                          Kept out of topic names on purpose: which topics this
 *                          application reads is a deployment choice, not a contract.
 */
@ConfigurationProperties(prefix = "app.events")
public record EventPipelineProperties(
        @DefaultValue("emergency.incidents.v1") String incidentsTopic,
        @DefaultValue("emergency.allocations.v1") String allocationsTopic,
        @DefaultValue("emergency.resources.v1") String resourcesTopic,
        @DefaultValue("emergency.optimization.v1") String optimizationTopic,
        @DefaultValue("emergency.all.v1") String allTopic,
        @DefaultValue("emergency.accounts.v1") String accountsTopic,
        @DefaultValue("emergency.processing-failures.v1") String failureTopic,
        @DefaultValue("5") int outboxMaxAttempts,
        @DefaultValue("1000") int payloadRetention,
        @DefaultValue("15") long outboxSweepIntervalSeconds,
        @DefaultValue("true") boolean outboxRelayEnabled,
        @DefaultValue("emergency.incidents.v1,emergency.allocations.v1,emergency.resources.v1,"
                + "emergency.optimization.v1,emergency.accounts.v1") String consumerPattern) {

    /** Every topic the pipeline publishes to, in one list. */
    public List<String> allTopics() {
        return List.of(incidentsTopic, allocationsTopic, resourcesTopic,
                optimizationTopic, accountsTopic, failureTopic);
    }
}
