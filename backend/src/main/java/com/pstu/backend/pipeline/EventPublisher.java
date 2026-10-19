package com.pstu.backend.pipeline;

import com.pstu.backend.entity.PipelineEventRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;
import java.util.function.BooleanSupplier;

/**
 * Hands a stored event to the transport, durably and after commit.
 *
 * <p><strong>When.</strong> If a transaction is active the hand-off is deferred to
 * {@code afterCommit}: publishing inside the transaction would let a consumer observe
 * a fact that is about to roll back. With no transaction (the relay, replays) the
 * hand-off starts immediately.
 *
 * <p><strong>How.</strong> The row is already committed, so delivery is enqueued as a
 * <em>JobRunr background job</em> instead of running on the caller's thread. That is
 * the upgrade from the previous design: an in-memory executor task died with the
 * process, whereas JobRunr persists the job in the database, retries it with back-off,
 * and resumes it after a restart. The job id is derived from the event id, so the
 * after-commit enqueue and a concurrent relay sweep collapse into a single job.
 *
 * <p><strong>The transport.</strong> {@link RedisEventBus} writes the payload to a
 * capped per-topic list and publishes a notification on the topic's channel. This class
 * does not know that; it only knows "deliver this record and tell me whether it
 * worked", which keeps the operator flush, a replay and the background job on one code
 * path.
 *
 * <p><strong>Failure.</strong> Nothing here propagates to the caller. A scheduling
 * failure leaves the row {@code PENDING} for the relay; a delivery failure is recorded
 * on the row itself. That is the trade-off of the outbox — the HTTP request reports its
 * own outcome, the event guarantees eventual delivery.
 */
@Component
public class EventPublisher {

    private static final Logger log = LoggerFactory.getLogger(EventPublisher.class);

    private final EventStore eventStore;
    private final EventJobScheduling scheduling;
    private final RedisEventBus eventBus;

    public EventPublisher(EventStore eventStore,
                          EventJobScheduling scheduling,
                          RedisEventBus eventBus) {
        this.eventStore = eventStore;
        this.scheduling = scheduling;
        this.eventBus = eventBus;
    }

    /**
     * Runs {@code action} after the current transaction commits, or immediately
     * when there is none. Exposed so callers can attach other side effects to the
     * same guarantee.
     */
    public void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        action.run();
                    } catch (RuntimeException e) {
                        // afterCommit runs after the commit itself: an exception
                        // escaping here is reported as a commit failure even
                        // though the data is already durable.
                        log.warn("Post-commit action failed: {}", e.getMessage(), e);
                    }
                }
            });
        } else {
            action.run();
        }
    }

    /** Stores {@code envelope} with the caller's transaction and schedules delivery. */
    public EventEnvelope publish(EventEnvelope envelope) {
        PipelineEventRecord record = eventStore.store(envelope);
        /*
         * Delivered off the request thread. The row is already committed with the
         * aggregate, so the fact cannot be lost, and enqueueing a job is itself a Redis
         * write with no business delaying the HTTP response.
         */
        afterCommit(() -> scheduling.scheduleDelivery(record.getEventId()));
        log.debug("Queued {} for {} (correlationId={})", envelope.type(), envelope.aggregateId(),
                envelope.correlationId());
        return envelope;
    }

    /**
     * Publishes a bounded batch synchronously — used by the operator's "flush
     * outbox" action, where the caller wants to know what actually left.
     *
     * <p>The deadline is checked <em>before</em> each row, never mid-write, so a row is
     * never left half-delivered. Stopping between rows bounds the overrun to one Redis
     * round-trip rather than the whole batch.
     *
     * @param batch   the rows to attempt
     * @param stopNow returns true once the caller's time budget is spent
     * @return how many rows were published
     */
    public int deliverBatch(List<PipelineEventRecord> batch, BooleanSupplier stopNow) {
        int delivered = 0;
        for (PipelineEventRecord record : batch) {
            if (stopNow.getAsBoolean()) {
                log.info("Flush stopped at its time budget with {} row(s) delivered; " +
                        "the sweep continues with the remainder", delivered);
                break;
            }
            EventEnvelope envelope;
            try {
                envelope = eventStore.deserialize(record);
            } catch (RuntimeException e) {
                /*
                 * Only the decode is unrecoverable: a payload that is not a valid
                 * envelope can never become one. Park it as FAILED rather than flagging
                 * it exhausted, because exhausted means "will be retried".
                 */
                log.error("Stored event {} cannot be decoded; parking it as FAILED",
                        record.getEventId(), e);
                try {
                    eventStore.parkUnreadable(record, e);
                } catch (RuntimeException markingFailure) {
                    log.warn("Could not park event {}: {}",
                            record.getEventId(), markingFailure.getMessage());
                }
                continue;
            }
            if (deliver(record, envelope)) {
                delivered++;
            }
        }
        return delivered;
    }

    /**
     * Publishes {@code envelope} now and records the outcome.
     *
     * <p>The single place that knows how to publish, so the operator flush, a replay
     * and {@link EventDeliveryJob} share one failure semantics.
     *
     * @return {@code true} when Redis acknowledged the write.
     */
    public boolean deliver(PipelineEventRecord record, EventEnvelope envelope) {
        String previousCorrelationId = CorrelationIdFilter.bind(envelope.correlationId());
        try {
            if (!eventBus.publish(envelope)) {
                throw new IllegalStateException("Redis did not accept the publish");
            }
            eventStore.markPublished(record);
            /*
             * Logged at debug by design (one line per event would be noise in
             * production), but it is the line that answers "is anything ever
             * delivered?", so it exists at all.
             */
            log.debug("Delivered {} for {} (event {})",
                    envelope.type(), envelope.aggregateId(), envelope.eventId());
            return true;
        } catch (RuntimeException e) {
            /*
             * The reason is recorded on the row, not just logged: the relay and the
             * health endpoint read it, and "failed" without a cause leaves an operator
             * unable to tell a wrong Redis address from a full instance.
             */
            log.warn("Delivery of {} for {} failed ({}); left for the outbox sweep",
                    envelope.type(), envelope.aggregateId(), rootCauseMessage(e));
            eventStore.markFailed(record, e,
                    // The background job owns the retry policy, so the row's "exhausted"
                    // flag is not what limits attempts any more; it stays pending until
                    // Redis accepts the write.
                    Integer.MAX_VALUE);
            return false;
        } finally {
            if (previousCorrelationId == null) {
                CorrelationIdFilter.clear();
            } else {
                CorrelationIdFilter.bind(previousCorrelationId);
            }
        }
    }

    /** Unwraps the wrapper exceptions so the stored error names the real cause. */
    static String rootCauseMessage(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current.getClass().getSimpleName() + ": " + current.getMessage();
    }
}
