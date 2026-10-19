package com.pstu.backend.entity;

import com.pstu.backend.pipeline.DomainEventType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

/**
 * The durable outbox <em>and</em> the delivery log of the pipeline.
 *
 * <p>A row is written in the same transaction as the domain change it describes,
 * so "the incident moved to IN_PROGRESS" and "INCIDENT_STATUS_CHANGED must be
 * published" are one atomic fact: there is no window in which the database says
 * one thing and the broker never hears about it. After commit the publisher flips
 * the row to {@code PUBLISHED}; if the broker is unreachable it stays
 * {@code PENDING} and the retry scheduler re-sends it, using {@code event_id} as
 * the idempotency key so consumers see the fact exactly once.
 *
 * <p>{@code status} is stored as a string: a numeric ordinal would silently mean
 * a different status if the enum is ever reordered.
 */
@Entity
@Table(
        name = "pipeline_events",
        indexes = {
                @Index(name = "idx_pipeline_events_status_created", columnList = "status, occurredAt"),
                @Index(name = "idx_pipeline_events_aggregate", columnList = "aggregateId, occurredAt"),
                @Index(name = "idx_pipeline_events_type", columnList = "eventType, occurredAt")
        }
)
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@ToString(onlyExplicitlyIncluded = true)
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
public class PipelineEventRecord {

    public enum DeliveryStatus {
        /** Committed with the aggregate, not yet acknowledged by the broker. */
        PENDING,
        /** Acknowledged by the broker (acks=all). */
        PUBLISHED,
        /**
         * Retried to exhaustion. Not lost and not terminal: the relay re-offers it
         * each pass, and it returns to PUBLISHED as soon as the broker accepts it.
         *
         * <p>Only ever set on {@link MessageKind#OUTBOUND} rows. A row also carries
         * {@code exhausted = true} while in this state, which is what the health
         * probe counts; see {@link #isAwaitingDelivery()}.
         */
        GAVE_UP,
        /**
         * Cannot be delivered at all — the stored payload is not a valid envelope.
         * Parked here so it stops being retried; it is an operator item, not part of
         * the live queue, and its presence does not indicate a broker problem.
         */
        FAILED
    }

    /**
     * What a row <em>is</em>, as opposed to how far {@link #status} got.
     *
     * <p>The two were previously conflated: a consumer-side command marker and a
     * {@code PROCESSING_FAILED} log entry are both written as {@code PUBLISHED}, so
     * they are indistinguishable from a genuinely delivered outbound event in the
     * table. Anything counting delivery health therefore has to filter on this
     * column first, or "half the table is PUBLISHED" reads as success when those
     * rows were never meant to be delivered at all.
     */
    public enum MessageKind {
        /**
         * A fact this service owes the broker. The only kind the outbox relay
         * delivers and the only kind that contributes to delivery health.
         */
        OUTBOUND,
        /**
         * An inbound command already applied, recorded as the consumer's
         * idempotency marker. Stored {@code PUBLISHED} deliberately so the relay
         * does not echo the command back onto its topic.
         */
        PROCESSED,
        /**
         * A {@code PROCESSING_FAILED} record — an operator log of something that
         * went wrong. Never delivered, never retried, never counted as a backlog.
         */
        FAILURE
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @EqualsAndHashCode.Include
    @ToString.Include
    private Long id;

    /** Producer-generated idempotency key, unique across the store. */
    @Column(name = "eventId", nullable = false, unique = true, length = 64, updatable = false)
    @ToString.Include
    private String eventId;

    @Enumerated(EnumType.STRING)
    @Column(name = "eventType", nullable = false, length = 64)
    @ToString.Include
    private DomainEventType eventType;

    @Column(name = "aggregateId", nullable = false, length = 64)
    @ToString.Include
    private String aggregateId;

    @Column(name = "partitionKey", nullable = false, length = 64)
    private String partitionKey;

    @Column(name = "correlationId", length = 64)
    private String correlationId;

