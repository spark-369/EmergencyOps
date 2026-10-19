package com.pstu.backend.repository;

import com.pstu.backend.entity.Resource;
import com.pstu.backend.enums.ResourceStatus;
import com.pstu.backend.enums.ResourceType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.Optional;

public interface ResourceRepository extends JpaRepository<Resource, Long> {

    Optional<Resource> findByResourceId(String resourceId);

    List<Resource> findByTypeAndStatus(ResourceType type, ResourceStatus status);

    List<Resource> findByAvailableTrue();

    @Query("SELECT r FROM Resource r WHERE r.status = :status AND r.available = true")
    List<Resource> findAvailableByStatus(ResourceStatus status);

    @Query("SELECT r FROM Resource r WHERE r.type = :type AND r.available = true AND r.status = :status")
    List<Resource> findAvailableByTypeAndStatus(ResourceType type, ResourceStatus status);

    @Query("SELECT r FROM Resource r WHERE r.latitude BETWEEN :minLat AND :maxLat AND r.longitude BETWEEN :minLon AND :maxLon")
    List<Resource> findResourcesInRegion(Double minLat, Double maxLat, Double minLon, Double maxLon);
}