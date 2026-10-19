package com.pstu.backend.pipeline;

import com.pstu.backend.config.EventPipelineProperties;
import org.jobrunr.jobs.JobId;
import org.jobrunr.scheduling.JobScheduler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;

/**
 * Hands pipeline work to JobRunr.
 *
 * <p>Two things are scheduled:
 *
 * <ul>
 *   <li><strong>One delivery job per outbox row</strong> — enqueued by
 *       {@link #scheduleDelivery} from {@link EventPublisher} after commit and from the
 *       relay sweep.</li>
 *   <li><strong>The relay sweep</strong> — a recurring job that picks up rows whose
 *       delivery job never completed. Recurring schedules live in JobRunr's store, so the
 *       sweep survives a restart instead of restarting its timer.</li>
 * </ul>
 *
 * <p><strong>Why lambdas rather than a job class holding a bean.</strong> JobRunr
 * serialises a job at enqueue time and deserialises it when it runs, so whatever the job
 * captures travels into the job store. Capturing {@link EventDeliveryJob} would drag its
 * repository, event store and Redis template along with it — every delivery job would
 * carry a graph of autowired beans. A lambda that only closes over the
 * <em>arguments</em> ({@code eventId}) keeps the stored job to a few bytes, and JobRunr
 * resolves the target bean from the application context when it executes it. That is the
 * pattern the JobRunr docs call out for Spring.</p>
 *
 * <p><strong>Why {@code scheduleDelivery} never throws.</strong> It is called from a
 * post-commit hook, where an escaping exception is reported as a commit failure even
 * though the data is already durable. A failed enqueue only delays the row to the next
 * sweep.</p>
 */
@Component
public class EventJobScheduling {

    private static final Logger log = LoggerFactory.getLogger(EventJobScheduling.class);

    /**
     * Identifier of the recurring sweep.
     *
     * <p>Stable on purpose: registering the schedule again on restart updates the existing
     * recurring job instead of creating a second one. The prefix also keeps it from
     * colliding with the per-event delivery ids in the same store.</p>
     */
    static final String OUTBOX_SWEEP_JOB_ID = "outbox-sweep";

    private final JobScheduler jobScheduler;
    private final EventDeliveryJob deliveryJob;
    private final EventPipelineProperties properties;

    /**
     * Resolved lazily, and that is load-bearing.
     *
     * <p>Injecting the relay directly closes a construction cycle:
     * {@code EventPublisher -> EventJobScheduling -> EventOutboxRelay -> EventPublisher}
     * (the relay needs the publisher to flush synchronously, and the publisher needs this
     * class to enqueue delivery jobs). Spring rejects that at startup.</p>
     *
     * <p>{@code ObjectProvider} defers the lookup to {@link #registerRecurringJobs()},
     * which runs on {@code ApplicationReadyEvent} — long after every singleton is built.
     * The cycle is broken without any of the three beans changing what it does, and without
     * {@code spring.main.allow-circular-references}, which would only hide the coupling
     * rather than remove it.</p>
     */
    private final ObjectProvider<EventOutboxRelay> relayProvider;

    public EventJobScheduling(JobScheduler jobScheduler,
                              EventDeliveryJob deliveryJob,
                              ObjectProvider<EventOutboxRelay> relayProvider,
                              EventPipelineProperties properties) {
        this.jobScheduler = jobScheduler;
        this.deliveryJob = deliveryJob;
        this.relayProvider = relayProvider;
        this.properties = properties;
    }

    /**
     * Enqueues one delivery job for {@code eventId}.
     *
     * <p>The first argument is a <em>job id</em>. Deriving it from the event id is the
     * idempotency story: JobRunr refuses an id that is already queued or running, so the
     * after-commit hook, a relay sweep and an operator replay collapse into a single
     * delivery.
     *
     * <p>The lambda closes over the event id only. JobRunr stores it as bytecode and
     * resolves {@link EventDeliveryJob} from the application context at execution time, so
     * no bean graph is written to Redis with every event.</p>
     *
     * <p>The job is deliberately <em>not</em> transactional: the row was committed before
     * this is called (that is the whole point of the outbox), and enqueueing inside the
     * transaction would hand a consumer a fact that could still roll back.</p>
     *
     * @return {@code true} when JobRunr accepted the job; {@code false} means the row is
     *         still {@code PENDING} and the next sweep will try again.
     */
    public boolean scheduleDelivery(String eventId) {
        try {
            JobId jobId = jobScheduler.enqueue(jobIdFor(eventId),
                    () -> deliveryJob.deliver(eventId));
            log.debug("Scheduled delivery job {} for event {}", jobId, eventId);
            return true;
        } catch (RuntimeException e) {
            // The job store is unreachable, or the id is already queued (JobRunr reports
            // that as an error). Either way the row is covered: the sweep retries it, or
            // it is already being delivered.
            log.warn("Could not schedule delivery for event {} ({}); the sweep will retry",
                    eventId, e.getMessage());
            return false;
        }
    }

    /**
     * Deterministic job id for an event's delivery job.
     *
     * <p>A version-3 UUID: stable for the same input and needing no coordination between
     * instances, so two nodes sweeping the same backlog cannot queue two jobs for one row.
     */
    static UUID jobIdFor(String eventId) {
        return UUID.nameUUIDFromBytes(("event-delivery:" + eventId).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Registers the recurring sweep once the context is ready.
     *
     * <p>{@code ApplicationReadyEvent} rather than {@code @PostConstruct}: the
     * background-job server is started by {@code JobRunrConfig} on the same event, so by
     * the time this runs a worker is already polling. Re-registering on restart is
     * safe — the id is stable, so JobRunr updates the existing schedule rather than
     * creating a second one.</p>
     *
     * <p>A failure is logged, not thrown: an unusable job store at startup must not stop
     * the API from serving, because every write still commits and lands in the outbox.</p>
     */
    @EventListener(ApplicationReadyEvent.class)
    public void registerRecurringJobs() {
        if (!properties.outboxRelayEnabled()) {
            // The relay is switched off (tests, or a deployment that only delivers
            // inline), so there is nothing for the sweep to do.
            log.info("Outbox sweep not registered (app.events.outbox-relay.enabled=false)");
            return;
        }
        /*
         * Resolved here, not in the constructor: see `relayProvider`. The bean can legitimately
         * be absent when the relay is disabled, in which case there is no sweep to register.
         */
        EventOutboxRelay relay = relayProvider.getIfAvailable();
        if (relay == null) {
            log.warn("Outbox sweep not registered: no EventOutboxRelay bean is present");
            return;
        }
        Duration interval = Duration.ofSeconds(properties.outboxSweepIntervalSeconds());
        try {
            jobScheduler.scheduleRecurrently(OUTBOX_SWEEP_JOB_ID, interval, relay::sweep);
            log.info("Outbox sweep scheduled every {}s (job {})",
                    interval.toSeconds(), OUTBOX_SWEEP_JOB_ID);
        } catch (RuntimeException e) {
            log.warn("Could not register the outbox sweep ({})", e.getMessage());
        }
    }
}

