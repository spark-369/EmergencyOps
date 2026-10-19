package com.pstu.backend;

import com.pstu.backend.pipeline.EventJobScheduling;
import com.pstu.backend.pipeline.EventOutboxRelay;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.pipeline.EventStore;
import com.pstu.backend.repository.PipelineEventRepository;
import org.jobrunr.storage.StorageProvider;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Boots the full context.
 *
 * <p>The datasource, JWT secret and pipeline switches are supplied inline rather than
 * through a profile: {@code src/main/resources} holds a single
 * {@code application.properties} with no profile documents, so there is no
 * {@code test} profile to activate. Inlining also keeps the test independent of a
 * running PostgreSQL — H2 is a test-scoped dependency and the schema is created on
 * boot.
 *
 * <p>{@code app.jwt.secret} must be set because {@code JwtKeyConfig} aborts startup
 * without key material by design; the value here is a throwaway literal valid only
 * for this test.
 *
 * <p>The pipeline beans are mocked or switched off. {@code app.events.consumer.enabled=false}
 * stops {@code RedisTopicSubscriber} from opening a blocking SUBSCRIBE against a Redis
 * that this test does not have, and the JobRunr storage provider is mocked so no
 * connection is attempted at all.
 *
 * <p>{@code jobrunr.background-job-server.enabled=false} is inherited from
 * {@code application.properties} and matters here: it is the flag that stops the starter
 * from creating the server with {@code initMethod = "start"}, so the test never polls an
 * empty store. {@code JobRunrConfig} treats the absent server bean as a warning, which is
 * exactly what a context with no job infrastructure should do.
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:emergency_test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.datasource.driver-class-name=org.h2.Driver",
        // application.properties pins the PostgreSQL dialect, which H2 rejects when
        // it creates the schema; the test states its own dialect instead.
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "app.jwt.secret=test-only-secret-key-for-context-loading-0123456789abcdef",
        // The auth rate limiters are configured in application.properties and are
        // read by RateLimitConfig during context refresh; keep the periods long so a
        // test run cannot throttle itself.
        "resilience4j.ratelimiter.instances.authLogin.limit-for-period=1000",
        "resilience4j.ratelimiter.instances.authRegister.limit-for-period=1000",
        "resilience4j.ratelimiter.instances.authRefresh.limit-for-period=1000",
        "app.events.outbox-relay.enabled=false",
        "app.events.consumer.enabled=false"
})
class BackendApplicationTests {

	@MockitoBean
	private EventPublisher eventPublisher;

	@MockitoBean
	private PipelineEventRepository pipelineEventRepository;

	@MockitoBean
	private EventOutboxRelay eventOutboxRelay;

	@MockitoBean
	private EventStore eventStore;

	/** JobRunr's storage provider: mocked so no connection is attempted at all. */
	@MockitoBean
	private StorageProvider jobRunrStorageProvider;

	/** Registering the recurring sweep would otherwise enqueue against the mocked store. */
	@MockitoBean
	private EventJobScheduling eventJobScheduling;

	@Test
	void contextLoads() {
	}
}

