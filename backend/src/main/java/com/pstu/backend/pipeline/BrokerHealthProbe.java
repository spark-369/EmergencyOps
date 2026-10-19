package com.pstu.backend.pipeline;

import com.pstu.backend.config.EventPipelineProperties;
import org.jobrunr.storage.StorageProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Reports, once at startup, whether Redis — the event transport — and JobRunr's job store
 * are reachable.
 *
 * <p>Without this, a misconfigured dependency is invisible until an operator notices
 * undelivered rows accumulating in {@code pipeline_events}. The symptom then reads like a
 * status-storage bug ("nothing ever reaches PUBLISHED") when it is a connection problem,
 * so this names the cause directly.</p>
 *
 * <p><strong>The two checks fail independently.</strong> Redis carries the payloads;
 * JobRunr keeps job state in PostgreSQL. A Redis outage leaves rows {@code PENDING} but
 * delivery jobs keep running and retrying. A job-store outage means rows are written and
 * enqueued but never executed, so the sweep is the only delivery path — which is why the
 * failure messages point at different causes.</p>
 *
 * <p>Deliberately advisory: it logs and returns. An outage must not stop the API from
 * serving, because the outbox exists precisely so writes survive one.</p>
 */
@Component
public class BrokerHealthProbe {

    private static final Logger log = LoggerFactory.getLogger(BrokerHealthProbe.class);

    private final RedisEventBus eventBus;
    private final StorageProvider jobStorage;
    private final EventPipelineProperties properties;

    public BrokerHealthProbe(RedisEventBus eventBus,
                             StorageProvider jobStorage,
                             EventPipelineProperties properties) {
        this.eventBus = eventBus;
        this.jobStorage = jobStorage;
        this.properties = properties;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void reportBrokerStatus() {
        try {
            eventBus.ping();
        } catch (RuntimeException e) {
            /*
             * The most valuable line in this class: it names the real fault instead of
             * leaving an operator to infer it from stuck outbox rows.
             */
            log.error("Redis is NOT reachable ({}). Every write still commits, but its event " +
                      "stays PENDING and is retried until Redis returns; check REDIS_HOST / " +
                      "REDIS_PORT and that the instance is up.",
                    rootCause(e));
            return;
        }

        /*
         * JobRunr stores jobs in PostgreSQL, not in Redis. Asking the provider for its
         * metadata proves the job tables are usable, not merely that the datasource
         * connects — a provider whose tables were never created would pass a connection
         * check and still fail every enqueue.
         */
        try {
            jobStorage.getStorageProviderInfo();
            log.info("Redis reachable; JobRunr job store ready for {} topic(s): {}",
                    properties.allTopics().size(), properties.allTopics());
        } catch (RuntimeException e) {
            log.error("JobRunr's job store is unusable ({}). Events are still written and " +
                      "attempted inline, but the background delivery jobs and the sweep cannot " +
                      "run; check that the 'jobrunr_*' tables exist and that " +
                      "jobrunr.database.skip-create matches how the schema is managed.",
                    rootCause(e));
        }
    }

    private static String rootCause(Throwable failure) {
        Throwable current = failure;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current.getClass().getSimpleName() + ": " + current.getMessage();
    }
}
