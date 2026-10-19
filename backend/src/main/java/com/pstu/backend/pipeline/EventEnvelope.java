package com.pstu.backend.pipeline;

import com.pstu.backend.config.EventPipelineProperties;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * The wire contract shared by every hop of the pipeline.
 *
 * <p>All events — the HTTP inbound ones, the domain events the services publish
 * and the results of the optimizer — travel inside this envelope. One shape for
 * everything means the consumer needs no per-topic parsing, the store indexes a
 * single table, and an operator reading a dead-letter record sees the same fields
 * everywhere.
 *
 * <p>{@code partitionKey} is what Kafka keys the record on ({@code incidentId}
 * for incidents, {@code resourceId} for fleet events, {@code userId} for
 * accounts). It is carried inside the payload as well so the value alone is
 * enough to rebuild ordering after a replay.
 *
 * @param eventId       UUID generated at the producer. Also written as the
 *                      {@code X-Event-Id} producer header.
 * @param type          {@link DomainEventType} name, e.g. {@code INCIDENT_CREATED}.
 * @param aggregateId   Business identity of the aggregate the event is about.
 * @param partitionKey  Kafka key; all events for one aggregate land on one partition.
 * @param occurredAt    Producer clock, informational only.
 * @param correlationId Request/trace id propagated from the originating HTTP call.
 * @param version       Envelope schema version, for future migrations.
 * @param payload       Event-specific body.
 * @param metadata      Optional producer notes (source component, retries, ...).
 */
public record EventEnvelope(
        String eventId,
        DomainEventType type,
        String aggregateId,
        String partitionKey,
        Instant occurredAt,
        String correlationId,
        int version,
        Map<String, Object> payload,
        Map<String, Object> metadata) {

    public static final int CURRENT_VERSION = 1;
    public static final String HEADER_EVENT_ID = "X-Event-Id";
    public static final String HEADER_CORRELATION_ID = "X-Correlation-Id";
    public static final String HEADER_EVENT_TYPE = "X-Event-Type";

    public EventEnvelope {
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(aggregateId, "aggregateId");
        partitionKey = partitionKey == null || partitionKey.isBlank() ? aggregateId : partitionKey;
        occurredAt = occurredAt == null ? Instant.now() : occurredAt;
        version = version <= 0 ? CURRENT_VERSION : version;
        /*
         * Not Map.copyOf: it rejects null keys *and values* with an NPE, but a null
         * payload value is legitimate state — "no resource was suitable", "no previous
         * status", "no reason supplied". Building the payload threw on those, which
         * surfaced as a 500 from the controller that published the event.
         *
         * An unmodifiable copy over LinkedHashMap keeps the guarantee that matters
         * (a caller cannot mutate what was published) without the null restriction,
         * and preserves insertion order so a stored payload reads the way it was built.
         */
        payload = immutableCopy(payload);
        metadata = immutableCopy(metadata);
    }

    private static Map<String, Object> immutableCopy(Map<String, Object> source) {
        return source == null || source.isEmpty()
                ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(source));
    }

    /**
     * Convenience factory for a new envelope of {@code type} about {@code aggregateId},
     * keyed by {@code partitionKey}. The correlation id is generated when absent.
     */
    public static EventEnvelope of(String type, String aggregateId, String partitionKey,
                                   Map<String, Object> payload, String correlationId) {
        String resolvedCorrelationId = correlationId == null || correlationId.isBlank()
                ? UUID.randomUUID().toString()
                : correlationId;
        return new EventEnvelope(
                UUID.randomUUID().toString(),
                // Rejects an unknown name here, at the publisher, instead of
                // producing a poison record the consumer can only dead-letter.
                DomainEventType.valueOf(type),
                aggregateId,
                partitionKey,
                Instant.now(),
                resolvedCorrelationId,
                CURRENT_VERSION,
                payload,
                null);
    }

    /** The topic this event must be published to, per the pipeline configuration. */
    public String topic(EventPipelineProperties properties) {
        return type.topic(properties);
    }

    @SuppressWarnings("unchecked")
    public <T> T payloadValue(String key, Class<T> expectedType) {
        Object value = payload.get(key);
        if (value == null) {
            return null;
        }
        if (expectedType.isInstance(value)) {
            return (T) value;
        }
        if (expectedType == String.class) {
            return (T) value.toString();
        }
        if (value instanceof Number number) {
            if (expectedType == Integer.class) {
                return (T) Integer.valueOf(number.intValue());
            }
            if (expectedType == Long.class) {
                return (T) Long.valueOf(number.longValue());
            }
            if (expectedType == Double.class) {
                return (T) Double.valueOf(number.doubleValue());
            }
        }
        throw new IllegalArgumentException(
                "Payload field '%s' of event %s is not a %s".formatted(
                        key, type, expectedType.getSimpleName()));
    }
}
