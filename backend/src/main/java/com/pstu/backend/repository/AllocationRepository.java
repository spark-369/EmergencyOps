package com.pstu.backend.repository;

import com.pstu.backend.entity.ResourceAllocation;
import com.pstu.backend.enums.AllocationStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface AllocationRepository extends JpaRepository<ResourceAllocation, Long> {

    List<ResourceAllocation> findByIncidentIdOrderByAllocatedAtAsc(Long incidentId);

    List<ResourceAllocation> findByStatusOrderByAllocatedAtAsc(AllocationStatus status);

    @Query("SELECT a FROM ResourceAllocation a WHERE a.incident.id = :incidentId")
    List<ResourceAllocation> findByIncidentEntityId(Long incidentId);

    @Query("SELECT a FROM ResourceAllocation a WHERE a.resource.id = :resourceId AND a.status IN :activeStatuses")
    List<ResourceAllocation> findActiveAllocationsByResourceId(Long resourceId, List<AllocationStatus> activeStatuses);
}