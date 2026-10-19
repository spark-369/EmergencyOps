package com.pstu.backend.pipeline;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pstu.backend.config.EventPipelineProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Publishes an event envelope to Redis.
 *
 * <p>This is the transport that replaced the Kafka producer. It is deliberately thin:
 * one list write plus one publish per delivery, so "delivered" means Redis accepted the
 * payload rather than "the client buffered it".
 *
 * <p><strong>Two writes, one of them the guarantee.</strong> A delivery is
 *
 * <ol>
 *   <li>{@code RPUSH} onto {@code emergency:events:<topic>} — a capped list. This is
 *       the durable-ish part: if Redis accepted it, the payload is readable by any
 *       consumer that polls the list, and the outbox row may safely be marked
 *       PUBLIC.</li>
 *   <li>{@code PUBLISH} onto the same topic name — a fire-and-forget signal for
 *       subscribers that are connected right now. Pub/sub alone would be lossy
 *       (Redis drops messages for disconnected clients), which is precisely why the
 *       list exists and why the outbox exists above both.</li>
 * </ol>
 *
 * <p>Order is list-first on purpose. Publishing the notification first would let a
 * subscriber react to an event whose payload is not yet readable, which is a race
 * that only shows up under load.
 *
 * <p><strong>Failure.</strong> Every exception is converted into {@code false} by
 * {@link #deliver}, never propagated: the caller ({@link EventPublisher} or
 * {@link EventOutboxRelay}) records the failure against the outbox row. A transport
 * that threw would abort a JobRunr job before the row was updated, losing the
 * reason for the retry.
 */
@Component
public class RedisEventBus {

    private static final Logger log = LoggerFactory.getLogger(RedisEventBus.class);

    /** Prefix for the capped per-topic payload list. */
    static final String PAYLOAD_KEY_PREFIX = "emergency:events:";

    /** Channel carrying the configured topic list, so subscribers need not guess. */
    static final String TOPICS_CHANNEL = "emergency:topics";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final EventPipelineProperties properties;

    /**
     * Database index this bus writes to, captured once for error messages.
     *
     * <p>Read from {@code spring.data.redis.database} — the same property the connection
     * factory is built from — rather than interrogating a live connection. {@code db0} vs.
     * {@code db1} is the single most common reason an operator sees an "empty" Redis while
     * the application believes it is publishing, so the value has to appear in the error
     * log.</p>
     *
     * <p><strong>Why configuration rather than the connection.</strong> Probing the
     * connection means depending on whichever accessor a given Spring Data Redis version
     * exposes for server-level state ({@code RedisConnection} has none of its own; it varies
     * across {@code RedisServerCommands}). The configured index is what this application
     * actually writes to, so reading it here is both the direct answer and free of that
     * API surface. It is also cheaper: nothing opens a connection during construction.</p>
     *
     * <p>{@code -1} (rendered as {@code "unknown"} by {@link #redisDatabase()}) means the
     * property was unset or unparseable, in which case the driver default of {@code 0}
     * applies.</p>
     */
    private final int defaultDatabase;

