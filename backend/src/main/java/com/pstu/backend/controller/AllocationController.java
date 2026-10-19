package com.pstu.backend.controller;

import com.pstu.backend.dto.AllocationRequest;
import com.pstu.backend.dto.AllocationResponse;
import com.pstu.backend.dto.AllocationSummaryResponse;
import com.pstu.backend.enums.AllocationStatus;
import com.pstu.backend.service.AllocationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Dispatch and allocation.
 *
 * <p>Field operators may progress an allocation (status) and cancel it, because
 * that mirrors what they do in the field; creating a new allocation is a
 * dispatch decision and is reserved for dispatchers and admins.
 */
@RestController
@RequestMapping("/api/v1/allocations")
@PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR','VIEWER')")
public class AllocationController {

    private final AllocationService allocationService;

    public AllocationController(AllocationService allocationService) {
        this.allocationService = allocationService;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER')")
    public ResponseEntity<AllocationResponse> allocateResource(@Valid @RequestBody AllocationRequest request) {
        AllocationResponse response = allocationService.allocateResource(request);
        return new ResponseEntity<>(response, HttpStatus.CREATED);
    }

    @GetMapping("/{id}")
    public ResponseEntity<AllocationResponse> getAllocationById(@PathVariable Long id) {
        AllocationResponse response = allocationService.getAllocationById(id);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/incident/{incidentId}")
    public ResponseEntity<List<AllocationResponse>> getAllocationsByIncident(@PathVariable String incidentId) {
        List<AllocationResponse> response = allocationService.getAllocationsByIncident(incidentId);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/active")
    public ResponseEntity<List<AllocationResponse>> getActiveAllocations() {
        List<AllocationResponse> response = allocationService.getActiveAllocations();
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR')")
    public ResponseEntity<AllocationResponse> updateAllocationStatus(
            @PathVariable Long id,
            @RequestParam AllocationStatus status) {
        AllocationResponse response = allocationService.updateAllocationStatus(id, status);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR')")
    public ResponseEntity<AllocationResponse> cancelAllocation(@PathVariable Long id) {
        allocationService.cancelAllocation(id);
        AllocationResponse response = allocationService.getAllocationById(id);
        return ResponseEntity.ok(response);
    }

    /**
     * Compact per-incident view used by the incident detail drawer.
     *
     * <p>The mapping lives in the service layer so `resourceType` is derived from
     * the resource's `ResourceType` enum. It previously echoed `getResourceId()`,
     * which made every row display a UUID where a resource type was expected.
     */
    @GetMapping("/incident/{incidentId}/summary")
    public ResponseEntity<List<AllocationSummaryResponse>> getAllocationSummaryByIncident(@PathVariable String incidentId) {
        List<AllocationSummaryResponse> summaries =
                allocationService.getAllocationSummariesByIncident(incidentId);
        return ResponseEntity.ok(summaries);
    }
}