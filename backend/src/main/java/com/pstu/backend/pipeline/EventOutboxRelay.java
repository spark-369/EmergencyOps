package com.pstu.backend.pipeline;

import com.pstu.backend.entity.PipelineEventRecord;
import com.pstu.backend.entity.PipelineEventRecord.DeliveryStatus;
import com.pstu.backend.entity.PipelineEventRecord.MessageKind;
import com.pstu.backend.repository.PipelineEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Finds the outbox rows Redis has not been told about, and re-enqueues them.
 *
 * <p><strong>What changed with Redis + JobRunr.</strong> This class used to publish
 * inline: the scheduled pass deserialised each pending row and called the Kafka
 * producer, blocking for the acknowledgement. Now it only <em>schedules</em>: every
 * row that still needs delivering gets a JobRunr delivery job
 * ({@link EventJobScheduling#scheduleDelivery}), and {@link EventDeliveryJob} does
 * the Redis write. That split is the point — a sweep is now a cheap database query
 * plus N enqueue calls, so it can no longer park a thread on a dead transport, and a
 * row it enqueues twice is de-duplicated by JobRunr's job id.
 *
 * <p><strong>Its job is narrower than it was.</strong> The publisher queues a
 * delivery job the moment a row commits, so the common case never waits for this
 * sweeper. This exists for rows whose job never completed: JobRunr discarded it after
 * its retries, the application died between the commit and the enqueue, or Redis was
 * down when the job was scheduled.
 *
 * <p>Rows that exhaust their retry budget are marked {@code exhausted} rather than
 * moved to a terminal status, so they stay in the pending queue and are re-offered on
 * every sweep: the cause is nearly always a transport outage, and the state must
 * clear itself once Redis returns.
 *
 * <p>Disabled in tests ({@code app.events.outbox-relay.enabled=false}) because a
 * sweeper firing at a mocked transport only adds noise.
 */
@Component
@ConditionalOnProperty(name = "app.events.outbox-relay.enabled", havingValue = "true", matchIfMissing = true)
public class EventOutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(EventOutboxRelay.class);

    /** Upper bound per sweep: keeps one backlog from creating unbounded jobs. */
    private static final int BATCH_SIZE = 100;

    /**
     * Smaller cap for rows that already exhausted their attempts: they are the
     * expensive case (previously failing), and a flood of them must not crowd out the
     * rows that have never been tried.
     */
    private static final int EXHAUSTED_BATCH_SIZE = 20;

    /**
     * Row cap for an operator-triggered flush.
     *
     * <p>Smaller than {@link #BATCH_SIZE} because the response has to arrive while a
     * human is waiting; the remaining rows are picked up by the next sweep.
     */
    private static final int HTTP_BATCH_SIZE = 10;

    private final PipelineEventRepository repository;
    private final EventStore eventStore;
    private final EventPublisher publisher;

    /**
     * Resolved lazily.
     *
     * <p>{@link EventJobScheduling} depends on this bean (to register the sweep), and
     * this bean needs to schedule jobs. Injecting it directly would make each bean a
     * construction dependency of the other and the context would fail with a circular
     * reference; {@code ObjectProvider} defers the lookup until the first sweep, by
     * which time both exist.
     */
    private final ObjectProvider<EventJobScheduling> scheduling;

    /**
     * Held for the duration of a sweep.
     *
     * <p>The recurring JobRunr job and the operator endpoint can both run one. Without
     * this they would select the same {@code PENDING} rows and enqueue duplicate work;
     * JobRunr de-duplicates by job id, but the count returned here would become
     * meaningless, so a sweep simply skips while one is running.
     */
    private final AtomicBoolean passGuard = new AtomicBoolean(false);

    public EventOutboxRelay(PipelineEventRepository repository,
                            EventStore eventStore,
                            EventPublisher publisher,
                            ObjectProvider<EventJobScheduling> scheduling) {
        this.repository = repository;
        this.eventStore = eventStore;
        this.publisher = publisher;
        this.scheduling = scheduling;
    }

    /**
     * Entry point invoked by the recurring JobRunr job.
     *
     * <p>Exceptions are caught rather than propagated: JobRunr would retry the whole
     * sweep on a broken database, and the backlog is untouched anyway — the next
     * scheduled run retries it.
     */
    public void sweep() {
        try {
            int queued = sweepOnce();
            if (queued > 0) {
                log.info("Outbox sweep queued {} delivery job(s)", queued);
            }
        } catch (RuntimeException e) {
            log.warn("Outbox sweep failed: {}", e.getMessage(), e);
        }
    }

    /**
     * One pass over the oldest pending rows.
     *
     * <p>Deliberately not {@code @Transactional}: it only reads the backlog and hands
     * each row to JobRunr, and the row mutations belong to {@link EventStore}'s own
     * transactions.
     *
     * @return how many delivery jobs were enqueued.
     */
    public int sweepOnce() {
        if (!passGuard.compareAndSet(false, true)) {
            log.debug("Outbox sweep skipped: another sweep is already running");
            return 0;
        }
        try {
            int queued = enqueue(repository.findPending(
                    MessageKind.OUTBOUND, DeliveryStatus.PENDING, PageRequest.of(0, BATCH_SIZE)));
            /*
             * A second, smaller batch of rows that previously exhausted their retries.
             * Once per sweep is enough: if Redis is still down they fail again cheaply,
             * and if it has recovered they are delivered and the health probe returns
             * to OK without operator intervention.
             */
            queued += enqueue(repository.findExhausted(
                    MessageKind.OUTBOUND, DeliveryStatus.GAVE_UP,
                    PageRequest.of(0, EXHAUSTED_BATCH_SIZE)));
            return queued;
        } finally {
            passGuard.set(false);
        }
    }

    /**
     * Enqueues one delivery job per row that still needs one.
     *
     * <p>Rows whose payload is unreadable are parked immediately: a corrupt row can
     * never be delivered, so queueing a job for it would only burn retries and keep the
     * health probe at {@code ATTENTION}.
     *
     * <p>The return value counts rows the scheduler <em>accepted</em>, and
     * {@code EventJobScheduling.scheduleDelivery} swallows its own failures (it is
     * designed for a post-commit hook, where throwing is worse than retrying later). It
     * therefore reports whether the job was actually enqueued, instead of letting this
     * loop claim a success for a row that never left the database.
     */
    private int enqueue(List<PipelineEventRecord> batch) {
        EventJobScheduling scheduler = scheduling.getObject();
        int queued = 0;
        for (PipelineEventRecord record : batch) {
            try {
                eventStore.deserialize(record);
            } catch (RuntimeException e) {
                log.error("Stored event {} cannot be decoded; parking it as FAILED",
                        record.getEventId(), e);
                eventStore.parkUnreadable(record, e);
                continue;
            }
            if (scheduler.scheduleDelivery(record.getEventId())) {
                queued++;
            }
        }
        return queued;
    }

    /**
     * A pass bounded by wall-clock time, for the operator endpoint.
     *
     * <p>Deliberately still synchronous: an operator pressing "flush" expects the
     * response to say what actually left, not what was queued. Each row is now a short
     * Redis round-trip rather than a producer send that could wait out a 120 s delivery
     * timeout, so the budget covers the {@link #HTTP_BATCH_SIZE} rows it may touch with
     * room to spare.
     *
     * @param budget how long this call may spend delivering
     * @return the number of rows delivered before the deadline
     */
    public int flushBounded(Duration budget) {
        if (!passGuard.compareAndSet(false, true)) {
            // A sweep is already enqueueing jobs; the operator gets a truthful
            // "0 delivered" instead of a second concurrent pass.
            log.debug("Operator flush skipped: a sweep is already running");
            return 0;
        }
        try {
            Deadline deadline = Deadline.after(budget);
            int delivered = publisher.deliverBatch(repository.findPending(
                            MessageKind.OUTBOUND, DeliveryStatus.PENDING, PageRequest.of(0, HTTP_BATCH_SIZE)),
                    deadline::expired);
            delivered += publisher.deliverBatch(repository.findExhausted(
                            MessageKind.OUTBOUND, DeliveryStatus.GAVE_UP, PageRequest.of(0, HTTP_BATCH_SIZE)),
                    deadline::expired);
            return delivered;
        } finally {
            passGuard.set(false);
        }
    }

    /**
     * Events Redis has not acknowledged — the real backlog.
     *
     * <p>Counts outbound rows regardless of whether they have exhausted their budget,
     * because in both cases Redis still does not have the fact. This is what "pending"
     * has to mean for the health indicator to be useful: a row must not leave the count
     * the moment it is flagged {@code GAVE_UP}, or an outage would make the backlog
     * appear to *shrink* as it got worse.
     */
    public long pendingCount() {
        return repository.countAwaitingDelivery(
                MessageKind.OUTBOUND, DeliveryStatus.PUBLISHED, DeliveryStatus.FAILED);
    }

    /**
     * Outbound rows that burned through their retry budget and are still
     * unacknowledged.
     *
     * <p>This is the "look at me" number, not a terminal state: the sweep keeps
     * re-offering these, and the count returns to zero once Redis accepts them.
     */
    public long gaveUpCount() {
        return repository.countExhaustedUndelivered(MessageKind.OUTBOUND, DeliveryStatus.PUBLISHED);
    }

    /** Facts that reached Redis. Bookkeeping rows are excluded. */
    public long publishedCount() {
        return repository.countOutboundByStatus(MessageKind.OUTBOUND, DeliveryStatus.PUBLISHED);
    }

    /**
     * Rows parked as undeliverable (corrupt payload).
     *
     * <p>Reported separately from {@link #gaveUpCount()}: these are not a transport
     * problem and will never clear on their own, so lumping them into the delivery
     * state would leave the indicator red for a reason the operator cannot fix by
     * waiting.
     */
    public long failedCount() {
        return repository.countByStatus(DeliveryStatus.FAILED);
    }

    /**
     * A wall-clock budget for one pass.
     *
     * <p>A small value type rather than passing an {@code Instant} around: it keeps
     * the arithmetic in one place and makes the overflow case explicit. Only the
     * HTTP-triggered flush needs a budget now — the JobRunr sweep does not deliver
     * inline at all, so there is no "unbounded" variant left to represent.
     */
    private record Deadline(long expiresAtNanos) {

        static Deadline after(Duration budget) {
            long now = System.nanoTime();
            // Guard against overflow: a very large budget must not wrap negative and
            // report an already-expired deadline.
            long nanos = budget.toNanos();
            return new Deadline(nanos >= Long.MAX_VALUE - now ? Long.MAX_VALUE : now + nanos);
        }

        boolean expired() {
            return System.nanoTime() - expiresAtNanos >= 0;
        }
    }
}
