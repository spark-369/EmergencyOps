package com.pstu.backend.service;

import com.pstu.backend.dto.AllocationRequest;
import com.pstu.backend.dto.AllocationResponse;
import com.pstu.backend.dto.AllocationSummaryResponse;
import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.entity.Resource;
import com.pstu.backend.entity.ResourceAllocation;
import com.pstu.backend.enums.AllocationStatus;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.exception.AllocationLifecycle;
import com.pstu.backend.exception.IncidentLifecycle;
import com.pstu.backend.exception.InvalidStateTransitionException;
import com.pstu.backend.pipeline.CorrelationIdFilter;
import com.pstu.backend.pipeline.DomainEventType;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.AllocationRepository;
import com.pstu.backend.repository.IncidentRepository;
import com.pstu.backend.repository.ResourceRepository;
import jakarta.persistence.EntityNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@Transactional
public class AllocationService {

    private static final Logger log = LoggerFactory.getLogger(AllocationService.class);

    private final AllocationRepository allocationRepository;
    private final IncidentRepository incidentRepository;
    private final ResourceRepository resourceRepository;
    private final IncidentLifecycleService incidentLifecycleService;
    private final EventPublisher eventPublisher;

    public AllocationService(AllocationRepository allocationRepository,
                             IncidentRepository incidentRepository,
                             ResourceRepository resourceRepository,
                             IncidentLifecycleService incidentLifecycleService,
                             EventPublisher eventPublisher) {
        this.allocationRepository = allocationRepository;
        this.incidentRepository = incidentRepository;
        this.resourceRepository = resourceRepository;
        this.incidentLifecycleService = incidentLifecycleService;
        this.eventPublisher = eventPublisher;
    }

    public AllocationResponse allocateResource(AllocationRequest request) {
        EmergencyIncident incident = incidentRepository.findByIncidentId(request.getIncidentId())
                .orElseThrow(() -> new EntityNotFoundException("Incident not found: " + request.getIncidentId()));

        // A closed incident must not receive new units: that would reopen work
        // nobody is watching and, for a resolved incident, contradict the record.
        if (IncidentLifecycle.isTerminal(incident.getStatus())) {
            throw new InvalidStateTransitionException("Incident", incident.getIncidentId(),
                    incident.getStatus(), IncidentStatus.ALLOCATING,
                    "Terminal incidents cannot receive new allocations");
        }

        Resource resource = resourceRepository.findByResourceId(request.getResourceId())
                .orElseThrow(() -> new EntityNotFoundException("Resource not found: " + request.getResourceId()));

        if (!resource.getAvailable()) {
            throw new IllegalStateException("Resource is not available: " + request.getResourceId());
        }

        if (resource.getCurrentLoad() >= resource.getCapacity()) {
            throw new IllegalStateException("Resource is at full capacity: " + request.getResourceId());
        }

        ResourceAllocation allocation = ResourceAllocation.builder()
                .incident(incident)
                .resource(resource)
                .status(AllocationStatus.PENDING)
                .estimatedTravelTimeMinutes(request.getEstimatedTravelTimeMinutes())
                .estimatedResolutionTimeMinutes(request.getEstimatedResolutionTimeMinutes())
                .decisionRationale(request.getDecisionRationale())
                .build();

        allocation = allocationRepository.save(allocation);

        resource.setCurrentLoad(resource.getCurrentLoad() + 1);
        if (resource.getCurrentLoad() >= resource.getCapacity()) {
            resource.setAvailable(false);
        }
        resourceRepository.save(resource);

        moveIncident(allocation, IncidentStatus.ALLOCATING,
                "unit " + resource.getResourceId() + " dispatched");
        publishCreated(allocation);
        return toResponse(allocation);
    }

    @Transactional(readOnly = true)
    public AllocationResponse getAllocationById(Long id) {
        ResourceAllocation allocation = findById(id);
        return toResponse(allocation);
    }