    public RedisEventBus(StringRedisTemplate redis,
                         ObjectMapper objectMapper,
                         EventPipelineProperties properties,
                         @Value("${spring.data.redis.database:-1}") int defaultDatabase) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.defaultDatabase = defaultDatabase;
    }

    /**
     * Serialises and publishes {@code envelope} to its topic.
     *
     * @return {@code true} when Redis accepted both writes.
     */
    public boolean publish(EventEnvelope envelope) {
        String topic = envelope.topic(properties);
        String payload;
        try {
            payload = objectMapper.writeValueAsString(envelope);
        } catch (Exception e) {
            // Not a transport problem: the envelope cannot be represented as JSON, so
            // retrying can never help. Callers park such a row (FAILED).
            throw new IllegalArgumentException(
                    "Event %s cannot be serialised: %s".formatted(envelope.eventId(), e.getMessage()), e);
        }

        try {
            RedisConnection connection = redis.getRequiredConnectionFactory().getConnection();
            try {
                String key = PAYLOAD_KEY_PREFIX + topic;
                byte[] body = payload.getBytes(StandardCharsets.UTF_8);

                connection.listCommands().rPush(key.getBytes(StandardCharsets.UTF_8), body);
                // Trim to the configured window. A single LTRIM keeps Redis from
                // growing without bound while still leaving a readable tail.
                // Negated as a long: `-properties.payloadRetention()` is an int
                // negation, which overflows (and yields an inverted, empty range)
                // for a retention above Integer.MAX_VALUE.
                connection.listCommands().lTrim(
                        key.getBytes(StandardCharsets.UTF_8), -((long) properties.payloadRetention()), -1);

                connection.publish(topic.getBytes(StandardCharsets.UTF_8), body);
            } finally {
                connection.close();
            }
            log.debug("Published {} for {} to Redis topic {} (event {})",
                    envelope.type(), envelope.aggregateId(), topic, envelope.eventId());
            return true;
        } catch (RuntimeException e) {
            /*
             * Logged, not just returned as `false`. The caller records the failure on the
             * outbox row, but that is invisible while debugging "why is Redis empty?" — and
             * a silent `false` is indistinguishable from "nothing was ever published".
             * The key is included because the most common confusion is looking in the wrong
             * Redis database or instance.
             */
            log.error("Redis refused the write for event {} on topic {} (key {}{}) in database {}: {}. " +
                      "The outbox row stays PENDING and is retried; check REDIS_HOST/REDIS_PORT and " +
                      "that you are inspecting the same database.",
                    envelope.eventId(), topic, PAYLOAD_KEY_PREFIX, topic, redisDatabase(), rootCause(e));
            return false;
        }
    }

    /**
     * Database index the template is configured against; helps diagnose "empty" Redis.
     *
     * <p>Failure returns {@code "unknown"} rather than throwing: this only runs inside the
     * error path, so it must never replace the original failure with its own.
     */
    private String redisDatabase() {
        return defaultDatabase < 0 ? "unknown" : String.valueOf(defaultDatabase);
    }

    private static String rootCause(Throwable failure) {
        Throwable current = failure;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current.getClass().getSimpleName() + ": " + current.getMessage();
    }

    /**
     * Announce the topic list on {@link #TOPICS_CHANNEL}.
     *
     * <p>Advisory and best-effort: a slow or unavailable Redis must not stop the API
     * from starting, because the outbox absorbs the backlog. Subscribers inside this
     * application read the list from configuration instead.
     */
    public void announceTopics(List<String> topics) {
        try {
            redis.convertAndSend(TOPICS_CHANNEL, String.join(",", topics));
        } catch (RuntimeException e) {
            log.debug("Could not announce the topic list on {}: {}", TOPICS_CHANNEL, e.getMessage());
        }
    }

    /**
     * Publishes an opaque body to {@code topic} without an envelope.
     *
     * <p>Used for the dead-letter copy of a message that could not be parsed: it has no
     * envelope to address, and the point is to preserve the original bytes for an
     * operator rather than to make them consumable. Same ordering as
     * {@link #publish}: list first, then the notification.
     */
    public void publishRaw(String topic, String body) {
        RedisConnection connection = redis.getRequiredConnectionFactory().getConnection();
        try {
            byte[] key = (PAYLOAD_KEY_PREFIX + topic).getBytes(StandardCharsets.UTF_8);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.listCommands().rPush(key, bytes);
            connection.listCommands().lTrim(key, -((long) properties.payloadRetention()), -1);
            connection.publish(topic.getBytes(StandardCharsets.UTF_8), bytes);
        } finally {
            connection.close();
        }
    }

    /**
     * Round-trip check used by the startup probe.
     *
     * @throws RuntimeException when Redis does not answer, so the caller can report
     *                          the real cause.
     */
    public String ping() {
        return redis.execute((RedisConnection connection) -> connection.ping(), true);
    }

    public EventPipelineProperties properties() {
        return properties;
    }
}
