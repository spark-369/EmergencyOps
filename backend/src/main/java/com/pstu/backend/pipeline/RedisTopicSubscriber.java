package com.pstu.backend.pipeline;

import com.pstu.backend.config.EventPipelineProperties;
import com.pstu.backend.service.EventProcessingService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The ingest loop's transport: subscribes to the pipeline's topics on Redis.
 *
 * <p>Direct replacement for the previous broker listener. The important difference is
 * the guarantee, and this class has to be honest about it:
 *
 * <ol>
 *   <li><strong>Payloads are also kept in a list.</strong> {@link RedisEventBus} writes
 *       {@code emergency:events:<topic>} before notifying, so a notification this
 *       subscriber misses (it was disconnected) is still readable. A pub/sub message is
 *       gone once delivered; the list is what stops that being data loss.</li>
 *   <li><strong>Failures are retried here</strong> a bounded number of times, then the
 *       message is copied to {@code <failure-topic>.DLT} instead of being dropped — the
 *       job the Kafka error handler used to do.</li>
 *   <li><strong>Duplicates are handled downstream.</strong> {@code EventProcessingService}
 *       skips an event id it has already recorded, so a retry cannot apply a command
 *       twice.</li>
 * </ol>
 *
 * <p>Disabled with {@code app.events.consumer.enabled=false}: tests have no Redis to
 * subscribe to.
 */
@Component
@ConditionalOnProperty(name = "app.events.consumer.enabled", havingValue = "true", matchIfMissing = true)
public class RedisTopicSubscriber implements MessageListener, InitializingBean, DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(RedisTopicSubscriber.class);

    /**
     * Attempts per message before it goes to the dead-letter stream.
     *
     * <p>Small on purpose: the retry happens on the subscriber thread, so a long
     * back-off would stall every other topic on this connection. Anything that needs
     * more patience is an operator's problem, and the {@code PROCESSING_FAILED} record
     * tells them which message it was.
     */
    private static final int MAX_ATTEMPTS = 3;

    /** Initial back-off, doubled per attempt. */
    private static final long BASE_BACKOFF_MS = 200;

    private final RedisConnectionFactory connectionFactory;
    private final RedisEventBus eventBus;
    private final EventProcessingService processor;
    private final List<String> topics;
    private final String deadLetterTopic;

    /** The dedicated connection held open for SUBSCRIBE; null until started. */
    private volatile RedisConnection subscriptionConnection;

    /** Guards the started flag so a restart cannot register the listener twice. */
    private final AtomicBoolean started = new AtomicBoolean(false);

    public RedisTopicSubscriber(RedisConnectionFactory connectionFactory,
                                RedisEventBus eventBus,
                                EventProcessingService processor,
                                EventPipelineProperties properties,
                                @Value("${app.events.consumer-pattern}") String consumerPattern) {
        this.connectionFactory = connectionFactory;
        this.eventBus = eventBus;
        this.processor = processor;
        this.topics = Arrays.stream(consumerPattern.split(","))
                .map(String::trim)
                .filter(topic -> !topic.isEmpty())
                .toList();
        this.deadLetterTopic = properties.failureTopic() + ".DLT";
    }

    /**
     * Starts the subscription on a dedicated connection.
     *
     * <p>SUBSCRIBE puts a Redis connection into a mode that blocks it for everything
     * else, so it cannot share the connection used for publishing. A failure to
     * subscribe is logged rather than fatal: the API must keep serving (writes still
     * commit and their payloads still land in the list), and the reason is stated so an
     * operator can see why commands are not being applied.
     */
    @Override
    public void afterPropertiesSet() {
        try {
            RedisConnection connection = connectionFactory.getConnection();
            connection.subscribe(this, topics.stream()
                    .map(topic -> topic.getBytes(StandardCharsets.UTF_8))
                    .toArray(byte[][]::new));
            subscriptionConnection = connection;
            started.set(true);
            log.info("Subscribed to {} for command ingest: {}", topics.size(), topics);
        } catch (RuntimeException e) {
            log.error("Could not subscribe to {} ({}). Commands are still published, but they " +
                      "will not be applied until Redis is reachable and the application restarts.",
                    topics, e.getMessage());
        }
    }

    @Override
    public void destroy() {
        RedisConnection connection = subscriptionConnection;
        subscriptionConnection = null;
        started.set(false);
        if (connection != null) {
            try {
                connection.close();
            } catch (RuntimeException e) {
                log.debug("Closing the subscription connection failed: {}", e.getMessage());
            }
        }
    }

    /**
     * One delivered message.
     *
     * <p>The topic is taken from the channel name, not from the envelope, so a message
     * cannot claim to have arrived somewhere it did not.
     */
    @Override
    public void onMessage(Message message, byte[] pattern) {
        String topic = new String(message.getChannel(), StandardCharsets.UTF_8);
        String body = new String(message.getBody(), StandardCharsets.UTF_8);

        RuntimeException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                processor.onEvent(topic, body);
                return;
            } catch (RuntimeException e) {
                lastFailure = e;
                if (!isRetryable(e) || attempt == MAX_ATTEMPTS) {
                    break;
                }
                log.warn("Attempt {}/{} to apply a message on {} failed ({}); retrying",
                        attempt, MAX_ATTEMPTS, topic, e.getMessage());
                if (!sleep(BASE_BACKOFF_MS << (attempt - 1))) {
                    break;
                }
            }
        }

        // Out of attempts (or unrecoverable): park it rather than lose it silently.
        deadLetter(topic, body, lastFailure);
    }

    /**
     * Whether another attempt could plausibly succeed.
     *
     * <p>{@link IllegalArgumentException} is what the processor throws for a body that is
     * not an envelope, and what the pipeline throws for an unknown enum value. Neither
     * can become valid, so retrying would only delay the dead-letter step.
     */
    private static boolean isRetryable(RuntimeException failure) {
        return !(failure instanceof IllegalArgumentException);
    }

    /**
     * Copies the message to {@code <failure-topic>.DLT}.
     *
     * <p>The original is not deleted — pub/sub has nothing to delete — but the
     * dead-letter copy is what an operator watches, and it survives in the list under
     * that topic.
     */
    private void deadLetter(String topic, String body, RuntimeException failure) {
        try {
            eventBus.publishRaw(deadLetterTopic, body);
            log.error("Message on {} exhausted its retries and was dead-lettered to {} ({})",
                    topic, deadLetterTopic,
                    failure == null ? "unknown failure" : failure.getMessage());
        } catch (RuntimeException e) {
            log.error("Could not dead-letter a poisoned message from {} ({}); its payload is " +
                      "still readable in {}{}", topic, e.getMessage(),
                    RedisEventBus.PAYLOAD_KEY_PREFIX, topic);
        }
    }

    /** @return false when the thread was interrupted, so the caller stops retrying. */
    private static boolean sleep(long millis) {
        try {
            Thread.sleep(millis);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }


    public List<String> subscribedTopics() {
        return topics;
    }

    public boolean isStarted() {
        return started.get();
    }
}
