package com.pstu.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pstu.backend.pipeline.CorrelationIdFilter;
import com.pstu.backend.pipeline.EmergencyEventPipeline;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventStore;
import com.pstu.backend.pipeline.RedisTopicSubscriber;
import com.pstu.backend.repository.PipelineEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ingest loop: parse, deduplicate, delegate.
 *
 * <p>It contains no business rules — {@link EmergencyEventPipeline} owns those — and no
 * transport code either, so the same commands can be driven from a test or another
 * transport without a broker.
 *
 * <p><strong>Which topics.</strong> The subscriber listens only on
 * {@code app.events.consumer-pattern}, the explicit list of topics this application
 * consumes. A wildcard form previously matched {@code emergency.processing-failures.v1},
 * so the service consumed its own failure log and re-read every failed record the moment
 * it was written; a new fact topic is therefore added deliberately, not picked up
 * implicitly.
 *
 * <p><strong>Failure semantics.</strong> The method runs in a transaction, so an
 * exception rolls back the database write. {@link RedisTopicSubscriber} owns what
 * happens next: retry with back-off, then leave the message on the dead-letter stream
 * rather than acknowledge it as done.
 */
@Service
public class EventProcessingService {

    private static final Logger log = LoggerFactory.getLogger(EventProcessingService.class);

    private final EmergencyEventPipeline pipeline;
    private final EventStore eventStore;
    private final PipelineEventRepository pipelineEventRepository;
    private final ObjectMapper objectMapper;

    public EventProcessingService(EmergencyEventPipeline pipeline,
                                  EventStore eventStore,
                                  PipelineEventRepository pipelineEventRepository,
                                  ObjectMapper objectMapper) {
        this.pipeline = pipeline;
        this.eventStore = eventStore;
        this.pipelineEventRepository = pipelineEventRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Applies one inbound message.
     *
     * <p>Transport-agnostic: it takes the topic and the raw JSON body rather than a
     * broker record. {@link RedisTopicSubscriber} is the only caller today; a test can
     * call it with a string, which is why the delivery mechanics (acknowledgement,
     * retry, dead-letter) live in the subscriber and not here.
     *
     * <p>The method runs in a transaction, so an exception rolls back the database
     * write and the subscriber sees the failure and retries.
     */
    @Transactional
    public void onEvent(String topic, String body) {
        EventEnvelope envelope = null;
        try {
            envelope = parse(body, topic);
            CorrelationIdFilter.bind(envelope.correlationId());
            log.debug("Received {} for {} on {}", envelope.type(), envelope.aggregateId(), topic);

            if (!envelope.type().isCommand()) {
                log.trace("Skipping non-command {} on {}", envelope.type(), topic);
                return;
            }
            if (pipelineEventRepository.existsByEventId(envelope.eventId())) {
                log.info("Duplicate delivery of {} ({}); skipping", envelope.type(), envelope.eventId());
                return;
            }

            String effect = pipeline.handle(envelope);
            // Idempotency marker: recorded in the same transaction as the write it
            // triggered, as PUBLISHED so the sweep never re-delivers the command.
            eventStore.recordProcessed(envelope);
            log.debug("Applied {} -> {}", envelope.type(), effect);
        } catch (RuntimeException e) {
            log.error("Processing a message on {} failed: {}", topic, e.getMessage(), e);
            if (envelope != null) {
                safeReportFailure(envelope, e);
            }
            throw e;
        } finally {
            CorrelationIdFilter.clear();
        }
    }

    /**
     * Decodes the message body.
     *
     * <p>{@code ObjectMapper.readValue} throws the checked
     * {@link JsonProcessingException}, which this method must not declare: the only
     * caller is the subscriber's message callback, which cannot rethrow a checked
     * exception usefully.
     *
     * <p>The parse failure is converted into an {@link IllegalArgumentException}, which
     * {@code RedisTopicSubscriber} treats as <em>not retryable</em>: a body that is not a
     * valid envelope can never become valid, so it belongs on the dead-letter stream on
     * the first attempt rather than after a retry cycle.
     */
    private EventEnvelope parse(String body, String topic) {
        try {
            return objectMapper.readValue(body, EventEnvelope.class);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException(
                    "Message on %s is not a valid event envelope: %s"
                            .formatted(topic, e.getOriginalMessage()),
                    e);
        }
    }

    private void safeReportFailure(EventEnvelope envelope, Exception failure) {
        try {
            pipeline.reportFailure(envelope, failure);
        } catch (RuntimeException reportingFailure) {
            log.warn("Could not record processing failure for {}: {}",
                    envelope.eventId(), reportingFailure.getMessage());
        }
    }
}
