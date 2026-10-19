package com.pstu.backend.service;

import com.pstu.backend.dto.ResourceRequest;
import com.pstu.backend.dto.ResourceResponse;
import com.pstu.backend.entity.Resource;
import com.pstu.backend.enums.ResourceStatus;
import com.pstu.backend.enums.ResourceType;
import com.pstu.backend.repository.ResourceRepository;
import com.pstu.backend.pipeline.CorrelationIdFilter;
import com.pstu.backend.pipeline.DomainEventType;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@Transactional
public class ResourceService {

    private final ResourceRepository resourceRepository;
    private final EventPublisher eventPublisher;

    public ResourceService(ResourceRepository resourceRepository, EventPublisher eventPublisher) {
        this.resourceRepository = resourceRepository;
        this.eventPublisher = eventPublisher;
    }

    public ResourceResponse registerResource(ResourceRequest request) {
        Resource resource = Resource.builder()
                .resourceId(UUID.randomUUID().toString())
                .type(request.getType())
                .latitude(request.getLatitude())
                .longitude(request.getLongitude())
                .status(ResourceStatus.AVAILABLE)
                .capacity(request.getCapacity())
                .currentLoad(0)
                .travelSpeedKmh(request.getTravelSpeedKmh())
                .operationalConstraints(request.getOperationalConstraints())
                .available(true)
                .build();

        resource = resourceRepository.save(resource);
        return toResponse(resource);
    }

    @Transactional(readOnly = true)
    public ResourceResponse getResourceById(Long id) {
        Resource resource = findById(id);
        return toResponse(resource);
    }

    @Transactional(readOnly = true)
    public ResourceResponse getResourceByResourceId(String resourceId) {
        Resource resource = resourceRepository.findByResourceId(resourceId)
                .orElseThrow(() -> new EntityNotFoundException("Resource not found: " + resourceId));
        return toResponse(resource);
    }

    @Transactional(readOnly = true)
    public List<ResourceResponse> getAllResources() {
        return resourceRepository.findAll().stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<ResourceResponse> getAvailableResources() {
        return resourceRepository.findByAvailableTrue().stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<ResourceResponse> getResourcesByType(ResourceType type) {
        return resourceRepository.findByTypeAndStatus(type, ResourceStatus.AVAILABLE).stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<ResourceResponse> getResourcesInRegion(Double minLat, Double maxLat, Double minLon, Double maxLon) {
        return resourceRepository.findResourcesInRegion(minLat, maxLat, minLon, maxLon).stream().map(this::toResponse).toList();
    }

    public ResourceResponse updateResourceStatus(Long id, ResourceStatus status) {
        Resource resource = findById(id);
        ResourceStatus previous = resource.getStatus();
        resource.setStatus(status);
        resource.setAvailable(status == ResourceStatus.AVAILABLE || status == ResourceStatus.STANDBY);
        resource = resourceRepository.save(resource);
        publishStatusChanged(resource, previous, "status update");
        return toResponse(resource);
    }

    public ResourceResponse updateResourceLocation(Long id, Double latitude, Double longitude) {
        Resource resource = findById(id);
        resource.setLatitude(latitude);
        resource.setLongitude(longitude);
        resource = resourceRepository.save(resource);
        return toResponse(resource);
    }

    public ResourceResponse updateResourceLoad(Long id, Integer currentLoad) {
        Resource resource = findById(id);
        resource.setCurrentLoad(currentLoad);
        resource.setAvailable(currentLoad < resource.getCapacity());
        resource = resourceRepository.save(resource);
        return toResponse(resource);
    }

    public void reportResourceFailure(Long id) {
        Resource resource = findById(id);
        ResourceStatus previous = resource.getStatus();
        resource.setStatus(ResourceStatus.OFFLINE);
        resource.setAvailable(false);
        resourceRepository.save(resource);
        publishStatusChanged(resource, previous, "unit reported failed");
    }

    public void reportResourceMaintenance(Long id) {
        Resource resource = findById(id);
        ResourceStatus previous = resource.getStatus();
        resource.setStatus(ResourceStatus.MAINTENANCE);
        resource.setAvailable(false);
        resourceRepository.save(resource);
        publishStatusChanged(resource, previous, "scheduled maintenance");
    }

    public void restoreResource(Long id) {
        Resource resource = findById(id);
        ResourceStatus previous = resource.getStatus();
        resource.setStatus(ResourceStatus.AVAILABLE);
        resource.setAvailable(true);
        resourceRepository.save(resource);
        publishStatusChanged(resource, previous, "unit restored");
    }

    public void deleteResource(Long id) {
        Resource resource = findById(id);
        resourceRepository.delete(resource);
    }

    private Resource findById(Long id) {
        return resourceRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Resource not found with id: " + id));
    }

    /**
     * Publishes a fleet fact so the optimizer and any external consumer learn about
     * a unit going offline without polling {@code /resources}.
     *
     * <p>Keyed by {@code resourceId}, which keeps all events for one unit ordered
     * on a single partition.
     */
    private void publishStatusChanged(Resource resource, ResourceStatus previous, String reason) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("resourceId", resource.getResourceId());
        payload.put("resourceType", resource.getType() == null ? null : resource.getType().name());
        payload.put("previousStatus", previous == null ? null : previous.name());
        payload.put("status", resource.getStatus() == null ? null : resource.getStatus().name());
        payload.put("available", resource.getAvailable());
        payload.put("currentLoad", resource.getCurrentLoad());
        payload.put("capacity", resource.getCapacity());
        payload.put("reason", reason);

        eventPublisher.publish(EventEnvelope.of(
                DomainEventType.RESOURCE_STATUS_CHANGED.name(),
                resource.getResourceId(),
                resource.getResourceId(),
                payload,
                CorrelationIdFilter.currentOrRandom()));
    }

    private ResourceResponse toResponse(Resource resource) {
        return ResourceResponse.builder()
                .id(resource.getId())
                .resourceId(resource.getResourceId())
                .type(resource.getType())
                .latitude(resource.getLatitude())
                .longitude(resource.getLongitude())
                .status(resource.getStatus())
                .capacity(resource.getCapacity())
                .currentLoad(resource.getCurrentLoad())
                .travelSpeedKmh(resource.getTravelSpeedKmh())
                .available(resource.getAvailable())
                .operationalConstraints(resource.getOperationalConstraints())
                .createdAt(resource.getCreatedAt())
                .updatedAt(resource.getUpdatedAt())
                .build();
    }
}