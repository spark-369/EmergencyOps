package com.pstu.backend.dto;

import jakarta.validation.constraints.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AllocationRequest {

    @NotBlank(message = "Incident ID is required")
    private String incidentId;

    @NotBlank(message = "Resource ID is required")
    private String resourceId;

    @NotNull(message = "Estimated travel time is required")
    @Min(value = 0, message = "Travel time cannot be negative")
    private Integer estimatedTravelTimeMinutes;

    @NotNull(message = "Estimated resolution time is required")
    @Min(value = 1, message = "Resolution time must be at least 1 minute")
    private Integer estimatedResolutionTimeMinutes;

    private String decisionRationale;
}