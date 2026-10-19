package com.pstu.backend.config;

import org.jobrunr.jobs.mappers.JobMapper;
import org.jobrunr.server.BackgroundJobServer;
import org.jobrunr.storage.StorageProvider;
import org.jobrunr.storage.sql.common.SqlStorageProviderFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;

import javax.sql.DataSource;

/**
 * JobRunr integration.
 *
 * <p>The starter ({@code jobrunr-spring-boot-3-starter}) owns the job scheduler and the
 * background server; this class supplies the storage provider the starter fails to create
 * here, and controls when the server starts.</p>
 *
 * <h2>1. The job store is declared explicitly</h2>
 *
 * <p>The starter ships several storage auto-configurations (SQL, Lettuce/Spring-Data-Redis,
 * Lettuce client, Jedis, MongoDB, …) and each guards itself with conditions ending in
 * {@code @ConditionalOnMissingBean}. With {@code spring-boot-starter-data-redis} on the
 * classpath a {@code RedisConnectionFactory} exists, so the Redis candidates compete with
 * the SQL one; the net result was <strong>no</strong> {@code StorageProvider} bean, and
 * startup failed with {@code required a bean of type 'StorageProvider' that could not be
 * found}. {@link #storageProvider} therefore builds the SQL provider directly against the
 * application {@code DataSource}, passing the starter's {@code JobMapper} explicitly.</p>
 *
 * <p>Jobs live in PostgreSQL (the {@code jobrunr_*} tables). The SQL provider is the
 * supported, non-BETA one; the Redis storage providers are still marked BETA upstream and
 * their docs advise against production use. Redis remains the <em>event transport</em> only —
 * the channels and capped per-topic lists {@code RedisEventBus} writes to — so a Redis
 * outage delays events instead of losing jobs.</p>
 *
 * <h2>2. The server starts on readiness, not at context refresh</h2>
 *
 * <p>The starter declares {@code BackgroundJobServer} with {@code initMethod = "start"}, so
 * by default it is running while the context is still refreshing. That matters here
 * because {@code BrokerHealthProbe}, {@code EventJobScheduling} and the ingest loop all act
 * on {@code ApplicationReadyEvent}: a server polling during refresh can pick up delivery
 * jobs before the application is fully up. {@code jobrunr.background-job-server.enabled=false}
 * stops that, and {@link #startBackgroundJobServer()} starts the same autoconfigured bean
 * once the application is ready. Because the bean is reused rather than rebuilt, the worker
 * count, poll interval and shutdown settings in {@code jobrunr.background-job-server.*}
 * still apply.</p>
 *
 * <h2>What deliberately stays off</h2>
 *
 * <p>The dashboard serves unauthenticated HTML and the job payloads carry incident data.
 * {@code GET /api/v1/pipeline/outbox} exposes the same information behind the API's
 * authentication. JobRunr metrics are exported through Micrometer instead, so a dashboard
 * can be built without opening port 8000.</p>
 */
@Configuration(proxyBeanMethods = false)
public class JobRunrConfig {

    private static final Logger log = LoggerFactory.getLogger(JobRunrConfig.class);

    /**
     * Resolved lazily rather than injected directly: a slice test or a context where the
     * starter backed off has no server bean, and that must log a warning rather than fail
     * the whole application at startup.
     */
    private final ObjectProvider<BackgroundJobServer> backgroundJobServerProvider;

    public JobRunrConfig(ObjectProvider<BackgroundJobServer> backgroundJobServerProvider) {
        this.backgroundJobServerProvider = backgroundJobServerProvider;
    }

    /**
     * The job store, built explicitly instead of relying on autoconfiguration.
     *
     * <p><strong>Why this is not redundant.</strong> The starter registers several storage
     * auto-configurations (SQL, Lettuce/Spring-Data-Redis, Lettuce client, Jedis, MongoDB,
     * …) and every one ends in {@code @ConditionalOnMissingBean}. Because
     * {@code spring-boot-starter-data-redis} puts Spring Data Redis and a
     * {@code RedisConnectionFactory} on the classpath, the Redis-backed candidates are also
     * in play. The net result was <em>no</em> {@code StorageProvider} bean at all, and
     * startup failed with {@code required a bean of type 'StorageProvider' that could not be
     * found} — the exact failure this bean fixes.</p>
     *
     * <p><strong>The {@link JobMapper} is passed explicitly.</strong> The factory builds
     * the provider but does not wire the mapper; without it JobRunr cannot serialise job
     * details. Injecting the starter's own {@code JobMapper} bean keeps the serialisation
     * identical to what the starter would have used, so jobs written here are readable by
     * the dashboard and by a later upgrade that drops this bean.</p>
     *
     * <p><strong>{@code destroyMethod = "close"}.</code> The provider owns a change-listener
     * timer; letting the context close it prevents that thread outliving a shutdown.</p>
     *
     * <p>{@code @ConditionalOnMissingBean} semantics are preserved by declaring the bean
     * name {@code storageProvider}, which is what the SQL auto-configuration uses — so if a
     * future starter version activates correctly on its own, this method becomes a no-op
     * rather than a duplicate.</p>
     */
    @Bean(name = "storageProvider", destroyMethod = "close")
    public StorageProvider storageProvider(DataSource dataSource, JobMapper jobMapper) {
        StorageProvider provider = SqlStorageProviderFactory.using(dataSource);
        provider.setJobMapper(jobMapper);
        log.info("JobRunr job store ready: PostgreSQL jobrunr_* tables via the application DataSource");
        return provider;
    }

    /**
     * Starts the autoconfigured server once the application is ready.
     *
     * <p>Starting an already-running server would throw, so the state is checked first —
     * a refreshed context fires {@code ApplicationReadyEvent} again. An unreachable
     * database at this point is logged and swallowed: the API must keep serving writes
     * that the outbox has already made durable, and the next attempt after a restart will
     * start the server normally.</p>
     */
    @EventListener(ApplicationReadyEvent.class)
    public void startBackgroundJobServer() {
        BackgroundJobServer server = backgroundJobServerProvider.getIfAvailable();
        if (server == null) {
            log.warn("No JobRunr BackgroundJobServer bean: jobs will be enqueued but never run");
            return;
        }
        if (server.isRunning()) {
            return;
        }
        try {
            server.start();
            /*
             * The server id, not its configuration: `BackgroundJobServer` in JobRunr 7
             * exposes `getId()`/`getConfiguration()`, and the configuration object's
             * accessors differ between releases (worker count, poll interval and the
             * `andXxx` factory methods all moved). Logging the id keeps this class free
             * of that version-sensitive surface — the effective worker count and poll
             * interval are visible in `jobrunr.*` and in the exported metrics.
             */
            log.info("JobRunr background job server '{}' started", server.getId());
        } catch (RuntimeException e) {
            log.error("Could not start the JobRunr background job server '{}' ({}). Enqueued " +
                      "jobs stay in the store until a server picks them up.",
                    server.getId(), e.getMessage());
        }
    }
}


