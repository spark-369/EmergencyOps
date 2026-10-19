package com.pstu.backend.pipeline;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pstu.backend.entity.PipelineEventRecord;
import com.pstu.backend.entity.PipelineEventRecord.DeliveryStatus;
import com.pstu.backend.entity.PipelineEventRecord.MessageKind;
import com.pstu.backend.repository.PipelineEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;

/**
 * Durable home of every event until the broker has acknowledged it.
 *
 * <p>Writing and publishing are deliberately separate transactions:
 *
 * <ol>
 *   <li>{@link #store} joins the caller's transaction, so the event row commits
 *       atomically with the aggregate change.</li>
 *   <li>{@link #markPublished} / {@link #markFailed} run in
 *       {@link Propagation#REQUIRES_NEW}: a failed send must not roll back the
 *       business change, and a successful send must persist its receipt even if
 *       a later step in the same request fails.</li>
 * </ol>
 *
 * <p>This is the "transactional outbox" half of the design; {@link EventPublisher}
 * is the "at-least-once delivery" half.
 */
@Component
public class EventStore {

    private static final Logger log = LoggerFactory.getLogger(EventStore.class);

    /** Column limit for {@code lastError}; longer messages are truncated. */
    private static final int MAX_ERROR_LENGTH = 480;

    /**
     * Bytes of the *root cause* kept when a message is truncated.
     *
     * <p>The tail is what matters for a Kafka failure: the client's message leads
     * with a multi-line "Expiring N record(s) for …" summary and only ends with
     * {@code Caused by: …}, which is the part that names the actual fault
     * (connection refused, unknown topic, authorization). Truncating from the front
     * kept the noise and discarded the answer, so a row's {@code lastError} read
     * like a timeout even when the broker had actively rejected the record.
     */
    private static final int ROOT_CAUSE_TAIL = 300;

    private final PipelineEventRepository repository;
    private final ObjectMapper objectMapper;

