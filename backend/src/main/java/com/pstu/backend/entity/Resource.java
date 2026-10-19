package com.pstu.backend.entity;

import com.pstu.backend.enums.ResourceStatus;
import com.pstu.backend.enums.ResourceType;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * A deployable emergency resource.
 *
 * <p>As with {@link EmergencyIncident}, `equals`/`hashCode` are identity-based
 * and the lazy `allocations` collection is excluded from them and from
 * `toString` (see the note on that class).
 */
@Entity
@Table(name = "resources")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@ToString(onlyExplicitlyIncluded = true)
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
public class Resource {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @EqualsAndHashCode.Include
    @ToString.Include
    private Long id;

    @Column(nullable = false, unique = true)
    @ToString.Include
    private String resourceId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ResourceType type;

    @Column(nullable = false)
    private Double latitude;

    @Column(nullable = false)
    private Double longitude;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ResourceStatus status;

    @Column(nullable = false)
    private Integer capacity;

    @Column(nullable = false)
    private Integer currentLoad;

    @Column(nullable = false)
    private Double travelSpeedKmh;

    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> operationalConstraints;

    @Column(nullable = false)
    private Boolean available;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;

    /**
     * Deployments attached to this resource.
     *
     * <p>`toString`/`equals`/`hashCode` are generated with
     * {@code onlyExplicitlyIncluded = true} on the class, so this lazy collection
     * is excluded automatically — no {@code @ToString.Exclude} /
     * {@code @EqualsAndHashCode.Exclude} is needed (Lombok reports those as
     * redundant). Marking it {@code @Include} instead would initialise the
     * collection and recurse through {@code ResourceAllocation.resource}.
     */
    @OneToMany(mappedBy = "resource", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    @Builder.Default
    private List<ResourceAllocation> allocations = new ArrayList<>();
}