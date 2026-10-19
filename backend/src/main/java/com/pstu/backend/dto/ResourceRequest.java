package com.pstu.backend.dto;

import com.pstu.backend.enums.ResourceType;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Registration payload for a unit joining the fleet.
 *
 * <p><strong>No {@code resourceId}.</strong> The identifier is generated server-side
 * ({@code ResourceService.registerResource} assigns a UUID), so accepting one from the
 * client would either be ignored or let a caller choose a collision-prone key. It was
 * declared here as {@code @NotBlank} and then discarded, which made every client that
 * omitted it fail validation with a 400 for a field it had no reason to send. The
 * identifier is returned in {@code ResourceResponse}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResourceRequest {

    @NotNull(message = "Resource type is required")
    private ResourceType type;

    @NotNull(message = "Latitude is required")
    @DecimalMin(value = "-90.0", message = "Latitude must be between -90 and 90")
    @DecimalMax(value = "90.0", message = "Latitude must be between -90 and 90")
    private Double latitude;

    @NotNull(message = "Longitude is required")
    @DecimalMin(value = "-180.0", message = "Longitude must be between -180 and 180")
    @DecimalMax(value = "180.0", message = "Longitude must be between -180 and 180")
    private Double longitude;

    @NotNull(message = "Capacity is required")
    @Min(value = 1, message = "Capacity must be at least 1")
    private Integer capacity;

    @NotNull(message = "Travel speed is required")
    @Min(value = 1, message = "Travel speed must be at least 1 km/h")
    private Double travelSpeedKmh;

    private Map<String, Object> operationalConstraints;
}