    public EventStore(PipelineEventRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    /**
     * Persists {@code envelope} in the current transaction (or starts one if the
     * caller has none) and returns the stored row as {@code PENDING}.
     */
    @Transactional
    public PipelineEventRecord store(EventEnvelope envelope) {
        return store(envelope, DeliveryStatus.PENDING, null, MessageKind.OUTBOUND);
    }

    /**
     * Records a failure fact in its own transaction.
     *
     * <p>Called from a {@code catch} block whose transaction is about to roll
     * back; joining it would delete the record along with the failed write. This
     * is the one place that must survive the rollback, because the failure is the
     * only evidence left of what arrived.
     *
     * <p>Marked {@code PUBLISHED} <em>and</em> {@link MessageKind#FAILURE}: this row
     * is a log of something that went wrong, not an outbound event. The kind is what
     * actually keeps it out of the relay's queue (the relay only selects
     * {@link MessageKind#OUTBOUND}); the status is set as well so an operator reading
     * the timeline sees a row that is settled rather than waiting. Leaving it
     * {@code PENDING} once made every broker hiccup emit a failure record that then
     * retried to exhaustion, holding the health probe at {@code ATTENTION} for a
     * problem that was already over — the alarm must describe the <em>outbound</em>
     * backlog, not the log of past problems.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public PipelineEventRecord storeIndependently(EventEnvelope envelope) {
        return store(envelope, DeliveryStatus.PUBLISHED, Instant.now(), MessageKind.FAILURE);
    }

    /**
     * Records an inbound command as already delivered.
     *
     * <p>This is the consumer-side idempotency marker. The {@code PROCESSED} kind is
     * what stops the relay echoing the command back onto its topic — the relay
     * selects {@link MessageKind#OUTBOUND} only. {@code PUBLISHED} is recorded as
     * well so the row reads as settled in the timeline rather than as an event that
     * is still owed to a broker.
     */
    @Transactional
    public PipelineEventRecord recordProcessed(EventEnvelope command) {
        return store(command, DeliveryStatus.PUBLISHED, Instant.now(), MessageKind.PROCESSED);
    }

    @Transactional
    public PipelineEventRecord store(EventEnvelope envelope, DeliveryStatus status,
                                     Instant publishedAt, MessageKind kind) {
        String json;
        try {
            json = objectMapper.writeValueAsString(envelope);
        } catch (JsonProcessingException e) {
            // A payload Jackson cannot serialize is a programming error: fail the
            // caller's transaction rather than persisting something unreplayable.
            throw new IllegalStateException(
                    "Event " + envelope.type() + " (" + envelope.eventId() + ") is not serializable", e);
        }

        PipelineEventRecord record = PipelineEventRecord.builder()
                .eventId(envelope.eventId())
                .eventType(envelope.type())
                .aggregateId(envelope.aggregateId())
                .partitionKey(envelope.partitionKey())
                .correlationId(envelope.correlationId())
                .payload(json)
                .status(status)
                .kind(kind)
                .publishedAt(publishedAt)
                .occurredAt(envelope.occurredAt())
                .build();
        return repository.save(record);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markPublished(PipelineEventRecord record) {
        // Reload inside this transaction: the instance handed in may be detached
        // (written by a request thread) or managed by an outer transaction, and
        // saving that stale copy would undo the other side's attempt counter.
        PipelineEventRecord current = reload(record);
        current.setStatus(DeliveryStatus.PUBLISHED);
        /*
         * Set only on the first successful acknowledgement. A row can be delivered
         * more than once (relay re-offer, manual replay, at-least-once redelivery),
         * and `publishedAt` is meant to answer "when did this fact first reach the
         * broker" — overwriting it on every redelivery would make the audit trail
         * claim the event was published later than it was.
         */
        if (current.getPublishedAt() == null) {
            current.setPublishedAt(Instant.now());
        }
        current.setLastError(null);
        // The budget no longer matters once the broker has the event; leaving the
        // flag set would keep the row counted as "waiting" in the operator view.
        current.setExhausted(false);
        current.setPublishAttempts(current.getPublishAttempts() + 1);
        repository.save(current);
    }

    /**
     * Records a failed attempt.
     *
     * <p>Deliberately leaves {@link DeliveryStatus#PENDING} alone once the retry
     * budget is spent: the broker has still not acknowledged the event, so moving
     * the row to {@code GAVE_UP} made the column claim something untrue and put the
     * row in a state the relay only re-offers through a special "exhausted" query.
     * The budget is recorded in {@code exhausted} instead, which is what the health
     * probe and the console read. The row therefore stays in the pending queue and
     * is retried on every pass until a broker accepts it.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailed(PipelineEventRecord record, Throwable failure, int maxAttempts) {
        PipelineEventRecord current = reload(record);
        /*
         * A row that had already given up is being retried, so its counter restarts.
         * Without this it would sit at the limit and be re-flagged on the first
         * failure, making the retry pointless.
         */
        int base = current.isExhausted() ? 0 : current.getPublishAttempts();
        int attempts = base + 1;
        current.setPublishAttempts(attempts);
        current.setLastError(truncate(failure));
        if (attempts >= maxAttempts && !current.isExhausted()) {
            current.setExhausted(true);
            log.error("Event {} failed {} time(s) and is now marked exhausted; it stays queued " +
                      "and is retried every relay pass until the broker accepts it",
                    current.getEventId(), attempts);
        }
        repository.save(current);
    }

    /**
     * Parks a row whose payload cannot be decoded.
     *
     * <p>Distinct from {@link #markFailed}: that records a delivery attempt that may
     * succeed later, whereas this is an unreadable row that can never be published.
     * Parking it as {@code FAILED} removes it from the retry loop, so a single
     * corrupt payload no longer keeps the health probe at {@code ATTENTION} forever.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void parkUnreadable(PipelineEventRecord record, Throwable failure) {
        PipelineEventRecord current = reload(record);
        current.setStatus(DeliveryStatus.FAILED);
        current.setLastError(truncate(failure));
        repository.save(current);
    }

    /**
     * Fresh copy of {@code record} from the database, falling back to the argument
     * when the row is not (yet) visible — a publish can only be acknowledged after
     * the storing transaction committed, so the fallback is defensive.
     */
    private PipelineEventRecord reload(PipelineEventRecord record) {
        if (record.getId() == null) {
            return record;
        }
        return repository.findById(record.getId()).orElse(record);
    }

    @Transactional(readOnly = true)
    public Optional<EventEnvelope> find(String eventId) {
        return repository.findByEventId(eventId).map(this::deserialize);
    }

    /**
     * Rebuilds the envelope from the stored JSON. The serialized form is the source
     * of truth: replaying from columns would publish a payload shaped by today's
     * code, not by the code that committed the fact.
     */
    public EventEnvelope deserialize(PipelineEventRecord record) {
        try {
            return objectMapper.readValue(record.getPayload(), EventEnvelope.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(
                    "Stored event " + record.getEventId() + " is not a valid envelope", e);
        }
    }

    private static String truncate(Throwable failure) {
        String message = failure == null ? "unknown error" : failure.getMessage();
        if (message == null) {
            message = failure.getClass().getSimpleName();
        }
        if (message.length() <= MAX_ERROR_LENGTH) {
            return message;
        }
        // Keep the head (which failure/record) and the tail (which cause); see
        // ROOT_CAUSE_TAIL for why the tail is the part that matters.
        String tail = message.substring(message.length() - ROOT_CAUSE_TAIL);
        String head = message.substring(0, MAX_ERROR_LENGTH - ROOT_CAUSE_TAIL - 5);
        return head + " … " + tail;
    }
}
