package com.pstu.backend.dto;

import com.pstu.backend.enums.AllocationStatus;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IncidentResponse {

    /**
     * JPA primary key. The REST paths `/incidents/{id}` therefore address this
     * value, not the business `incidentId` UUID — clients need it to call
     * PATCH/DELETE, so it must be serialised.
     */
    private Long id;
    private String incidentId;
    private Double latitude;
    private Double longitude;
    private String locationDescription;
    private IncidentSeverity severity;
    private Integer affectedPeople;
    private Integer timeSensitivityMinutes;
    private Map<String, Object> resourceRequirements;
    private Map<String, Object> environmentalConditions;
    private IncidentStatus status;
    private Integer priorityScore;
    private Integer estimatedResponseTimeMinutes;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private List<AllocationSummary> allocations;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AllocationSummary {
        private String resourceId;
        private String resourceType;
        private AllocationStatus status;
        private Integer estimatedTravelTimeMinutes;
    }
}