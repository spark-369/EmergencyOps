package com.pstu.backend.controller;

import com.pstu.backend.dto.ResourceRequest;
import com.pstu.backend.dto.ResourceResponse;
import com.pstu.backend.enums.ResourceType;
import com.pstu.backend.service.ResourceService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Fleet registry.
 *
 * <p>Field operators report failures, request maintenance and restore units —
 * that is the real-time loop — but registering or deleting a unit changes the
 * fleet inventory and stays with dispatchers/admins.
 */
@RestController
@RequestMapping("/api/v1/resources")
@PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR','VIEWER')")
public class ResourceController {

    private final ResourceService resourceService;

    public ResourceController(ResourceService resourceService) {
        this.resourceService = resourceService;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER')")
    public ResponseEntity<ResourceResponse> registerResource(@Valid @RequestBody ResourceRequest request) {
        ResourceResponse response = resourceService.registerResource(request);
        return new ResponseEntity<>(response, HttpStatus.CREATED);
    }

    @GetMapping("/{id}")
    public ResponseEntity<ResourceResponse> getResourceById(@PathVariable Long id) {
        ResourceResponse response = resourceService.getResourceById(id);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/resource-id/{resourceId}")
    public ResponseEntity<ResourceResponse> getResourceByResourceId(@PathVariable String resourceId) {
        ResourceResponse response = resourceService.getResourceByResourceId(resourceId);
        return ResponseEntity.ok(response);
    }

    @GetMapping
    public ResponseEntity<List<ResourceResponse>> getAllResources() {
        List<ResourceResponse> response = resourceService.getAllResources();
        return ResponseEntity.ok(response);
    }

    @GetMapping("/available")
    public ResponseEntity<List<ResourceResponse>> getAvailableResources() {
        List<ResourceResponse> response = resourceService.getAvailableResources();
        return ResponseEntity.ok(response);
    }

    @GetMapping("/type/{type}")
    public ResponseEntity<List<ResourceResponse>> getResourcesByType(@PathVariable ResourceType type) {
        List<ResourceResponse> response = resourceService.getResourcesByType(type);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/region")
    public ResponseEntity<List<ResourceResponse>> getResourcesInRegion(
            @RequestParam Double minLat,
            @RequestParam Double maxLat,
            @RequestParam Double minLon,
            @RequestParam Double maxLon) {
        List<ResourceResponse> response = resourceService.getResourcesInRegion(minLat, maxLat, minLon, maxLon);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<ResourceResponse> updateResourceStatus(
            @PathVariable Long id,
            @RequestParam com.pstu.backend.enums.ResourceStatus status) {
        ResourceResponse response = resourceService.updateResourceStatus(id, status);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}/location")
    public ResponseEntity<ResourceResponse> updateResourceLocation(
            @PathVariable Long id,
            @RequestParam Double latitude,
            @RequestParam Double longitude) {
        ResourceResponse response = resourceService.updateResourceLocation(id, latitude, longitude);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}/load")
    public ResponseEntity<ResourceResponse> updateResourceLoad(
            @PathVariable Long id,
            @RequestParam Integer currentLoad) {
        ResourceResponse response = resourceService.updateResourceLoad(id, currentLoad);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/{id}/failure")
    public ResponseEntity<Void> reportResourceFailure(@PathVariable Long id) {
        resourceService.reportResourceFailure(id);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{id}/maintenance")
    public ResponseEntity<Void> reportResourceMaintenance(@PathVariable Long id) {
        resourceService.reportResourceMaintenance(id);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/{id}/restore")
    public ResponseEntity<Void> restoreResource(@PathVariable Long id) {
        resourceService.restoreResource(id);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER')")
    public ResponseEntity<Void> deleteResource(@PathVariable Long id) {
        resourceService.deleteResource(id);
        return ResponseEntity.noContent().build();
    }
}