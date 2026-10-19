package com.pstu.backend.service;

import com.pstu.backend.dto.HospitalRequest;
import com.pstu.backend.dto.HospitalResponse;
import com.pstu.backend.entity.Hospital;
import com.pstu.backend.entity.Hospital.HospitalStatus;
import com.pstu.backend.repository.HospitalRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class HospitalService {

    private final HospitalRepository hospitalRepository;

    public HospitalService(HospitalRepository hospitalRepository) {
        this.hospitalRepository = hospitalRepository;
    }

    public HospitalResponse registerHospital(HospitalRequest request) {
        Hospital hospital = Hospital.builder()
                .hospitalId(request.getHospitalId())
                .name(request.getName())
                .latitude(request.getLatitude())
                .longitude(request.getLongitude())
                .totalBeds(request.getTotalBeds())
                .availableBeds(request.getTotalBeds())
                .icuCapacity(request.getIcuCapacity())
                .icuAvailable(request.getIcuCapacity())
                .emergencyCapacity(request.getEmergencyCapacity())
                .emergencyAvailable(request.getEmergencyCapacity())
                .status(request.getStatus() != null ? request.getStatus() : HospitalStatus.OPERATIONAL)
                .build();

        hospital = hospitalRepository.save(hospital);
        return toResponse(hospital);
    }

    @Transactional(readOnly = true)
    public HospitalResponse getHospitalById(Long id) {
        Hospital hospital = findById(id);
        return toResponse(hospital);
    }

    @Transactional(readOnly = true)
    public HospitalResponse getHospitalByHospitalId(String hospitalId) {
        Hospital hospital = hospitalRepository.findByHospitalId(hospitalId)
                .orElseThrow(() -> new EntityNotFoundException("Hospital not found: " + hospitalId));
        return toResponse(hospital);
    }

    @Transactional(readOnly = true)
    public List<HospitalResponse> getAllHospitals() {
        return hospitalRepository.findAll().stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<HospitalResponse> getAvailableHospitals() {
        return hospitalRepository.findOperationalWithAvailableBeds(HospitalStatus.OPERATIONAL)
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<HospitalResponse> getHospitalsInRegion(Double minLat, Double maxLat, Double minLon, Double maxLon) {
        return hospitalRepository.findHospitalsInRegion(minLat, maxLat, minLon, maxLon)
                .stream().map(this::toResponse).toList();
    }

    public HospitalResponse updateHospitalStatus(Long id, HospitalStatus status) {
        Hospital hospital = findById(id);
        hospital.setStatus(status);
        hospital = hospitalRepository.save(hospital);
        return toResponse(hospital);
    }

    public HospitalResponse updateBedAvailability(Long id, Integer availableBeds, Integer icuAvailable, Integer emergencyAvailable) {
        Hospital hospital = findById(id);
        if (availableBeds != null) {
            hospital.setAvailableBeds(availableBeds);
        }
        if (icuAvailable != null) {
            hospital.setIcuAvailable(icuAvailable);
        }
        if (emergencyAvailable != null) {
            hospital.setEmergencyAvailable(emergencyAvailable);
        }
        hospital = hospitalRepository.save(hospital);
        return toResponse(hospital);
    }

    public void deleteHospital(Long id) {
        Hospital hospital = findById(id);
        hospitalRepository.delete(hospital);
    }

    private Hospital findById(Long id) {
        return hospitalRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Hospital not found with id: " + id));
    }

    private HospitalResponse toResponse(Hospital hospital) {
        return HospitalResponse.builder()
                .id(hospital.getId())
                .hospitalId(hospital.getHospitalId())
                .name(hospital.getName())
                .latitude(hospital.getLatitude())
                .longitude(hospital.getLongitude())
                .totalBeds(hospital.getTotalBeds())
                .availableBeds(hospital.getAvailableBeds())
                .icuCapacity(hospital.getIcuCapacity())
                .icuAvailable(hospital.getIcuAvailable())
                .emergencyCapacity(hospital.getEmergencyCapacity())
                .emergencyAvailable(hospital.getEmergencyAvailable())
                .status(hospital.getStatus())
                .createdAt(hospital.getCreatedAt())
                .updatedAt(hospital.getUpdatedAt())
                .build();
    }
}
