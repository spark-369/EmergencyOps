package com.pstu.backend.service;

import com.pstu.backend.dto.IncidentRequest;
import com.pstu.backend.dto.IncidentResponse;
import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.repository.IncidentRepository;
import com.pstu.backend.repository.ResourceRepository;
import com.pstu.backend.util.PriorityCalculator;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class IncidentService {

    private final IncidentRepository incidentRepository;
    private final IncidentLifecycleService lifecycleService;

    public IncidentService(IncidentRepository incidentRepository, ResourceRepository resourceRepository,
                           IncidentLifecycleService lifecycleService) {
        this.incidentRepository = incidentRepository;
        this.lifecycleService = lifecycleService;
    }

    /**
     * Records a new report.
     *
     * <p>The incident is stored as {@code PRIORITIZED}, not {@code RECEIVED}: the
     * priority score is computed synchronously in the same transaction
     * ({@link PriorityCalculator}), so "received" would be a state nobody ever
     * observes and the lifecycle would carry a transition that never happens.
     * {@code INCIDENT_CREATED} is published in the same transaction by
     * {@link IncidentLifecycleService}.
     */
    public IncidentResponse createIncident(IncidentRequest request) {
        EmergencyIncident incident = EmergencyIncident.builder()
                .incidentId(UUID.randomUUID().toString())
                .latitude(request.getLatitude())
                .longitude(request.getLongitude())
                .locationDescription(request.getLocationDescription())
                .severity(request.getSeverity())
                .affectedPeople(request.getAffectedPeople())
                .timeSensitivityMinutes(request.getTimeSensitivityMinutes())
                .resourceRequirements(request.getResourceRequirements())
                .environmentalConditions(request.getEnvironmentalConditions())
                .status(IncidentStatus.PRIORITIZED)
                .priorityScore(calculatePriority(request))
                .estimatedResponseTimeMinutes(estimateResponseTime(request))
                .build();

        incident = incidentRepository.save(incident);
        lifecycleService.publishCreated(incident);
        return toResponse(incident);
    }

    @Transactional(readOnly = true)
    public IncidentResponse getIncidentById(Long id) {
        EmergencyIncident incident = findById(id);
        return toResponse(incident);
    }

    @Transactional(readOnly = true)
    public IncidentResponse getIncidentByIncidentId(String incidentId) {
        EmergencyIncident incident = incidentRepository.findByIncidentId(incidentId)
                .orElseThrow(() -> new EntityNotFoundException("Incident not found: " + incidentId));
        return toResponse(incident);
    }

    @Transactional(readOnly = true)
    public Page<IncidentResponse> getAllIncidents(Pageable pageable) {
        return incidentRepository.findAll(pageable).map(this::toResponse);
    }

    @Transactional(readOnly = true)
    public List<IncidentResponse> getActiveIncidents() {
        return incidentRepository.findActiveIncidentsByStatuses(
                List.of(IncidentStatus.RECEIVED, IncidentStatus.PRIORITIZED, IncidentStatus.ALLOCATING, IncidentStatus.IN_PROGRESS))
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<IncidentResponse> getIncidentsBySeverity(IncidentSeverity severity) {
        return incidentRepository.findBySeverityOrderByPriorityScoreDesc(severity).stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<IncidentResponse> getIncidentsInRegion(Double minLat, Double maxLat, Double minLon, Double maxLon) {
        return incidentRepository.findIncidentsInRegion(minLat, maxLat, minLon, maxLon).stream().map(this::toResponse).toList();
    }

    public IncidentResponse updateIncidentStatus(Long id, IncidentStatus status) {
        EmergencyIncident incident = lifecycleService.transition(id, status);
        return toResponse(incident);
    }

    public void deleteIncident(Long id) {
        EmergencyIncident incident = findById(id);
        incidentRepository.delete(incident);
    }

    public void reassignPriority(Long id) {
        EmergencyIncident incident = findById(id);
        incident.setPriorityScore(PriorityCalculator.calculatePriority(incident));
        incident.setEstimatedResponseTimeMinutes(estimateResponseTimeFromEntity(incident));
        incidentRepository.save(incident);
    }

    private EmergencyIncident findById(Long id) {
        return incidentRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Incident not found with id: " + id));
    }

    /**
     * Priority for a not-yet-persisted report. Builds the same entity shape
     * {@link PriorityCalculator} expects, so the create path and the recompute path
     * cannot drift apart.
     */
    private int calculatePriority(IncidentRequest request) {
        return PriorityCalculator.calculatePriority(EmergencyIncident.builder()
                .severity(request.getSeverity())
                .affectedPeople(request.getAffectedPeople())
                .timeSensitivityMinutes(request.getTimeSensitivityMinutes())
                .environmentalConditions(request.getEnvironmentalConditions())
                .build());
    }

    /**
     * Operational promise, not the engine's ETA: the worst response time the
     * severity tolerates, tightened by how urgent the caller says the scene is.
     */
    private int estimateResponseTime(IncidentRequest request) {
        int baseTime = switch (request.getSeverity()) {
            case LOW -> 60;
            case MEDIUM -> 45;
            case HIGH -> 30;
            case CRITICAL -> 15;
            case CATASTROPHIC -> 10;
        };
        return Math.max(baseTime - request.getTimeSensitivityMinutes(), 5);
    }

    private int estimateResponseTimeFromEntity(EmergencyIncident incident) {
        int baseTime = switch (incident.getSeverity()) {
            case LOW -> 60;
            case MEDIUM -> 45;
            case HIGH -> 30;
            case CRITICAL -> 15;
            case CATASTROPHIC -> 10;
        };
        return Math.max(baseTime - incident.getTimeSensitivityMinutes(), 5);
    }

    private IncidentResponse toResponse(EmergencyIncident incident) {
        List<IncidentResponse.AllocationSummary> allocationSummaries = incident.getAllocations().stream()
                .map(a -> IncidentResponse.AllocationSummary.builder()
                        .resourceId(a.getResource().getResourceId())
                        .resourceType(a.getResource().getType().name())
                        .status(a.getStatus())
                        .estimatedTravelTimeMinutes(a.getEstimatedTravelTimeMinutes())
                        .build())
                .toList();

        return IncidentResponse.builder()
                .id(incident.getId())
                .incidentId(incident.getIncidentId())
                .latitude(incident.getLatitude())
                .longitude(incident.getLongitude())
                .locationDescription(incident.getLocationDescription())
                .severity(incident.getSeverity())
                .affectedPeople(incident.getAffectedPeople())
                .timeSensitivityMinutes(incident.getTimeSensitivityMinutes())
                .resourceRequirements(incident.getResourceRequirements())
                .environmentalConditions(incident.getEnvironmentalConditions())
                .status(incident.getStatus())
                .priorityScore(incident.getPriorityScore())
                .estimatedResponseTimeMinutes(incident.getEstimatedResponseTimeMinutes())
                .createdAt(incident.getCreatedAt())
                .updatedAt(incident.getUpdatedAt())
                .allocations(allocationSummaries)
                .build();
    }
}