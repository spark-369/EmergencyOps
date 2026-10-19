package com.pstu.backend.pipeline;

import com.pstu.backend.entity.PipelineEventRecord;
import com.pstu.backend.entity.PipelineEventRecord.DeliveryStatus;
import com.pstu.backend.repository.PipelineEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * The body of a JobRunr delivery job: publish one outbox row to Redis.
 *
 * <p><strong>Job identity.</strong> {@link EventJobScheduling} enqueues with a job id
 * derived from the event id ({@link EventJobScheduling#jobIdFor}), not the event id
 * itself. JobRunr refuses a duplicate id, so enqueueing the same
 * row twice — the publisher's after-commit hook and a relay sweep racing, or a
 * sweep running while the first attempt is still executing — cannot produce two
 * delivery jobs. That is the property the old in-memory executor did not have.
 *
 * <p><strong>Idempotent by status.</strong> A job can be re-queued after a restart
 * even though its first attempt already published (JobRunr may consider a job lost
 * if the process died between the Redis write and the job's state update). The row's
 * status is therefore re-read here: a row that is already {@code PUBLISHED} is
 * skipped instead of re-sent. Delivery is still at-least-once overall — a crash
 * between the Redis write and {@code markPublished} produces exactly one duplicate —
 * which is why consumers must deduplicate on {@code eventId}, exactly as before.
 *
 * <p><strong>Failure.</strong> A {@code false} from the bus means a transport
 * failure. The exception is rethrown so JobRunr schedules a retry with exponential
 * back-off; the outbox row is marked failed here first, so the relay and the health
 * endpoint see the failure even while JobRunr is still retrying.
 */
@Component
public class EventDeliveryJob {

    private static final Logger log = LoggerFactory.getLogger(EventDeliveryJob.class);

    private final PipelineEventRepository repository;
    private final EventStore eventStore;
    private final RedisEventBus eventBus;

    public EventDeliveryJob(PipelineEventRepository repository,
                            EventStore eventStore,
                            RedisEventBus eventBus) {
        this.repository = repository;
        this.eventStore = eventStore;
        this.eventBus = eventBus;
    }

    /**
     * Delivers the row identified by {@code eventId}.
     *
     * <p>Not transactional: the Redis write is not part of a database transaction, and
     * holding one open across a network call is exactly what the outbox design avoids.
     * {@code markPublished} commits on its own.
     *
     * <p><strong>The MDC is restored, not merely cleared.</strong> JobRunr runs several
     * jobs on the same worker thread, so leaving this event's correlation id on the
     * thread would stamp the next job's log lines with the wrong trace. {@code bind}
     * returns the previous value precisely so the caller can put it back.
     */
    public void deliver(String eventId) {
        Optional<PipelineEventRecord> found = repository.findByEventId(eventId);
        if (found.isEmpty()) {
            // The row was deleted (an incident purge, an operator cleanup). Nothing to
            // deliver and nothing to retry.
            log.debug("Delivery job for unknown event {} ignored", eventId);
            return;
        }

        PipelineEventRecord record = found.get();
        if (record.getStatus() == DeliveryStatus.PUBLISHED) {
            // A duplicate job, or a restart after the write but before the job's state
            // update. Re-sending would deliver the same fact twice.
            log.debug("Event {} already delivered; job is a duplicate", eventId);
            return;
        }

        EventEnvelope envelope;
        try {
            envelope = eventStore.deserialize(record);
        } catch (RuntimeException e) {
            // The stored payload is unreadable; retrying cannot fix it. Park the row the
            // same way the publisher and the sweep do, then stop.
            log.error("Stored event {} cannot be decoded; parking it as FAILED", eventId, e);
            eventStore.parkUnreadable(record, e);
            return;
        }

        String previousCorrelationId = CorrelationIdFilter.bind(envelope.correlationId());
        try {
            if (eventBus.publish(envelope)) {
                eventStore.markPublished(record);
                log.debug("Delivered {} for {} (event {})",
                        envelope.type(), envelope.aggregateId(), eventId);
                return;
            }
            /*
             * The transport refused the publish (Redis unreachable, or it rejected the
             * write). Handled by the catch below so the failure is recorded exactly once.
             */
            throw new IllegalStateException("Redis refused the publish of event " + eventId);
        } catch (RuntimeException e) {
            /*
             * One place records the attempt: the row's counter and lastError must reflect
             * every retry, and marking twice for the same attempt would double-count.
             * `Integer.MAX_VALUE` keeps the row permanently retryable — JobRunr's
             * back-off is the retry policy now, so the row must never be flagged
             * "exhausted" and fall out of the sweep.
             */
            log.warn("Delivery of event {} failed ({}); JobRunr will retry", eventId, e.getMessage());
            eventStore.markFailed(record, e, Integer.MAX_VALUE);
            throw e;
        } finally {
            if (previousCorrelationId == null) {
                CorrelationIdFilter.clear();
            } else {
                CorrelationIdFilter.bind(previousCorrelationId);
            }
        }
    }
}
