package com.pstu.backend.dto;

import com.pstu.backend.entity.RoadNetwork.RoadStatus;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoadNetworkRequest {

    @NotBlank(message = "From location is required")
    @Size(max = 200)
    private String fromLocation;

    @NotBlank(message = "To location is required")
    @Size(max = 200)
    private String toLocation;

    @NotNull(message = "From latitude is required")
    @DecimalMin(value = "-90.0", message = "Latitude must be between -90 and 90")
    @DecimalMax(value = "90.0", message = "Latitude must be between -90 and 90")
    private Double fromLatitude;

    @NotNull(message = "From longitude is required")
    @DecimalMin(value = "-180.0", message = "Longitude must be between -180 and 180")
    @DecimalMax(value = "180.0", message = "Longitude must be between -180 and 180")
    private Double fromLongitude;

    @NotNull(message = "To latitude is required")
    @DecimalMin(value = "-90.0", message = "Latitude must be between -90 and 90")
    @DecimalMax(value = "90.0", message = "Latitude must be between -90 and 90")
    private Double toLatitude;

    @NotNull(message = "To longitude is required")
    @DecimalMin(value = "-180.0", message = "Longitude must be between -180 and 180")
    @DecimalMax(value = "180.0", message = "Longitude must be between -180 and 180")
    private Double toLongitude;

    @NotNull(message = "Distance is required")
    @Min(value = 0, message = "Distance must be at least 0")
    private Double distanceKm;

    @NotNull(message = "Travel time is required")
    @Min(value = 0, message = "Travel time must be at least 0")
    private Double travelTimeMinutes;

    private RoadStatus status;
}
