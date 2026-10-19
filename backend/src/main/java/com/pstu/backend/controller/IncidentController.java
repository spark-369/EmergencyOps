package com.pstu.backend.controller;

import com.pstu.backend.dto.IncidentRequest;
import com.pstu.backend.dto.IncidentResponse;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.service.IncidentLifecycleService;
import com.pstu.backend.service.IncidentService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Comparator;
import java.util.List;

/**
 * Incident lifecycle.
 *
 * <p>Reads and writes share a class-level rule (any authenticated role); the
 * destructive {@code DELETE} is narrowed at the method to dispatchers and admins.
 */
@RestController
@RequestMapping("/api/v1/incidents")
@PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR','VIEWER')")
public class IncidentController {

    private final IncidentService incidentService;
    private final IncidentLifecycleService lifecycleService;

    public IncidentController(IncidentService incidentService, IncidentLifecycleService lifecycleService) {
        this.incidentService = incidentService;
        this.lifecycleService = lifecycleService;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR')")
    public ResponseEntity<IncidentResponse> createIncident(@Valid @RequestBody IncidentRequest request) {
        IncidentResponse response = incidentService.createIncident(request);
        return new ResponseEntity<>(response, HttpStatus.CREATED);
    }

    @GetMapping("/{id}")
    public ResponseEntity<IncidentResponse> getIncidentById(@PathVariable Long id) {
        IncidentResponse response = incidentService.getIncidentById(id);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/incident-id/{incidentId}")
    public ResponseEntity<IncidentResponse> getIncidentByIncidentId(@PathVariable String incidentId) {
        IncidentResponse response = incidentService.getIncidentByIncidentId(incidentId);
        return ResponseEntity.ok(response);
    }

    @GetMapping
    public ResponseEntity<Page<IncidentResponse>> getAllIncidents(Pageable pageable) {
        Page<IncidentResponse> response = incidentService.getAllIncidents(pageable);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/active")
    public ResponseEntity<List<IncidentResponse>> getActiveIncidents() {
        List<IncidentResponse> response = incidentService.getActiveIncidents();
        return ResponseEntity.ok(response);
    }

    @GetMapping("/severity/{severity}")
    public ResponseEntity<List<IncidentResponse>> getIncidentsBySeverity(@PathVariable IncidentSeverity severity) {
        List<IncidentResponse> response = incidentService.getIncidentsBySeverity(severity);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/region")
    public ResponseEntity<List<IncidentResponse>> getIncidentsInRegion(
            @RequestParam Double minLat,
            @RequestParam Double maxLat,
            @RequestParam Double minLon,
            @RequestParam Double maxLon) {
        List<IncidentResponse> response = incidentService.getIncidentsInRegion(minLat, maxLat, minLon, maxLon);
        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR')")
    public ResponseEntity<IncidentResponse> updateIncidentStatus(
            @PathVariable Long id,
            @RequestParam IncidentStatus status) {
        IncidentResponse response = incidentService.updateIncidentStatus(id, status);
        return ResponseEntity.ok(response);
    }

    /**
     * The statuses this incident may legally move to next.
     *
     * <p>Exposed so a console can render only the buttons that will work instead
     * of offering an action and answering 409 — the error stays as the guard, this
     * is the affordance.
     */
    @GetMapping("/incident-id/{incidentId}/allowed-transitions")
    public ResponseEntity<List<IncidentStatus>> getAllowedTransitions(@PathVariable String incidentId) {
        // Sorted by declaration order: an EnumSet's iteration order is the enum's,
        // but the API contract should not depend on that guarantee being honoured.
        List<IncidentStatus> allowed = lifecycleService.allowedTransitions(incidentId).stream()
                .sorted(Comparator.comparingInt(Enum::ordinal))
                .toList();
        return ResponseEntity.ok(allowed);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER')")
    public ResponseEntity<Void> deleteIncident(@PathVariable Long id) {
        incidentService.deleteIncident(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/reassign-priority")
    @PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR')")
    public ResponseEntity<IncidentResponse> reassignPriority(@PathVariable Long id) {
        incidentService.reassignPriority(id);
        IncidentResponse response = incidentService.getIncidentById(id);
        return ResponseEntity.ok(response);
    }
}