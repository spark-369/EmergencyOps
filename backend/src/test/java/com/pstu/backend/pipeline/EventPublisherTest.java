package com.pstu.backend.pipeline;

import com.pstu.backend.entity.PipelineEventRecord;
import com.pstu.backend.entity.PipelineEventRecord.DeliveryStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The transaction boundary around publishing — the property that makes the outbox worth
 * having — and the fact that delivery is now handed to JobRunr rather than done inline.
 */
class EventPublisherTest {

    private EventStore eventStore;
    private EventJobScheduling scheduling;
    private RedisEventBus eventBus;
    private EventPublisher publisher;
    private PipelineEventRecord record;

    /**
     * Records whether the delivery job was enqueued.
     *
     * <p>The publisher's contract is "schedule after commit", so every assertion below is
     * about {@code scheduleDelivery}, not about a transport write: the write happens in
     * {@link EventDeliveryJob}, which is the unit under test for delivery.
     */
    @BeforeEach
    void setUp() {
        eventStore = mock(EventStore.class);
        scheduling = mock(EventJobScheduling.class);
        eventBus = mock(RedisEventBus.class);

        record = PipelineEventRecord.builder()
                .eventId("evt-1")
                .eventType(DomainEventType.INCIDENT_CREATED)
                .aggregateId("inc-1")
                .status(DeliveryStatus.PENDING)
                .publishAttempts(0)
                .occurredAt(java.time.Instant.now())
                .build();

        when(eventStore.store(any())).thenReturn(record);
        publisher = new EventPublisher(eventStore, scheduling, eventBus);
    }

    private static EventEnvelope incidentCreated() {
        return EventEnvelope.of("INCIDENT_CREATED", "inc-1", "inc-1",
                Map.of("incidentId", "inc-1"), "corr-1");
    }

    @Test
    void publishInsideTransactionWaitsForCommit() {
        TransactionSynchronizationManager.initSynchronization();
        try {
            publisher.publish(incidentCreated());

            // No job yet: a consumer must never be handed a fact that could roll back.
            verify(scheduling, never()).scheduleDelivery(any());
            assertThat(TransactionSynchronizationManager.getSynchronizations()).hasSize(1);

            TransactionSynchronizationManager.getSynchronizations()
                    .forEach(TransactionSynchronization::afterCommit);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }

        verify(scheduling).scheduleDelivery("evt-1");
    }

    @Test
    void publishOutsideTransactionSchedulesImmediately() {
        publisher.publish(incidentCreated());

        verify(scheduling).scheduleDelivery("evt-1");
        // Publishing must never write through the transport itself any more; that is
        // the delivery job's job, and doing both would double-deliver.
        verify(eventBus, never()).publish(any());
    }

    @Test
    void aSchedulingFailureDoesNotEscalateToTheCaller() {
        // JobRunr/Redis unreachable at enqueue time: the row stays PENDING and the sweep
        // retries, so publish() must still return normally.
        org.mockito.Mockito.doThrow(new IllegalStateException("jobrunr down"))
                .when(scheduling).scheduleDelivery(any());

        EventEnvelope result = publisher.publish(incidentCreated());

        assertThat(result.eventId()).isNotBlank();
    }

    @Test
    void deliverMarksPublishedWhenTheTransportAccepts() {
        when(eventBus.publish(any())).thenReturn(true);

        boolean delivered = publisher.deliver(record, incidentCreated());

        assertThat(delivered).isTrue();
        verify(eventStore).markPublished(record);
        verify(eventStore, never()).markFailed(any(), any(), anyInt());
    }

    @Test
    void transportFailureLeavesTheEventPendingForTheSweep() {
        when(eventBus.publish(any())).thenReturn(false);

        boolean delivered = publisher.deliver(record, incidentCreated());

        assertThat(delivered).isFalse();
        verify(eventStore, never()).markPublished(any());
        // The retry budget is JobRunr's concern now, so the row is not marked exhausted:
        // Integer.MAX_VALUE is passed so it stays in the pending queue indefinitely.
        verify(eventStore).markFailed(eq(record), any(), eq(Integer.MAX_VALUE));
    }

    @Test
    void deliverBatchSkipsUnreadableRowsAndStopsAtItsDeadline() {
        when(eventBus.publish(any())).thenReturn(true);
        PipelineEventRecord bad = PipelineEventRecord.builder().eventId("bad").build();
        when(eventStore.deserialize(bad)).thenThrow(new IllegalStateException("corrupt"));

        int delivered = publisher.deliverBatch(List.of(bad, record, record), () -> false);

        // The corrupt row is parked and skipped; the two good rows are published.
        assertThat(delivered).isEqualTo(2);
        verify(eventStore).parkUnreadable(eq(bad), any());

        // With an already-expired budget nothing else is attempted.
        int afterDeadline = publisher.deliverBatch(List.of(record), () -> true);
        assertThat(afterDeadline).isZero();
    }
}

