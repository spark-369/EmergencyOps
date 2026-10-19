package com.pstu.backend.pipeline;

import com.pstu.backend.entity.PipelineEventRecord;
import com.pstu.backend.entity.PipelineEventRecord.DeliveryStatus;
import com.pstu.backend.entity.PipelineEventRecord.MessageKind;
import com.pstu.backend.repository.PipelineEventRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.domain.Pageable;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The outbox sweep and the operator-triggered flush.
 *
 * <p>Two different contracts, tested together because they share the pass guard:
 *
 * <ul>
 *   <li>{@code sweepOnce()} <strong>enqueues</strong> a delivery job per pending row and
 *       never writes to the transport itself — that is what makes it cheap enough to run
 *       on a schedule and impossible to park a thread on a dead Redis;</li>
 *   <li>{@code flushBounded(...)} <strong>delivers</strong> a small batch synchronously,
 *       because an operator pressing "flush" expects to be told what actually left.</li>
 * </ul>
 */
class EventOutboxRelayTest {

    private PipelineEventRepository repository;
    private EventStore eventStore;
    private EventPublisher publisher;
    private EventJobScheduling scheduling;
    private EventOutboxRelay relay;

    @BeforeEach
    void setUp() {
        repository = mock(PipelineEventRepository.class);
        eventStore = mock(EventStore.class);
        publisher = mock(EventPublisher.class);
        scheduling = mock(EventJobScheduling.class);

        // The relay resolves the scheduler through an ObjectProvider (to break the
        // construction cycle), so the stub has to hand back the mock.
        @SuppressWarnings("unchecked")
        ObjectProvider<EventJobScheduling> provider = mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(scheduling);

        relay = new EventOutboxRelay(repository, eventStore, publisher, provider);

        // The sweep counts a row as queued only when the scheduler reports success.
        when(scheduling.scheduleDelivery(anyString())).thenReturn(true);
    }

    private static PipelineEventRecord row(long id) {
        return PipelineEventRecord.builder()
                .id(id)
                .eventId("evt-" + id)
                .eventType(DomainEventType.INCIDENT_CREATED)
                .aggregateId("inc-1")
                .partitionKey("inc-1")
                .payload("{}")
                .status(DeliveryStatus.PENDING)
                .occurredAt(Instant.parse("2026-10-18T10:00:00Z"))
                .build();
    }

    private void givenPending(PipelineEventRecord... rows) {
        when(repository.findPending(eq(MessageKind.OUTBOUND), eq(DeliveryStatus.PENDING), any(Pageable.class)))
                .thenReturn(List.of(rows));
        when(repository.findExhausted(
                eq(MessageKind.OUTBOUND), eq(DeliveryStatus.GAVE_UP), any(Pageable.class)))
                .thenReturn(List.of());
        for (PipelineEventRecord row : rows) {
            when(eventStore.deserialize(row)).thenReturn(EventEnvelope.of(
                    "INCIDENT_CREATED", row.getAggregateId(), row.getAggregateId(),
                    Map.of("incidentId", row.getAggregateId()), "corr-1"));
        }
    }

    /* ------------------------------------------------------------------ sweep */

    @Test
    void sweepEnqueuesOneDeliveryJobPerPendingRow() {
        givenPending(row(1), row(2));

        int queued = relay.sweepOnce();

        assertThat(queued).isEqualTo(2);
        verify(scheduling).scheduleDelivery("evt-1");
        verify(scheduling).scheduleDelivery("evt-2");
        // The whole point of the change: the sweep must not touch the transport.
        verify(publisher, never()).deliver(any(), any());
    }

    @Test
    void sweepParksAnUnreadableRowInsteadOfQueueingIt() {
        PipelineEventRecord broken = row(1);
        PipelineEventRecord healthy = row(2);
        givenPending(broken, healthy);
        when(eventStore.deserialize(broken)).thenThrow(new IllegalStateException("not an envelope"));

        int queued = relay.sweepOnce();

        assertThat(queued).isEqualTo(1);
        verify(eventStore).parkUnreadable(eq(broken), any());
        verify(eventStore, never()).parkUnreadable(eq(healthy), any());
        verify(scheduling, never()).scheduleDelivery("evt-1");
        verify(scheduling).scheduleDelivery("evt-2");
    }

    @Test
    void sweepDoesNotCountRowsTheSchedulerRejected() {
        givenPending(row(1));
        // JobRunr/Redis refused the job: the row is still PENDING, so the sweep must not
        // report it as queued.
        when(scheduling.scheduleDelivery(anyString())).thenReturn(false);

        assertThat(relay.sweepOnce()).isZero();
    }

    /* ------------------------------------------------------------------ flush */

    @Test
    void flushDeliversThePendingRowsWithinTheBudget() {
        givenPending(row(1), row(2));
        when(publisher.deliverBatch(any(), nullable(BooleanSupplier.class))).thenReturn(2);

        int delivered = relay.flushBounded(Duration.ofSeconds(5));

        assertThat(delivered).isEqualTo(2);
    }

    @Test
    void flushDoesNotQueueJobs() {
        givenPending(row(1));
        when(publisher.deliverBatch(any(), nullable(BooleanSupplier.class))).thenReturn(1);

        relay.flushBounded(Duration.ofSeconds(5));

        // A flush is a synchronous delivery; queueing as well would double-deliver.
        verify(scheduling, never()).scheduleDelivery(anyString());
    }

    @Test
    void aConcurrentFlushSkipsInsteadOfDoubleDelivering() {
        givenPending(row(1));
        List<Integer> concurrent = new ArrayList<>();
        when(publisher.deliverBatch(any(), nullable(BooleanSupplier.class))).thenAnswer(invocation -> {
            // A concurrent call during this pass must not double-deliver. Captured
            // rather than asserted here: an assertion thrown inside a Mockito answer is
            // rethrown as a mock failure and masks the real cause.
            concurrent.add(relay.flushBounded(Duration.ofMillis(10)));
            return 1;
        });

        assertThat(relay.flushBounded(Duration.ofSeconds(1))).isEqualTo(1);

        assertThat(concurrent).containsExactly(0);
    }
}

