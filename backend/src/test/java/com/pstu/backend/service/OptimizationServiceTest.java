package com.pstu.backend.service;

import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.entity.Resource;
import com.pstu.backend.entity.RoadNetwork;
import com.pstu.backend.entity.RoadNetwork.RoadStatus;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.enums.ResourceStatus;
import com.pstu.backend.enums.ResourceType;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.HospitalRepository;
import com.pstu.backend.repository.IncidentRepository;
import com.pstu.backend.repository.ResourceRepository;
import com.pstu.backend.repository.RoadNetworkRepository;
import com.pstu.backend.route.RoutingService;
import com.pstu.backend.route.RoutingService.RouteEstimate;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The decision engine's two entry points.
 *
 * <p>The properties a dispatcher depends on: the more severe the scene, the more a
 * unit must bring (capability filter); a unit is recommended for at most one incident
 * per pass; and every ETA carries its provenance so the number can be trusted to the
 * right degree. The recommendation is never applied here — dispatching stays a human
 * decision — so the single-incident path must not publish a fact.
 */
class OptimizationServiceTest {

    private IncidentRepository incidentRepository;
    private ResourceRepository resourceRepository;
    private HospitalRepository hospitalRepository;
    private RoadNetworkRepository roadNetworkRepository;
    private RoutingService routingService;
    private EventPublisher eventPublisher;
    private OptimizationService service;

    @BeforeEach
    void setUp() {
        incidentRepository = mock(IncidentRepository.class);
        resourceRepository = mock(ResourceRepository.class);
        hospitalRepository = mock(HospitalRepository.class);
        roadNetworkRepository = mock(RoadNetworkRepository.class);
        routingService = mock(RoutingService.class);
        eventPublisher = mock(EventPublisher.class);

        // Empty graph and no hospitals: the RouteContext has no anchors, so the
        // engine falls back to the geometric estimate unless a test says otherwise.
        when(roadNetworkRepository.findByStatusNot(any())).thenReturn(List.of());
        when(hospitalRepository.findAll()).thenReturn(List.of());

        service = new OptimizationService(incidentRepository, resourceRepository,
                hospitalRepository, roadNetworkRepository, routingService, eventPublisher);
    }

    private static EmergencyIncident incident(String id, IncidentSeverity severity, int priority) {
        return EmergencyIncident.builder()
                .id(1L).incidentId(id)
                .latitude(23.8103).longitude(90.4125)
                .severity(severity).status(IncidentStatus.PRIORITIZED)
                .priorityScore(priority).affectedPeople(5).timeSensitivityMinutes(5)
                .build();
    }

    private static Resource unit(long id, ResourceType type) {
        return Resource.builder()
                .id(id).resourceId(type.name().charAt(0) + "-" + id)
                .type(type).latitude(23.82).longitude(90.43)
                .status(ResourceStatus.AVAILABLE).capacity(4).currentLoad(0).available(true)
                .travelSpeedKmh(60.0)
                .build();
    }

    @Test
    void aCriticalIncidentIsOnlyOfferedAMedicalOrRescueAsset() {
        when(incidentRepository.findByIncidentId("inc-1"))
                .thenReturn(Optional.of(incident("inc-1", IncidentSeverity.CRITICAL, 95)));
        when(resourceRepository.findByAvailableTrue()).thenReturn(List.of(
                unit(1L, ResourceType.SUPPLY_TRUCK), unit(2L, ResourceType.AMBULANCE)));

        Map<String, Object> result = service.optimizeForIncident("inc-1");

        // The supply truck is a valid answer to a water shortage, not to a critical scene.
        assertThat(result.get("recommendedResourceId")).isEqualTo("A-2");
        assertThat(result.get("resourceType")).isEqualTo("AMBULANCE");
    }

    @Test
    void aLowIncidentCanBeServedByAnyUnit() {
        when(incidentRepository.findByIncidentId("inc-1"))
                .thenReturn(Optional.of(incident("inc-1", IncidentSeverity.LOW, 20)));
        when(resourceRepository.findByAvailableTrue())
                .thenReturn(List.of(unit(1L, ResourceType.SUPPLY_TRUCK)));

        assertThat(service.optimizeForIncident("inc-1").get("recommendedResourceId")).isEqualTo("S-1");
    }