    @Transactional(readOnly = true)
    public List<AllocationResponse> getAllocationsByIncident(String incidentId) {
        EmergencyIncident incident = incidentRepository.findByIncidentId(incidentId)
                .orElseThrow(() -> new EntityNotFoundException("Incident not found: " + incidentId));
        return allocationRepository.findByIncidentEntityId(incident.getId()).stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<AllocationResponse> getActiveAllocations() {
        return allocationRepository.findByStatusOrderByAllocatedAtAsc(AllocationStatus.PENDING)
                .stream().map(this::toResponse).toList();
    }

    public AllocationResponse updateAllocationStatus(Long id, AllocationStatus status) {
        ResourceAllocation allocation = findById(id);
        if (status == null) {
            throw new IllegalStateException("A target allocation status is required");
        }
        if (allocation.getStatus() == status) {
            // Idempotent no-op: re-sending the same status must not re-run side
            // effects such as releasing capacity a second time.
            return toResponse(allocation);
        }
        AllocationLifecycle.requireTransition(allocation.getId(), allocation.getStatus(), status);

        AllocationStatus previous = allocation.getStatus();
        allocation.setStatus(status);

        if (status == AllocationStatus.ARRIVED) {
            allocation.setArrivedAt(java.time.LocalDateTime.now());
            moveIncident(allocation, IncidentStatus.IN_PROGRESS, "unit " + allocation.getResource().getResourceId() + " arrived");
        } else if (status == AllocationStatus.COMPLETED) {
            allocation.setCompletedAt(java.time.LocalDateTime.now());
            // The incident is only resolved once every unit on it is done: a scene
            // with two ambulances is not "resolved" when the first one leaves.
            if (hasNoOtherLiveAllocations(allocation)) {
                moveIncident(allocation, IncidentStatus.RESOLVED, "all allocations completed");
            }
            releaseResourceCapacity(allocation.getResource());
        } else if (status == AllocationStatus.CANCELLED || status == AllocationStatus.FAILED) {
            releaseResourceCapacity(allocation.getResource());
        }

        allocation = allocationRepository.save(allocation);
        publishStatus(allocation, previous, status, null);
        return toResponse(allocation);
    }

    public void cancelAllocation(Long id) {
        ResourceAllocation allocation = findById(id);
        if (allocation.getStatus() == AllocationStatus.CANCELLED) {
            return;
        }
        AllocationLifecycle.requireTransition(allocation.getId(), allocation.getStatus(), AllocationStatus.CANCELLED);

        AllocationStatus previous = allocation.getStatus();
        allocation.setStatus(AllocationStatus.CANCELLED);
        releaseResourceCapacity(allocation.getResource());
        allocationRepository.save(allocation);
        publishStatus(allocation, previous, AllocationStatus.CANCELLED, "cancelled by operator");
    }

    /**
     * Returns one unit of capacity to the resource and re-opens it if room is
     * available.
     *
     * <p>Every terminal transition (`COMPLETED`, `CANCELLED`, `FAILED`) funnels
     * through here, and {@link #updateAllocationStatus} / {@link #cancelAllocation}
     * both return early when the allocation has already reached that state — so
     * a given allocation can only release its unit once. The counter is clamped
     * at zero so pre-existing data with an inflated load self-heals on the next
     * release instead of going negative.
     */
    private void releaseResourceCapacity(Resource resource) {
        int currentLoad = resource.getCurrentLoad() == null ? 0 : resource.getCurrentLoad();
        int capacity = resource.getCapacity() == null ? 0 : resource.getCapacity();
        resource.setCurrentLoad(Math.max(0, currentLoad - 1));
        resource.setAvailable(resource.getCurrentLoad() < capacity);
        resourceRepository.save(resource);
    }

    @Transactional(readOnly = true)
    public List<AllocationSummaryResponse> getAllocationSummariesByIncident(String incidentId) {
        EmergencyIncident incident = incidentRepository.findByIncidentId(incidentId)
                .orElseThrow(() -> new EntityNotFoundException("Incident not found: " + incidentId));
        return allocationRepository.findByIncidentEntityId(incident.getId()).stream()
                .map(this::toSummary)
                .toList();
    }

    private ResourceAllocation findById(Long id) {
        return allocationRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Allocation not found with id: " + id));
    }

    /**
     * Advances the owning incident, but only when the lifecycle permits it.
     *
     * <p>Dispatching a second unit for an incident that is already
     * {@code ALLOCATING} or {@code IN_PROGRESS} is a legitimate operation — the
     * deployment is still a real fact — so an illegal transition must not fail the
     * allocation. It must not even be <em>attempted</em>, though.
     *
     * <p><strong>Why the check happens before the call.</strong> Catching
     * {@link InvalidStateTransitionException} here used to look equivalent and was
     * not: {@code IncidentLifecycleService.transition} is a {@code @Transactional}
     * bean, so it joins this method's transaction (propagation {@code REQUIRED}).
     * When it throws, Spring marks the <em>shared</em> transaction rollback-only, and
     * no later code can undo that — the allocation's inserts are discarded at commit
     * while this method proceeds as if they had succeeded. The result was an
     * {@code UnexpectedRollbackException} at commit and an opaque 500 in place of the
     * allocation being recorded.
     *
     * <p>Asking the graph first means the illegal case simply does not call, so no
     * exception is thrown and the transaction stays committable.
     */
    private void moveIncident(ResourceAllocation allocation, IncidentStatus target, String reason) {
        EmergencyIncident incident = allocation.getIncident();
        if (!IncidentLifecycle.canTransition(incident.getStatus(), target)) {
            log.debug("Leaving incident {} in {} instead of {}: transition not permitted",
                    incident.getIncidentId(), incident.getStatus(), target);
            return;
        }
        incidentLifecycleService.transition(incident.getIncidentId(), target, reason);
    }

    /**
     * True when every <em>other</em> allocation of the same incident has reached a
     * terminal state, i.e. nothing else is still deployed.
     *
     * <p>The current allocation is excluded by id because its new status is set on
     * the managed entity but the collection in persistence context has not been
     * flushed — reading {@code status} from the entity would be correct, but a
     * query is the only thing guaranteed to see committed siblings.
     */
    private boolean hasNoOtherLiveAllocations(ResourceAllocation allocation) {
        return allocationRepository
                .findByIncidentIdOrderByAllocatedAtAsc(allocation.getIncident().getId()).stream()
                .filter(other -> !other.getId().equals(allocation.getId()))
                .allMatch(other -> other.getStatus() == AllocationStatus.COMPLETED
                        || other.getStatus() == AllocationStatus.CANCELLED
                        || other.getStatus() == AllocationStatus.FAILED);
    }

    private void publishCreated(ResourceAllocation allocation) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("allocationId", allocation.getId());
        payload.put("incidentId", allocation.getIncident().getIncidentId());
        payload.put("resourceId", allocation.getResource().getResourceId());
        payload.put("resourceType", allocation.getResource().getType() == null
                ? null : allocation.getResource().getType().name());
        payload.put("status", allocation.getStatus().name());
        payload.put("estimatedTravelTimeMinutes", allocation.getEstimatedTravelTimeMinutes());
        payload.put("estimatedResolutionTimeMinutes", allocation.getEstimatedResolutionTimeMinutes());
        payload.put("decisionRationale", allocation.getDecisionRationale());

        eventPublisher.publish(EventEnvelope.of(
                DomainEventType.ALLOCATION_CREATED.name(),
                String.valueOf(allocation.getId()),
                allocation.getIncident().getIncidentId(),
                payload,
                CorrelationIdFilter.currentOrRandom()));
    }

