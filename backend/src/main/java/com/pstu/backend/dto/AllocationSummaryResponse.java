package com.pstu.backend.dto;

import com.pstu.backend.enums.AllocationStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AllocationSummaryResponse {

    private Long id;
    private String incidentId;
    private String resourceId;
    private String resourceType;
    private AllocationStatus status;
    private Integer estimatedTravelTimeMinutes;
    private Integer estimatedResolutionTimeMinutes;
    private String decisionRationale;
    private LocalDateTime allocatedAt;
}