    /**
     * Serialized {@code EventEnvelope}. Stored whole rather than re-rendered from
     * columns on replay: the payload is the contract, and a later code change must
     * not silently alter what was already published.
     *
     * <p>{@code length = 1048576} (1 MiB) maps to {@code varchar(1048576)}, which
     * PostgreSQL renders as {@code text} and H2 accepts — one mapping that works in
     * both the production and the test profile. A {@code @Lob} would become an
     * {@code oid}/CLOB and make the column awkward to query from a console.
     */
    @Column(nullable = false, length = 1_048_576)
    private String payload;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    @Builder.Default
    private DeliveryStatus status = DeliveryStatus.PENDING;

    /**
     * Whether this row is an outbound fact, a processed command or a failure log.
     *
     * <p>Defaults to {@link MessageKind#OUTBOUND} so a row written before this
     * column existed (and any future writer that omits it) is treated as something
     * the relay must deliver — the safe assumption for a row that was inserted
     * inside a business transaction.
     *
     * <p>{@code columnDefinition} carries a database-level default on purpose. When
     * the schema is created from the entities ({@code ddl-auto=create} on a fresh
     * database) the column lands on an empty table, but the same DDL is the record
     * of intent for anyone recreating this table by hand: a {@code NOT NULL} column
     * without a default cannot be added to a populated one. The same intent is
     * expressed twice — once for Hibernate and once for SQL — because they serve
     * different readers: the builder default covers new Java objects, the DDL
     * default covers existing rows.
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16, columnDefinition = "varchar(16) default 'OUTBOUND'")
    @Builder.Default
    private MessageKind kind = MessageKind.OUTBOUND;

    /**
     * True once the row has burned through its retry budget.
     *
     * <p>Separate from {@link #status} on purpose. Status answers "has the broker
     * acknowledged this yet" — and the answer stays {@code false} however many
     * attempts fail, which is why the relay keeps re-offering the row. This flag
     * answers the different question "is it still worth waiting on", and is what the
     * health probe and the console's ATTENTION state key off.
     *
     * <p>Named explicitly, with a DDL default for the same reason as {@link #kind}:
     * an implicit name plus {@code NOT NULL} would break the upgrade of a populated
     * table.
     */
    @Column(name = "exhausted", nullable = false, columnDefinition = "boolean default false")
    @Builder.Default
    private boolean exhausted = false;

    /**
     * True when the relay still owes the broker a delivery for this row.
     *
     * <p>Deliberately *not* {@code status != PUBLISHED}: a {@code PROCESSED} or
     * {@code FAILURE} row is bookkeeping that was never meant to be sent, so treating
     * it as undelivered would make the console report a permanent backlog that no
     * broker could ever clear.
     */
    public boolean isAwaitingDelivery() {
        return kind == MessageKind.OUTBOUND
                && status != DeliveryStatus.PUBLISHED
                && status != DeliveryStatus.FAILED;
    }

    /* The two columns below are named explicitly for the same reason as
       `publishedAt`: Boot's default physical naming turns `publishAttempts` into
       `publish_attempts` and `lastError` into `last_error`. If the table already had
       the camelCase columns, Hibernate would add snake_case duplicates and silently
       write to the wrong one — the relay's retry counter and error text would appear
       frozen. */
    @Column(name = "publishAttempts", nullable = false)
    @Builder.Default
    private int publishAttempts = 0;

    @Column(name = "lastError", length = 500)
    private String lastError;

    @Column(nullable = false)
    private Instant occurredAt;

    /**
     * Time the broker acknowledged the record.
     *
     * <p>Left {@code null} while the row is {@code PENDING} — that is the difference
     * between "queued" and "delivered", and the relay relies on it staying null so
     * an undelivered row is unambiguous.
     *
     * <p>The column is named explicitly, like every other field on this entity.
     * Without it Hibernate derives the name from the property ({@code published_at}
     * under Boot's default snake_case strategy), which does not match the
     * {@code publishedAt} the rest of the table uses — so writes landed in a
     * different column than the one being read.
     */
    @Column(name = "publishedAt")
    private Instant publishedAt;

    /**
     * Row insert time, set by Hibernate on flush.
     *
     * <p>Named explicitly for the same reason as {@link #publishedAt}: leaving the
     * name implicit makes Hibernate derive a different column
     * ({@code created_at}), so this entity would not match the rest of the table.
     */
    @CreationTimestamp
    @Column(name = "createdAt", nullable = false, updatable = false)
    private Instant createdAt;
}
