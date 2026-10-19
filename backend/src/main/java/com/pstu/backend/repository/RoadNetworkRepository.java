package com.pstu.backend.repository;

import com.pstu.backend.entity.RoadNetwork;
import com.pstu.backend.entity.RoadNetwork.RoadStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RoadNetworkRepository extends JpaRepository<RoadNetwork, Long> {

    List<RoadNetwork> findByStatus(RoadStatus status);

    /**
     * Every routable segment — used by {@code RoutingService}, which removes closed
     * segments and weights the delayed ones itself.
     */
    List<RoadNetwork> findByStatusNot(RoadStatus status);


    List<RoadNetwork> findByFromLocationAndToLocation(String fromLocation, String toLocation);
}