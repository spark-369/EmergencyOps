package com.pstu.backend.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/** A directed road segment between two named locations. */
@Entity
@Table(name = "road_network")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@ToString(onlyExplicitlyIncluded = true)
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
public class RoadNetwork {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @EqualsAndHashCode.Include
    @ToString.Include
    private Long id;

    @Column(nullable = false)
    @ToString.Include
    private String fromLocation;

    @Column(nullable = false)
    @ToString.Include
    private String toLocation;

    @Column(nullable = false)
    private Double fromLatitude;

    @Column(nullable = false)
    private Double fromLongitude;

    @Column(nullable = false)
    private Double toLatitude;

    @Column(nullable = false)
    private Double toLongitude;

    @Column(nullable = false)
    private Double distanceKm;

    @Column(nullable = false)
    private Double travelTimeMinutes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RoadStatus status;

    @UpdateTimestamp
    private LocalDateTime lastUpdated;

    public enum RoadStatus {
        OPEN,
        CLOSED,
        DELAYED,
        CONGESTED
    }
}