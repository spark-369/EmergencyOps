package com.pstu.backend.repository;

import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.Optional;

public interface IncidentRepository extends JpaRepository<EmergencyIncident, Long> {

    Optional<EmergencyIncident> findByIncidentId(String incidentId);

    List<EmergencyIncident> findByStatusOrderByPriorityScoreDesc(IncidentStatus status);

    List<EmergencyIncident> findBySeverityOrderByPriorityScoreDesc(IncidentSeverity severity);

    @Query("SELECT i FROM EmergencyIncident i WHERE i.status IN :statuses ORDER BY i.priorityScore DESC, i.createdAt ASC")
    List<EmergencyIncident> findActiveIncidentsByStatuses(List<IncidentStatus> statuses);

    @Query("SELECT i FROM EmergencyIncident i WHERE i.latitude BETWEEN :minLat AND :maxLat AND i.longitude BETWEEN :minLon AND :maxLon")
    List<EmergencyIncident> findIncidentsInRegion(Double minLat, Double maxLat, Double minLon, Double maxLon);
}