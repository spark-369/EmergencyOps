package com.pstu.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.pstu.backend.dto.IncidentResponse;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.pipeline.EmergencyEventPipeline;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventStore;
import com.pstu.backend.repository.PipelineEventRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The ingest loop's transport-independent half: what it must guarantee regardless of who
 * delivers the message.
 *
 * <ul>
 *   <li>a command is applied and recorded;</li>
 *   <li>a duplicate delivery is skipped (the marker row already exists);</li>
 *   <li>facts on the topic are ignored rather than applied twice;</li>
 *   <li>a failure is rethrown, so {@code RedisTopicSubscriber} retries and dead-letters.</li>
 * </ul>
 *
 * <p>Nothing here touches Redis: the service takes a topic and a JSON string, which is
 * exactly what makes it testable without a broker.
 */
class EventProcessingServiceTest {

    /** The topic these tests pretend the message arrived on. */
    private static final String TOPIC = "emergency.incidents.v1";

    private EmergencyEventPipeline pipeline;
    private PipelineEventRepository repository;
    private EventStore eventStore;
    private EventProcessingService service;
    /**
     * Mirrors the production {@code JacksonConfig} bean: {@code EventEnvelope} carries
     * an {@code Instant}, and a bare {@code new ObjectMapper()} would throw on
     * {@code writeValueAsString} for every event this test builds.
     */
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    @BeforeEach
    void setUp() {
        pipeline = mock(EmergencyEventPipeline.class);
        repository = mock(PipelineEventRepository.class);
        eventStore = mock(EventStore.class);
        service = new EventProcessingService(pipeline, eventStore, repository, objectMapper);
    }

    private String body(EventEnvelope envelope) throws Exception {
        return objectMapper.writeValueAsString(envelope);
    }

    static EventEnvelope reportedIncident() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("latitude", 23.8103);
        payload.put("longitude", 90.4125);
        payload.put("severity", "CRITICAL");
        payload.put("affectedPeople", 12);
        payload.put("timeSensitivityMinutes", 5);
        return EventEnvelope.of("INCIDENT_REPORTED", "device-42", "device-42", payload, "corr-9");
    }

    @Test
    void appliesACommandAndRecordsIt() throws Exception {
        EventEnvelope envelope = reportedIncident();
        when(repository.existsByEventId(envelope.eventId())).thenReturn(false);
        when(pipeline.handle(envelope)).thenReturn("incident:inc-1");

        service.onEvent(TOPIC, body(envelope));

        verify(pipeline).handle(envelope);
        // The idempotency marker is what makes a redelivery a no-op.
        verify(eventStore).recordProcessed(envelope);
    }

    @Test
    void duplicateDeliveryIsSkipped() throws Exception {
        EventEnvelope envelope = reportedIncident();
        when(repository.existsByEventId(envelope.eventId())).thenReturn(true);

        service.onEvent(TOPIC, body(envelope));

        verify(pipeline, never()).handle(any());
        verify(eventStore, never()).recordProcessed(any());
    }

    @Test
    void domainFactsAreNotReapplied() throws Exception {
        EventEnvelope fact = EventEnvelope.of("ALLOCATION_CREATED", "1", "inc-1",
                Map.of("allocationId", 1), "corr-9");

        service.onEvent(TOPIC, body(fact));

        verify(pipeline, never()).handle(any());
        verify(eventStore, never()).recordProcessed(any());
    }

    /**
     * The consumed-topic list must cover the pipeline topics and nothing else.
     *
     * <p>Two properties matter and both were wrong before: the list must not include the
     * failure topic (the service used to consume its own failure log), and it must name
     * each configured topic exactly.
     *
     * <p>Reads {@code application.properties} — the same file Spring loads — so this test
     * fails if the subscriber's list and the topic names drift apart.
     */
    @Test
    void consumerListCoversTheTopicsWithoutTheFailureLog() throws Exception {
        Properties configured = new Properties();
        try (var in = getClass().getClassLoader().getResourceAsStream("application.properties")) {
            assertThat(in).as("application.properties on the test classpath").isNotNull();
            configured.load(in);
        }
        String raw = configured.getProperty("app.events.consumer-pattern");
        assertThat(raw).isNotNull();
        // The file stores `${ENV:default}`; take the default, which is what a dev/IDE run
        // without EVENTS_CONSUMER_PATTERN actually subscribes to.
        List<String> topics = Arrays.stream(raw.replaceAll("^\\$\\{[^:]+:(.*)}$", "$1").split(","))
                .map(String::trim)
                .toList();

        assertThat(topics).containsExactlyInAnyOrder(
                "emergency.incidents.v1",
                "emergency.allocations.v1",
                "emergency.resources.v1",
                "emergency.optimization.v1",
                "emergency.accounts.v1");

        // The whole point of listing rather than wildcarding.
        assertThat(topics).doesNotContain(
                "emergency.processing-failures.v1", "emergency.processing-failures.v1.DLT",
                "emergency.all.v1");
    }

    @Test
    void failuresAreRethrownSoTheSubscriberCanRetry() throws Exception {
        EventEnvelope envelope = reportedIncident();
        when(repository.existsByEventId(anyString())).thenReturn(false);
        when(pipeline.handle(envelope)).thenThrow(new IllegalStateException("db down"));

        assertThatThrownBy(() -> service.onEvent(TOPIC, body(envelope)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("db down");

        verify(pipeline).reportFailure(eq(envelope), any(IllegalStateException.class));
        // No marker row on failure: the command was not applied, so a retry must not be
        // treated as a duplicate.
        verify(eventStore, never()).recordProcessed(any());
    }

    @Test
    void aMalformedBodyIsRejectedAsNotRetryable() {
        // IllegalArgumentException is what the subscriber treats as non-retryable, so a
        // message that is not an envelope goes straight to the dead-letter stream.
        assertThatThrownBy(() -> service.onEvent(TOPIC, "{not json"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining(TOPIC);
    }

    @Test
    void anIncidentReportBecomesAnIncident() {
        IncidentService incidentService = mock(IncidentService.class);
        OptimizationService optimizationService = mock(OptimizationService.class);
        EmergencyEventPipeline realPipeline = new EmergencyEventPipeline(eventStore,
                incidentService, mock(AllocationService.class),
                mock(IncidentLifecycleService.class), optimizationService);
        when(incidentService.createIncident(any())).thenReturn(IncidentResponse.builder()
                .incidentId("inc-1")
                .severity(IncidentSeverity.CRITICAL)
                .status(IncidentStatus.PRIORITIZED)
                .build());

        String effect = realPipeline.handle(reportedIncident());

        assertThat(effect).isEqualTo("incident:inc-1");
        verify(incidentService).createIncident(argThat(request ->
                request.getSeverity() == IncidentSeverity.CRITICAL
                        && request.getAffectedPeople() == 12));
        verify(optimizationService).optimizeForIncident("inc-1");
    }

    @Test
    void unknownStatusIsRejectedAsNonRetryable() {
        EventEnvelope command = EventEnvelope.of("INCIDENT_STATUS_REQUESTED", "inc-1", "inc-1",
                Map.of("incidentId", "inc-1", "status", "MOANING"), "corr-9");
        EmergencyEventPipeline realPipeline = new EmergencyEventPipeline(eventStore,
                mock(IncidentService.class), mock(AllocationService.class),
                mock(IncidentLifecycleService.class), mock(OptimizationService.class));

        // IllegalArgumentException is non-retryable in RedisTopicSubscriber, so this goes
        // straight to the dead-letter stream instead of looping.
        assertThatThrownBy(() -> realPipeline.handle(command))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("MOANING");
    }
}
