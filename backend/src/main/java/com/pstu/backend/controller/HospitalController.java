package com.pstu.backend.controller;

import com.pstu.backend.dto.HospitalRequest;
import com.pstu.backend.dto.HospitalResponse;
import com.pstu.backend.entity.Hospital.HospitalStatus;
import com.pstu.backend.service.HospitalService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Hospital capacity management.
 *
 * <p>Any authenticated role may read capacity; registration and status/bed
 * updates require an operational role; deletion is restricted to dispatchers and
 * admins because it invalidates the allocations that reference the hospital.
 */
@RestController
@RequestMapping("/api/v1/hospitals")
@PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR','VIEWER')")
public class HospitalController {

    private final HospitalService hospitalService;

    public HospitalController(HospitalService hospitalService) {
        this.hospitalService = hospitalService;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER')")
    public ResponseEntity<HospitalResponse> registerHospital(@Valid @RequestBody HospitalRequest request) {
        HospitalResponse response = hospitalService.registerHospital(request);
        return new ResponseEntity<>(response, HttpStatus.CREATED);
    }

    @GetMapping("/{id}")
    public ResponseEntity<HospitalResponse> getHospitalById(@PathVariable Long id) {
        HospitalResponse response = hospitalService.getHospitalById(id);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/hospital-id/{hospitalId}")
    public ResponseEntity<HospitalResponse> getHospitalByHospitalId(@PathVariable String hospitalId) {
        HospitalResponse response = hospitalService.getHospitalByHospitalId(hospitalId);
        return ResponseEntity.ok(response);
    }

    @GetMapping
    public ResponseEntity<List<HospitalResponse>> getAllHospitals() {
        List<HospitalResponse> response = hospitalService.getAllHospitals();
        return ResponseEntity.ok(response);
    }

    @GetMapping("/available")
    public ResponseEntity<List<HospitalResponse>> getAvailableHospitals() {
        List<HospitalResponse> response = hospitalService.getAvailableHospitals();
        return ResponseEntity.ok(response);
    }

    @GetMapping("/region")
    public ResponseEntity<List<HospitalResponse>> getHospitalsInRegion(
            @RequestParam Double minLat,
            @RequestParam Double maxLat,
            @RequestParam Double minLon,
            @RequestParam Double maxLon) {
        List<HospitalResponse> response = hospitalService.getHospitalsInRegion(minLat, maxLat, minLon, maxLon);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR')")
    public ResponseEntity<HospitalResponse> updateHospitalStatus(
            @PathVariable Long id,
            @RequestParam HospitalStatus status) {
        HospitalResponse response = hospitalService.updateHospitalStatus(id, status);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}/beds")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR')")
    public ResponseEntity<HospitalResponse> updateBedAvailability(
            @PathVariable Long id,
            @RequestParam(required = false) Integer availableBeds,
            @RequestParam(required = false) Integer icuAvailable,
            @RequestParam(required = false) Integer emergencyAvailable) {
        HospitalResponse response = hospitalService.updateBedAvailability(id, availableBeds, icuAvailable, emergencyAvailable);
        return ResponseEntity.ok(response);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER')")
    public ResponseEntity<Void> deleteHospital(@PathVariable Long id) {
        hospitalService.deleteHospital(id);
        return ResponseEntity.noContent().build();
    }
}
