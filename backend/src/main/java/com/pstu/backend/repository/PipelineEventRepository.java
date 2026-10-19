package com.pstu.backend.repository;

import com.pstu.backend.entity.PipelineEventRecord;
import com.pstu.backend.entity.PipelineEventRecord.DeliveryStatus;
import com.pstu.backend.entity.PipelineEventRecord.MessageKind;
import com.pstu.backend.pipeline.DomainEventType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * Queries backing the outbox retry scheduler, the ingest loop's idempotency
 * check and the operator-facing audit view.
 */
public interface PipelineEventRepository extends JpaRepository<PipelineEventRecord, Long> {

    Optional<PipelineEventRecord> findByEventId(String eventId);

    boolean existsByEventId(String eventId);

    /**
     * Rows the relay still owes the broker, oldest first.
     *
     * <p>Filtered on {@code kind} rather than status alone: a {@code PROCESSED}
     * idempotency marker and a {@code FAILURE} log are stored as {@code PUBLISHED}
     * but were never deliverable, so the kind predicate keeps them out of the queue.
     */
    @Query("SELECT e FROM PipelineEventRecord e " +
            "WHERE e.kind = :kind AND e.status = :status ORDER BY e.occurredAt ASC")
    List<PipelineEventRecord> findPending(@Param("kind") MessageKind kind,
                                          @Param("status") DeliveryStatus status,
                                          Pageable pageable);

    /**
     * Rows that exhausted their retry budget, oldest first.
     *
     * <p>Selected by the {@code exhausted} flag. The relay re-offers a small batch
     * of these each pass: {@code exhausted} means "this row is not making progress
     * right now", not "this row is lost", and the usual cause is a broker outage.
     *
     * <p>The legacy clause keeps rows written before the flag existed (which carry
     * {@code status = GAVE_UP}) in the retry path, so upgrading does not strand a
     * backlog that the previous version had already parked.
     */
    @Query("SELECT e FROM PipelineEventRecord e " +
            "WHERE e.kind = :kind AND (e.exhausted = true OR e.status = :legacyStatus) " +
            "ORDER BY e.occurredAt ASC")
    List<PipelineEventRecord> findExhausted(@Param("kind") MessageKind kind,
                                            @Param("legacyStatus") DeliveryStatus legacyStatus,
                                            Pageable pageable);

    /**
     * Delivered facts.
     *
     * <p>Outbound only — the count answers "how many events reached the broker",
     * which bookkeeping rows would otherwise inflate.
     */
    @Query("SELECT COUNT(e) FROM PipelineEventRecord e " +
            "WHERE e.kind = :kind AND e.status = :status")
    long countOutboundByStatus(@Param("kind") MessageKind kind,
                               @Param("status") DeliveryStatus status);

    /**
     * Outbound rows still awaiting acknowledgement, whether or not they have
     * exhausted their budget. This is the real backlog: the broker has not
     * confirmed them, so the relay still owes a delivery.
     */
    @Query("SELECT COUNT(e) FROM PipelineEventRecord e " +
            "WHERE e.kind = :kind AND e.status <> :published AND e.status <> :failed")
    long countAwaitingDelivery(@Param("kind") MessageKind kind,
                               @Param("published") DeliveryStatus published,
                               @Param("failed") DeliveryStatus failed);

    /**
     * Outbound rows that have burned through their retry budget and are still
     * unacknowledged — the operator's "something is wrong" number.
     */
    @Query("SELECT COUNT(e) FROM PipelineEventRecord e " +
            "WHERE e.kind = :kind AND e.exhausted = true AND e.status <> :published")
    long countExhaustedUndelivered(@Param("kind") MessageKind kind,
                                   @Param("published") DeliveryStatus published);

    /** History of one aggregate, oldest first — the timeline of an incident. */
    List<PipelineEventRecord> findByAggregateIdOrderByOccurredAtAsc(String aggregateId);

    /**
     * The most recent delivery failure of the given kind.
     *
     * <p>Backs the {@code lastDeliveryError} field of {@code GET /pipeline/outbox}:
     * one row is enough to tell an operator whether the broker is unreachable, a
     * topic is missing or an ACL rejected the produce, without opening psql.
     */
    Optional<PipelineEventRecord> findFirstByKindAndLastErrorIsNotNullOrderByOccurredAtDesc(
            MessageKind kind);

    List<PipelineEventRecord> findByEventTypeOrderByOccurredAtDesc(DomainEventType eventType, Pageable pageable);

    List<PipelineEventRecord> findByCorrelationIdOrderByOccurredAtAsc(String correlationId);

    long countByStatus(DeliveryStatus status);
}
