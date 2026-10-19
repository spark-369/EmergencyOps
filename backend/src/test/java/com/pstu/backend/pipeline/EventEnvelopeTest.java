package com.pstu.backend.pipeline;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.pstu.backend.config.EventPipelineProperties;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The envelope is the contract between every producer and every consumer, and it
 * arrives from JSON, where an integer may decode as {@code Integer}, {@code Long}
 * or {@code Double} depending on magnitude. These tests pin the coercion rules so
 * a consumer written against {@code Integer.class} does not break on a large id.
 */
class EventEnvelopeTest {

    /**
     * A full set of pipeline properties.
     *
     * <p>Every component is named by position, so this constructor call is the one
     * place that breaks when {@link EventPipelineProperties} gains a field — which is
     * deliberate: a silent default would let a new setting go untested here. The
     * settings after the topic names are the ones added by the Redis/JobRunr migration
     * ({@code payloadRetention}, {@code outboxSweepIntervalSeconds},
     * {@code outboxRelayEnabled}) plus the consumed topic list.
     */
    private static final EventPipelineProperties TOPICS = new EventPipelineProperties(
            "emergency.incidents.v1", "emergency.allocations.v1",
            "emergency.resources.v1", "emergency.optimization.v1",
            "emergency.all.v1", "emergency.accounts.v1",
            "emergency.processing-failures.v1",
            /* outboxMaxAttempts */ 5,
            /* payloadRetention */ 1000,
            /* outboxSweepIntervalSeconds */ 15,
            /* outboxRelayEnabled */ true,
            /* consumerPattern */ "emergency.incidents.v1,emergency.allocations.v1");

    @Test
    void generatesIdsAndATraceWhenNoneIsGiven() {
        EventEnvelope envelope = EventEnvelope.of("INCIDENT_CREATED", "inc-1", null,
                Map.of("incidentId", "inc-1"), null);

        assertThat(envelope.eventId()).isNotBlank();
        assertThat(envelope.correlationId()).isNotBlank();
        assertThat(envelope.type()).isEqualTo(DomainEventType.INCIDENT_CREATED);
        // A blank partition key falls back to the aggregate id: one incident,
        // one partition, therefore guaranteed ordering.
        assertThat(envelope.partitionKey()).isEqualTo("inc-1");
        assertThat(envelope.version()).isEqualTo(EventEnvelope.CURRENT_VERSION);
    }

    @Test
    void routesEachTypeToItsConfiguredTopic() {
        assertThat(DomainEventType.INCIDENT_CREATED.topic(TOPICS)).isEqualTo("emergency.incidents.v1");
        assertThat(DomainEventType.ALLOCATION_CREATED.topic(TOPICS)).isEqualTo("emergency.allocations.v1");
        assertThat(DomainEventType.RESOURCE_STATUS_CHANGED.topic(TOPICS)).isEqualTo("emergency.resources.v1");
        assertThat(DomainEventType.OPTIMIZATION_COMPLETED.topic(TOPICS)).isEqualTo("emergency.optimization.v1");
        assertThat(DomainEventType.USER_CREATED.topic(TOPICS)).isEqualTo("emergency.accounts.v1");
        assertThat(DomainEventType.PROCESSING_FAILED.topic(TOPICS)).isEqualTo("emergency.processing-failures.v1");
    }

    @Test
    void commandsAreNotReplayableAndFactsAre() {
        assertThat(DomainEventType.INCIDENT_REPORTED.isCommand()).isTrue();
        assertThat(DomainEventType.INCIDENT_REPORTED.replayable()).isFalse();
        assertThat(DomainEventType.INCIDENT_CREATED.isCommand()).isFalse();
        assertThat(DomainEventType.INCIDENT_CREATED.replayable()).isTrue();
    }

    @Test
    void payloadNumbersAreCoercedToTheRequestedType() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("asLong", 42L);
        payload.put("asDouble", 3.5);
        payload.put("asString", "CRITICAL");
        EventEnvelope envelope = EventEnvelope.of("INCIDENT_CREATED", "inc-1", "inc-1", payload, "c");

        assertThat(envelope.payloadValue("asLong", Integer.class)).isEqualTo(42);
        assertThat(envelope.payloadValue("asDouble", Integer.class)).isEqualTo(3);
        assertThat(envelope.payloadValue("asString", String.class)).isEqualTo("CRITICAL");
        assertThat(envelope.payloadValue("missing", String.class)).isNull();
    }

    @Test
    void uncoercibleValueIsRejectedWithAClearMessage() {
        EventEnvelope envelope = EventEnvelope.of("INCIDENT_CREATED", "inc-1", "inc-1",
                Map.of("status", java.util.List.of("a", "b")), "c");

        // Silently returning null here would turn a producer contract error into a
        // "missing field" error at a far less useful place.
        assertThatThrownBy(() -> envelope.payloadValue("status", Integer.class))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("status");
    }

    @Test
    void unknownTypeFailsAtTheProducer() {
        assertThatThrownBy(() -> EventEnvelope.of("NOT_A_REAL_EVENT", "x", "x", Map.of(), "c"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void payloadIsImmutableOnceBuilt() {
        Map<String, Object> mutable = new LinkedHashMap<>();
        mutable.put("a", 1);
        EventEnvelope envelope = EventEnvelope.of("INCIDENT_CREATED", "x", "x", mutable, "c");
        mutable.put("b", 2);

        // The envelope travels across threads (outbox relay); later mutation of the
        // producer's map must not change what is published.
        assertThat(envelope.payload()).containsOnlyKeys("a");
        assertThatThrownBy(() -> envelope.payload().put("c", 3))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void nullPayloadValuesAreAllowed() {
        // Regression: Map.copyOf rejects null values, so publishing an allocation
        // status change with no reason threw an NPE inside the envelope constructor
        // and the controller answered 500.
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("status", "ASSIGNED");
        payload.put("reason", null);

        EventEnvelope envelope = EventEnvelope.of("ALLOCATION_STATUS_CHANGED", "1", "inc-1",
                payload, "corr-1");

        assertThat(envelope.payload()).containsKey("reason");
        assertThat(envelope.payload().get("reason")).isNull();
    }

    @Test
    void nullValuesSurviveTheJsonRoundTrip() throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("allocatedResourceId", null);
        payload.put("incidentId", "inc-1");
        EventEnvelope envelope = EventEnvelope.of("INCIDENT_CREATED", "inc-1", "inc-1",
                payload, "corr-1");

        ObjectMapper mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        EventEnvelope restored = mapper.readValue(mapper.writeValueAsString(envelope),
                EventEnvelope.class);

        // The payload is stored as JSON in pipeline_events and replayed from it, so a
        // null must survive the hop rather than disappear or fail to deserialize.
        assertThat(restored.payload()).containsKey("allocatedResourceId");
        assertThat(restored.payload().get("allocatedResourceId")).isNull();
        assertThat(restored.payloadValue("incidentId", String.class)).isEqualTo("inc-1");
    }

    @Test
    void payloadOrderIsPreserved() {
        // LinkedHashMap backing (rather than Map.of/copyOf) keeps a stored payload
        // readable in the order it was built.
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("z", 1);
        payload.put("a", 2);
        payload.put("m", 3);

        EventEnvelope envelope = EventEnvelope.of("INCIDENT_CREATED", "x", "x", payload, "c");

        assertThat(envelope.payload().keySet()).containsExactly("z", "a", "m");
    }
}
