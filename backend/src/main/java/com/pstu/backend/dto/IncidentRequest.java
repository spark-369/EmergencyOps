package com.pstu.backend.dto;

import com.pstu.backend.enums.IncidentSeverity;
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

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IncidentRequest {

    @NotNull(message = "Latitude is required")
    @DecimalMin(value = "-90.0", message = "Latitude must be between -90 and 90")
    @DecimalMax(value = "90.0", message = "Latitude must be between -90 and 90")
    private Double latitude;

    @NotNull(message = "Longitude is required")
    @DecimalMin(value = "-180.0", message = "Longitude must be between -180 and 180")
    @DecimalMax(value = "180.0", message = "Longitude must be between -180 and 180")
    private Double longitude;

    @NotBlank(message = "Location description is required")
    @Size(max = 500)
    private String locationDescription;

    @NotNull(message = "Severity is required")
    private IncidentSeverity severity;

    @NotNull(message = "Number of affected people is required")
    @Min(value = 1, message = "At least 1 person affected")
    private Integer affectedPeople;

    @NotNull(message = "Time sensitivity is required")
    @Min(value = 1, message = "Time sensitivity must be at least 1 minute")
    private Integer timeSensitivityMinutes;

    private Map<String, Object> resourceRequirements;

    private Map<String, Object> environmentalConditions;
}