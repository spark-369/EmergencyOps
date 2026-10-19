package com.pstu.backend.service;

import com.pstu.backend.dto.RoadNetworkRequest;
import com.pstu.backend.dto.RoadNetworkResponse;
import com.pstu.backend.entity.RoadNetwork;
import com.pstu.backend.entity.RoadNetwork.RoadStatus;
import com.pstu.backend.repository.RoadNetworkRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class RoadNetworkService {

    private final RoadNetworkRepository roadNetworkRepository;

    public RoadNetworkService(RoadNetworkRepository roadNetworkRepository) {
        this.roadNetworkRepository = roadNetworkRepository;
    }

    public RoadNetworkResponse createRoadSegment(RoadNetworkRequest request) {
        RoadNetwork roadNetwork = RoadNetwork.builder()
                .fromLocation(request.getFromLocation())
                .toLocation(request.getToLocation())
                .fromLatitude(request.getFromLatitude())
                .fromLongitude(request.getFromLongitude())
                .toLatitude(request.getToLatitude())
                .toLongitude(request.getToLongitude())
                .distanceKm(request.getDistanceKm())
                .travelTimeMinutes(request.getTravelTimeMinutes())
                .status(request.getStatus() != null ? request.getStatus() : RoadStatus.OPEN)
                .build();

        roadNetwork = roadNetworkRepository.save(roadNetwork);
        return toResponse(roadNetwork);
    }

    @Transactional(readOnly = true)
    public RoadNetworkResponse getRoadSegmentById(Long id) {
        RoadNetwork roadNetwork = findById(id);
        return toResponse(roadNetwork);
    }

    @Transactional(readOnly = true)
    public List<RoadNetworkResponse> getAllRoadSegments() {
        return roadNetworkRepository.findAll().stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<RoadNetworkResponse> getRoadSegmentsByStatus(RoadStatus status) {
        return roadNetworkRepository.findByStatus(status).stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<RoadNetworkResponse> getRoadSegmentsBetweenLocations(String fromLocation, String toLocation) {
        return roadNetworkRepository.findByFromLocationAndToLocation(fromLocation, toLocation)
                .stream().map(this::toResponse).toList();
    }

    public RoadNetworkResponse updateRoadStatus(Long id, RoadStatus status) {
        RoadNetwork roadNetwork = findById(id);
        roadNetwork.setStatus(status);
        roadNetwork = roadNetworkRepository.save(roadNetwork);
        return toResponse(roadNetwork);
    }

    public RoadNetworkResponse updateTravelInfo(Long id, Double distanceKm, Double travelTimeMinutes) {
        RoadNetwork roadNetwork = findById(id);
        if (distanceKm != null) {
            roadNetwork.setDistanceKm(distanceKm);
        }
        if (travelTimeMinutes != null) {
            roadNetwork.setTravelTimeMinutes(travelTimeMinutes);
        }
        roadNetwork = roadNetworkRepository.save(roadNetwork);
        return toResponse(roadNetwork);
    }

    public void deleteRoadSegment(Long id) {
        RoadNetwork roadNetwork = findById(id);
        roadNetworkRepository.delete(roadNetwork);
    }

    private RoadNetwork findById(Long id) {
        return roadNetworkRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Road network segment not found with id: " + id));
    }

    private RoadNetworkResponse toResponse(RoadNetwork roadNetwork) {
        return RoadNetworkResponse.builder()
                .id(roadNetwork.getId())
                .fromLocation(roadNetwork.getFromLocation())
                .toLocation(roadNetwork.getToLocation())
                .fromLatitude(roadNetwork.getFromLatitude())
                .fromLongitude(roadNetwork.getFromLongitude())
                .toLatitude(roadNetwork.getToLatitude())
                .toLongitude(roadNetwork.getToLongitude())
                .distanceKm(roadNetwork.getDistanceKm())
                .travelTimeMinutes(roadNetwork.getTravelTimeMinutes())
                .status(roadNetwork.getStatus())
                .lastUpdated(roadNetwork.getLastUpdated())
                .build();
    }
}
