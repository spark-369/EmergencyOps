package com.pstu.backend.dto;

import com.pstu.backend.entity.Hospital.HospitalStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class HospitalResponse {

    private Long id;
    private String hospitalId;
    private String name;
    private Double latitude;
    private Double longitude;
    private Integer totalBeds;
    private Integer availableBeds;
    private Integer icuCapacity;
    private Integer icuAvailable;
    private Integer emergencyCapacity;
    private Integer emergencyAvailable;
    private HospitalStatus status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
