package com.pstu.backend.entity;

import com.pstu.backend.enums.AllocationStatus;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * Links an incident to a resource for the duration of a deployment.
 *
 * <p>The `incident`/`resource` associations are `LAZY`, so the generated
 * `equals`/`hashCode`/`toString` would trigger extra queries (or throw outside a
 * transaction) by dereferencing them. Equality is the primary key only, and
 * `toString` prints the foreign-key columns instead of the entities.
 */
@Entity
@Table(name = "resource_allocations")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@ToString(onlyExplicitlyIncluded = true)
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
public class ResourceAllocation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @EqualsAndHashCode.Include
    @ToString.Include
    private Long id;

    /**
     * Owning incident.
     *
     * <p>Excluded from `toString`/`equals`/`hashCode` automatically via
     * {@code onlyExplicitlyIncluded = true}; dereferencing this LAZY proxy would
     * otherwise trigger a query (or throw outside a transaction).
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "incident_id", nullable = false)
    private EmergencyIncident incident;

    /**
     * Assigned resource. Excluded from `toString`/`equals`/`hashCode` for the
     * same reason as {@code incident}.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "resource_id", nullable = false)
    private Resource resource;

    /*
     * Column names are explicit throughout this entity. `@Column(nullable = false)`
     * with no name lets Boot's default physical naming derive
     * `estimated_travel_time_minutes`, `arrived_at`, and so on — which silently
     * diverges from a table created with the camelCase spelling, producing a
     * duplicate column that Hibernate writes to and the console never reads (the
     * same defect that left `pipeline_events.publishedAt` empty).
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    @ToString.Include
    private AllocationStatus status;

    @Column(name = "estimatedTravelTimeMinutes", nullable = false)
    private Integer estimatedTravelTimeMinutes;

    @Column(name = "estimatedResolutionTimeMinutes", nullable = false)
    private Integer estimatedResolutionTimeMinutes;

    /**
     * Why this unit was chosen (or why a human dispatched it).
     *
     * <p>Nullable: the rationale is explanatory, not structural. Callers may omit it
     * — the event ingest path builds an {@code AllocationRequest} without one, and
     * only supplies the default text it has on hand. Marking the column
     * {@code NOT NULL} while the DTO did not require the field meant an omission
     * passed validation and then failed at flush as a
     * {@code DataIntegrityViolationException}, which surfaced to the client as an
     * uninformative 500.
     */
    @Column(name = "decisionRationale")
    private String decisionRationale;

    @CreationTimestamp
    @Column(name = "allocatedAt", nullable = false, updatable = false)
    private LocalDateTime allocatedAt;

    @Column(name = "arrivedAt")
    private LocalDateTime arrivedAt;

    @Column(name = "completedAt")
    private LocalDateTime completedAt;
}