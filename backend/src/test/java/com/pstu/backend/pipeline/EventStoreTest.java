package com.pstu.backend.pipeline;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.pstu.backend.entity.PipelineEventRecord;
import com.pstu.backend.entity.PipelineEventRecord.DeliveryStatus;
import com.pstu.backend.entity.PipelineEventRecord.MessageKind;
import com.pstu.backend.repository.PipelineEventRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The receipt written when the broker acknowledges an event.
 *
 * <p>{@code publishedAt} was reported staying empty in {@code pipeline_events}. The
 * column name was implicit, so Hibernate wrote to {@code published_at} while the
 * column being read was {@code publishedAt}. These tests pin the two behaviours an
 * operator depends on: a delivered row records a timestamp, and a redelivery does not
 * move it.
 */
class EventStoreTest {

    private PipelineEventRepository repository;
    private EventStore eventStore;

    private static ObjectMapper mapper() {
        return new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    @BeforeEach
    void setUp() {
        repository = mock(PipelineEventRepository.class);
        eventStore = new EventStore(repository, mapper());
    }

    private PipelineEventRecord row(DeliveryStatus status, Instant publishedAt) {
        return PipelineEventRecord.builder()
                .id(1L)
                .eventId("evt-1")
                .eventType(DomainEventType.INCIDENT_CREATED)
                .aggregateId("inc-1")
                .partitionKey("inc-1")
                .payload("{}")
                .status(status)
                .occurredAt(Instant.parse("2026-10-18T10:00:00Z"))
                .publishedAt(publishedAt)
                .build();
    }

    @Test
    void markingAPublishedRowRecordsTheAcknowledgementTime() {
        PipelineEventRecord stored = row(DeliveryStatus.PENDING, null);
        when(repository.findById(1L)).thenReturn(Optional.of(stored));

        eventStore.markPublished(stored);

        assertThat(stored.getPublishedAt()).isNotNull();
        assertThat(stored.getStatus()).isEqualTo(DeliveryStatus.PUBLISHED);
        assertThat(stored.getPublishAttempts()).isEqualTo(1);
        verify(repository).save(stored);
    }

    @Test
    void redeliveryKeepsTheOriginalAcknowledgementTime() {
        Instant firstDelivery = Instant.parse("2026-10-18T10:00:05Z");
        PipelineEventRecord stored = row(DeliveryStatus.PUBLISHED, firstDelivery);
        when(repository.findById(1L)).thenReturn(Optional.of(stored));

        eventStore.markPublished(stored);

        // `publishedAt` answers "when did this fact first reach the broker". A relay
        // re-offer or a manual replay must not rewrite history.
        assertThat(stored.getPublishedAt()).isEqualTo(firstDelivery);
        assertThat(stored.getPublishAttempts()).isEqualTo(1);
    }

    @Test
    void storingAnEnvelopeLeavesPublishedAtNull() {
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        EventEnvelope envelope = EventEnvelope.of("INCIDENT_CREATED", "inc-1", "inc-1",
                Map.of("incidentId", "inc-1"), "corr-1");

        PipelineEventRecord record = eventStore.store(envelope);

        // Queued is not delivered: the relay keys "still owed to the broker" off this
        // being null, so setting it at insert time would hide an undelivered event.
        assertThat(record.getPublishedAt()).isNull();
        assertThat(record.getStatus()).isEqualTo(DeliveryStatus.PENDING);
    }

    @Test
    void aProcessedCommandIsRecordedAsAlreadyDelivered() {
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        EventEnvelope command = EventEnvelope.of("INCIDENT_REPORTED", "device-1", "device-1",
                Map.of("latitude", 1.0), "corr-1");

        PipelineEventRecord record = eventStore.recordProcessed(command);

        // Stored as PUBLISHED so the relay never echoes the command back, and stamped
        // so the row does not look like an undelivered event in the operator view.
        assertThat(record.getStatus()).isEqualTo(DeliveryStatus.PUBLISHED);
        assertThat(record.getPublishedAt()).isNotNull();
    }

    @Test
    void bookkeepingRowsAreNotOutboundAndNeverCountAsBacklog() {
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        EventEnvelope command = EventEnvelope.of("INCIDENT_REPORTED", "device-1", "device-1",
                Map.of("latitude", 1.0), "corr-1");

        PipelineEventRecord processed = eventStore.recordProcessed(command);
        PipelineEventRecord failure = eventStore.storeIndependently(command);

        // `processed` and `failure` are both PUBLISHED, but neither was ever meant
        // for the broker. Marking them OUTBOUND would put them in the relay's queue.
        assertThat(processed.getKind()).isEqualTo(MessageKind.PROCESSED);
        assertThat(failure.getKind()).isEqualTo(MessageKind.FAILURE);
        assertThat(processed.isAwaitingDelivery()).isFalse();
        assertThat(failure.isAwaitingDelivery()).isFalse();
    }

    @Test
    void anOutboundRowIsAwaitingDeliveryUntilTheBrokerAcknowledgesIt() {
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        EventEnvelope fact = EventEnvelope.of("INCIDENT_CREATED", "inc-1", "inc-1",
                Map.of("incidentId", "inc-1"), "corr-1");

        PipelineEventRecord record = eventStore.store(fact);

        assertThat(record.getKind()).isEqualTo(MessageKind.OUTBOUND);
        assertThat(record.getStatus()).isEqualTo(DeliveryStatus.PENDING);
        assertThat(record.isExhausted()).isFalse();
        assertThat(record.isAwaitingDelivery()).isTrue();
    }

    @Test
    void exhaustingTheRetryBudgetKeepsTheStatusTruthfulAndFlagsTheRow() {
        PipelineEventRecord stored = row(DeliveryStatus.PENDING, null);
        when(repository.findById(1L)).thenReturn(Optional.of(stored));

        eventStore.markFailed(stored, new IllegalStateException("broker down"), 2);

        // First failure: still under budget.
        assertThat(stored.getStatus()).isEqualTo(DeliveryStatus.PENDING);
        assertThat(stored.isExhausted()).isFalse();

        eventStore.markFailed(stored, new IllegalStateException("broker down"), 2);

        /*
         * The broker has still not acknowledged the event, so the status must stay
         * PENDING — that is what makes the row remain in the retry queue. The budget
         * is recorded separately. Previously this flipped to GAVE_UP, which both
         * misreported delivery and moved the row onto a separate "exhausted" query.
         */
        assertThat(stored.getStatus()).isEqualTo(DeliveryStatus.PENDING);
        assertThat(stored.isExhausted()).isTrue();
        assertThat(stored.getLastError()).isEqualTo("broker down");
        assertThat(stored.isAwaitingDelivery()).isTrue();
    }

    @Test
    void deliveryClearsTheExhaustedFlag() {
        PipelineEventRecord stored = row(DeliveryStatus.PENDING, null);
        stored.setExhausted(true);
        stored.setPublishAttempts(5);
        when(repository.findById(1L)).thenReturn(Optional.of(stored));

        eventStore.markPublished(stored);

        assertThat(stored.getStatus()).isEqualTo(DeliveryStatus.PUBLISHED);
        // A recovered broker must take the row out of the ATTENTION count.
        assertThat(stored.isExhausted()).isFalse();
        assertThat(stored.isAwaitingDelivery()).isFalse();
    }
}
