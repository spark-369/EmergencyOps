package com.pstu.backend.dto;

import com.pstu.backend.entity.RoadNetwork.RoadStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoadNetworkResponse {

    private Long id;
    private String fromLocation;
    private String toLocation;
    private Double fromLatitude;
    private Double fromLongitude;
    private Double toLatitude;
    private Double toLongitude;
    private Double distanceKm;
    private Double travelTimeMinutes;
    private RoadStatus status;
    private LocalDateTime lastUpdated;
}
