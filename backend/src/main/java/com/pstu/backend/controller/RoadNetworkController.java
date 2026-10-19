package com.pstu.backend.controller;

import com.pstu.backend.dto.RoadNetworkRequest;
import com.pstu.backend.dto.RoadNetworkResponse;
import com.pstu.backend.entity.RoadNetwork.RoadStatus;
import com.pstu.backend.service.RoadNetworkService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Road segments used by the routing heuristics.
 *
 * <p>Status and travel-time corrections are a field-operator task; creating or
 * deleting a segment changes the routing graph and stays with dispatchers/admins.
 */
@RestController
@RequestMapping("/api/v1/road-network")
@PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR','VIEWER')")
public class RoadNetworkController {

    private final RoadNetworkService roadNetworkService;

    public RoadNetworkController(RoadNetworkService roadNetworkService) {
        this.roadNetworkService = roadNetworkService;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER')")
    public ResponseEntity<RoadNetworkResponse> createRoadSegment(@Valid @RequestBody RoadNetworkRequest request) {
        RoadNetworkResponse response = roadNetworkService.createRoadSegment(request);
        return new ResponseEntity<>(response, HttpStatus.CREATED);
    }

    @GetMapping("/{id}")
    public ResponseEntity<RoadNetworkResponse> getRoadSegmentById(@PathVariable Long id) {
        RoadNetworkResponse response = roadNetworkService.getRoadSegmentById(id);
        return ResponseEntity.ok(response);
    }

    @GetMapping
    public ResponseEntity<List<RoadNetworkResponse>> getAllRoadSegments() {
        List<RoadNetworkResponse> response = roadNetworkService.getAllRoadSegments();
        return ResponseEntity.ok(response);
    }

    @GetMapping("/status/{status}")
    public ResponseEntity<List<RoadNetworkResponse>> getRoadSegmentsByStatus(@PathVariable RoadStatus status) {
        List<RoadNetworkResponse> response = roadNetworkService.getRoadSegmentsByStatus(status);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/route")
    public ResponseEntity<List<RoadNetworkResponse>> getRoadSegmentsBetweenLocations(
            @RequestParam String fromLocation,
            @RequestParam String toLocation) {
        List<RoadNetworkResponse> response = roadNetworkService.getRoadSegmentsBetweenLocations(fromLocation, toLocation);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR')")
    public ResponseEntity<RoadNetworkResponse> updateRoadStatus(
            @PathVariable Long id,
            @RequestParam RoadStatus status) {
        RoadNetworkResponse response = roadNetworkService.updateRoadStatus(id, status);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR')")
    public ResponseEntity<RoadNetworkResponse> updateTravelInfo(
            @PathVariable Long id,
            @RequestParam(required = false) Double distanceKm,
            @RequestParam(required = false) Double travelTimeMinutes) {
        RoadNetworkResponse response = roadNetworkService.updateTravelInfo(id, distanceKm, travelTimeMinutes);
        return ResponseEntity.ok(response);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER')")
    public ResponseEntity<Void> deleteRoadSegment(@PathVariable Long id) {
        roadNetworkService.deleteRoadSegment(id);
        return ResponseEntity.noContent().build();
    }
}
