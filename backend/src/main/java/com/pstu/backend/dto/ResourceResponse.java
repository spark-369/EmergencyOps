package com.pstu.backend.dto;

import com.pstu.backend.enums.ResourceStatus;
import com.pstu.backend.enums.ResourceType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResourceResponse {

    /**
     * Numeric primary key.
     *
     * <p>Required by the client: every mutating resource endpoint addresses a unit by
     * this id ({@code PATCH /resources/{id}/status}, {@code POST /{id}/failure}, …),
     * while {@code resourceId} below is the UUID business key used by
     * {@code GET /resource-id/{resourceId}}. Without this field the console could
     * list resources but had no way to act on one — the Manage panel stayed disabled
     * because it had no id to send.
     */
    private Long id;

    private String resourceId;
    private ResourceType type;
    private Double latitude;
    private Double longitude;
    private ResourceStatus status;
    private Integer capacity;
    private Integer currentLoad;
    private Double travelSpeedKmh;
    private Boolean available;
    private Map<String, Object> operationalConstraints;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}