    private void publishStatus(ResourceAllocation allocation, AllocationStatus previous,
                               AllocationStatus target, String reason) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("allocationId", allocation.getId());
        payload.put("incidentId", allocation.getIncident().getIncidentId());
        payload.put("resourceId", allocation.getResource().getResourceId());
        payload.put("previousStatus", previous == null ? null : previous.name());
        payload.put("status", target.name());
        payload.put("reason", reason);

        eventPublisher.publish(EventEnvelope.of(
                DomainEventType.ALLOCATION_STATUS_CHANGED.name(),
                String.valueOf(allocation.getId()),
                allocation.getIncident().getIncidentId(),
                payload,
                CorrelationIdFilter.currentOrRandom()));
    }

    private AllocationSummaryResponse toSummary(ResourceAllocation allocation) {
        Resource resource = allocation.getResource();
        return AllocationSummaryResponse.builder()
                .id(allocation.getId())
                .incidentId(allocation.getIncident().getIncidentId())
                .resourceId(resource.getResourceId())
                .resourceType(resource.getType() == null ? null : resource.getType().name())
                .status(allocation.getStatus())
                .estimatedTravelTimeMinutes(allocation.getEstimatedTravelTimeMinutes())
                .estimatedResolutionTimeMinutes(allocation.getEstimatedResolutionTimeMinutes())
                .decisionRationale(allocation.getDecisionRationale())
                .allocatedAt(allocation.getAllocatedAt())
                .build();
    }

    private AllocationResponse toResponse(ResourceAllocation allocation) {
        return AllocationResponse.builder()
                .id(allocation.getId())
                .incidentId(allocation.getIncident().getIncidentId())
                .resourceId(allocation.getResource().getResourceId())
                .status(allocation.getStatus())
                .estimatedTravelTimeMinutes(allocation.getEstimatedTravelTimeMinutes())
                .estimatedResolutionTimeMinutes(allocation.getEstimatedResolutionTimeMinutes())
                .decisionRationale(allocation.getDecisionRationale())
                .allocatedAt(allocation.getAllocatedAt())
                .arrivedAt(allocation.getArrivedAt())
                .completedAt(allocation.getCompletedAt())
                .build();
    }
}