    @Test
    void noSuitableUnitStillReturnsADecisionRow() {
        when(incidentRepository.findByIncidentId("inc-1"))
                .thenReturn(Optional.of(incident("inc-1", IncidentSeverity.CATASTROPHIC, 99)));
        when(resourceRepository.findByAvailableTrue())
                .thenReturn(List.of(unit(1L, ResourceType.SUPPLY_TRUCK)));

        Map<String, Object> result = service.optimizeForIncident("inc-1");

        assertThat(result.get("recommendedResourceId")).isNull();
        assertThat(result.get("rationale")).isEqualTo("No suitable resources available");
    }

    @Test
    void anEtaWithoutAGraphAnswerIsLabelledAsTheGeometricFallback() {
        when(incidentRepository.findByIncidentId("inc-1"))
                .thenReturn(Optional.of(incident("inc-1", IncidentSeverity.HIGH, 80)));
        when(resourceRepository.findByAvailableTrue())
                .thenReturn(List.of(unit(1L, ResourceType.AMBULANCE)));

        Map<String, Object> result = service.optimizeForIncident("inc-1");

        assertThat(result.get("etaSource")).isEqualTo("GEOMETRIC_FALLBACK");
        assertThat(result.get("estimatedTravelTimeMinutes")).isNotNull();
    }

    @Test
    void aGraphAnswerIsLabelledAsTheRoadGraphAndUsedForTheEta() {
        RoadNetwork segment = RoadNetwork.builder()
                .fromLocation("depot").toLocation("scene")
                .fromLatitude(23.82).fromLongitude(90.43)
                .toLatitude(23.8103).toLongitude(90.4125)
                .distanceKm(5.0).travelTimeMinutes(9.0).status(RoadStatus.OPEN)
                .build();
        when(roadNetworkRepository.findByStatusNot(any())).thenReturn(List.of(segment));
        when(routingService.calculateRoute(anyString(), anyString()))
                .thenReturn(new RouteEstimate(5.0, 9, true, List.of("depot", "scene")));
        when(incidentRepository.findByIncidentId("inc-1"))
                .thenReturn(Optional.of(incident("inc-1", IncidentSeverity.HIGH, 80)));
        // The unit sits at the "depot" anchor, the incident at the "scene" anchor.
        Resource atDepot = Resource.builder()
                .id(1L).resourceId("A-1").type(ResourceType.AMBULANCE)
                .latitude(23.82).longitude(90.43)
                .status(ResourceStatus.AVAILABLE).capacity(4).currentLoad(0).available(true)
                .travelSpeedKmh(60.0).build();
        when(resourceRepository.findByAvailableTrue()).thenReturn(List.of(atDepot));

        Map<String, Object> result = service.optimizeForIncident("inc-1");

        assertThat(result.get("etaSource")).isEqualTo("ROAD_GRAPH");
        assertThat(result.get("estimatedTravelTimeMinutes")).isEqualTo(9);
        assertThat(result.get("estimatedTravelTimeWindow")).isEqualTo("9–11 min");
    }

    @Test
    void theSingleIncidentRecommendationIsNeverAppliedAndNeverPublished() {
        when(incidentRepository.findByIncidentId("inc-1"))
                .thenReturn(Optional.of(incident("inc-1", IncidentSeverity.HIGH, 80)));
        when(resourceRepository.findByAvailableTrue())
                .thenReturn(List.of(unit(1L, ResourceType.AMBULANCE)));

        service.optimizeForIncident("inc-1");

        verify(eventPublisher, never()).publish(any());
    }

    @Test
    void anUnknownIncidentIdIs404Not500() {
        when(incidentRepository.findByIncidentId("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.optimizeForIncident("missing"))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessageContaining("missing");
    }

    @Test
    void aFleetPassAssignsEachUnitAtMostOnceAndPublishesTheOutcome() {
        when(incidentRepository.findActiveIncidentsByStatuses(any())).thenReturn(List.of(
                incident("inc-1", IncidentSeverity.CRITICAL, 95),
                incident("inc-2", IncidentSeverity.HIGH, 80)));
        when(resourceRepository.findByAvailableTrue())
                .thenReturn(List.of(unit(1L, ResourceType.AMBULANCE)));

        Map<String, Object> result = service.reoptimizeAll();

        // Two incidents, one ambulance: the more urgent gets it, the other gets null.
        List<Map<String, Object>> decisions = castDecisions(result);
        assertThat(decisions.get(0).get("allocatedResourceId")).isEqualTo("A-1");
        assertThat(decisions.get(1).get("allocatedResourceId")).isNull();
        // A fleet run publishes its outcome so streaming consumers need not poll.
        verify(eventPublisher).publish(any());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> castDecisions(Map<String, Object> result) {
        return (List<Map<String, Object>>) result.get("decisions");
    }
}
