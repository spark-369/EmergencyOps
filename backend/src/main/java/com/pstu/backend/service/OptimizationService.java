package com.pstu.backend.service;

import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.entity.Hospital;
import com.pstu.backend.entity.Resource;
import com.pstu.backend.entity.RoadNetwork;
import com.pstu.backend.entity.RoadNetwork.RoadStatus;
import com.pstu.backend.enums.IncidentSeverity;
import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.enums.ResourceStatus;
import com.pstu.backend.enums.ResourceType;
import com.pstu.backend.pipeline.CorrelationIdFilter;
import com.pstu.backend.pipeline.DomainEventType;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.HospitalRepository;
import com.pstu.backend.repository.IncidentRepository;
import com.pstu.backend.repository.ResourceRepository;
import com.pstu.backend.repository.RoadNetworkRepository;
import com.pstu.backend.route.RoutingService;
import com.pstu.backend.route.RoutingService.RouteEstimate;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The decision engine: which unit serves which incident, and why.
 *
 * <p>Both entry points return the shape the console already renders
 * ({@code ReoptimizeResult} / {@code IncidentOptimization} in
 * {@code frontend/lib/types.ts}) and additionally publish an
 * {@code OPTIMIZATION_COMPLETED} fact, so streaming consumers can react to a new
 * plan without polling this service. The recommendation is never applied here:
 * dispatching stays a human (or ingest-loop) decision.
 */
@Service
@Transactional
public class OptimizationService {

    static final String ETA_SOURCE_ROAD_GRAPH = "ROAD_GRAPH";
    static final String ETA_SOURCE_GEOMETRIC = "GEOMETRIC_FALLBACK";

    private final IncidentRepository incidentRepository;
    private final ResourceRepository resourceRepository;
    private final HospitalRepository hospitalRepository;
    private final RoadNetworkRepository roadNetworkRepository;
    private final RoutingService routingService;
    private final EventPublisher eventPublisher;

    public OptimizationService(IncidentRepository incidentRepository,
                               ResourceRepository resourceRepository,
                               HospitalRepository hospitalRepository,
                               RoadNetworkRepository roadNetworkRepository,
                               RoutingService routingService,
                               EventPublisher eventPublisher) {
        this.incidentRepository = incidentRepository;
        this.resourceRepository = resourceRepository;
        this.hospitalRepository = hospitalRepository;
        this.roadNetworkRepository = roadNetworkRepository;
        this.routingService = routingService;
        this.eventPublisher = eventPublisher;
    }

    /**
     * Greedy assignment of the whole fleet.
     *
     * <p>Incidents are taken highest priority first, ties broken by the tighter
     * time sensitivity, and each unit is handed out at most once — so the plan
     * never recommends the same ambulance for two incidents. This is the
     * classical priority-greedy heuristic: optimal for the lexicographic
     * objective "serve the most urgent incidents first", which is what a manual
     * dispatcher does anyway.
     */
    public Map<String, Object> reoptimizeAll() {
        List<EmergencyIncident> activeIncidents = incidentRepository.findActiveIncidentsByStatuses(
                List.of(IncidentStatus.RECEIVED, IncidentStatus.PRIORITIZED,
                        IncidentStatus.ALLOCATING, IncidentStatus.IN_PROGRESS));

        List<Resource> availableResources = resourceRepository.findByAvailableTrue();
        RouteContext context = new RouteContext(
                roadNetworkRepository.findByStatusNot(RoadStatus.CLOSED),
                hospitalRepository.findAll());

        List<EmergencyIncident> sortedIncidents = activeIncidents.stream()
                .sorted(Comparator.comparingInt(EmergencyIncident::getPriorityScore).reversed()
                        .thenComparingInt(EmergencyIncident::getTimeSensitivityMinutes))
                .toList();

        Set<Long> claimedResourceIds = new HashSet<>();
        List<Map<String, Object>> decisions = new ArrayList<>();
        for (EmergencyIncident incident : sortedIncidents) {
            List<Resource> suitable = findSuitableResources(incident, availableResources, claimedResourceIds);
            decisions.add(decide(incident, suitable, claimedResourceIds, context));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalIncidents", activeIncidents.size());
        result.put("totalResources", availableResources.size());
        result.put("decisions", decisions);
        result.put("optimizedAt", new Date());

        publishRun(decisions, activeIncidents.size(), availableResources.size());
        return result;
    }

    /** Recommendation for a single incident. */
    public Map<String, Object> optimizeForIncident(String incidentId) {
        EmergencyIncident incident = incidentRepository.findByIncidentId(incidentId)
                // EntityNotFoundException so the global handler answers 404, not 500.
                .orElseThrow(() -> new EntityNotFoundException("Incident not found: " + incidentId));

        List<Resource> suitable = findSuitableResources(incident,
                resourceRepository.findByAvailableTrue(), new HashSet<>());
        RouteContext context = new RouteContext(
                roadNetworkRepository.findByStatusNot(RoadStatus.CLOSED),
                hospitalRepository.findAll());
        Map<String, Object> recommendation = decide(incident, suitable, new HashSet<>(), context);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("incidentId", incidentId);
        result.put("incidentSeverity", incident.getSeverity().name());
        result.put("incidentPriority", incident.getPriorityScore());
        result.put("recommendedResourceId", recommendation.get("allocatedResourceId"));
        result.put("resourceType", recommendation.get("resourceType"));
        result.put("estimatedTravelTimeMinutes", recommendation.get("estimatedTravelTimeMinutes"));
        result.put("estimatedTravelTimeWindow", recommendation.get("estimatedTravelTimeWindow"));
        result.put("etaSource", recommendation.get("etaSource"));
        // Copied explicitly like every other field: this method whitelists keys,
        // so a field added to `decide` is invisible here until it is listed.
        result.put("unitCurrentLoad", recommendation.get("unitCurrentLoad"));
        result.put("unitCapacity", recommendation.get("unitCapacity"));
        result.put("rationale", recommendation.get("rationale"));
        return result;
    }

    /**
     * Everything after the incident has been selected. Extracted so the
     * explanation ("why this unit") exists in exactly one place, whether the
     * answer is a fleet-wide pass or a single recommendation.
     */
    private Map<String, Object> decide(EmergencyIncident incident, List<Resource> suitable,
                                       Set<Long> claimedIds, RouteContext context) {
        Map<String, Object> decision = new LinkedHashMap<>();
        decision.put("incidentId", incident.getIncidentId());
        decision.put("incidentSeverity", incident.getSeverity().name());
        decision.put("incidentPriority", incident.getPriorityScore());

        if (suitable.isEmpty()) {
            // A decision is still returned: "nothing available" is information a
            // dispatcher needs, and omitting the row would read as "not evaluated".
            decision.put("allocatedResourceId", null);
            decision.put("resourceType", null);
            decision.put("estimatedTravelTimeMinutes", null);
            decision.put("estimatedTravelTimeWindow", null);
            decision.put("etaSource", null);
            decision.put("rationale", "No suitable resources available");
            return decision;
        }

        // ETA is computed once per candidate and memoised, so the chosen unit's
        // estimate is not recomputed (this used to run a second routing query for
        // the winner of every incident).
        //
        // IdentityHashMap, not HashMap: Resource equality is based on the surrogate
        // `id`, which is null for a not-yet-flushed entity, so two distinct units
        // could compare equal and share one ETA.
        // estimate is not recomputed (this used to run a second routing query for
        // the winner of every incident).
        //
        // The winner is resolved through computeIfAbsent rather than read straight
        // out of the map: with a single candidate `Stream.min` never calls the
        // comparator, so the map would still be empty and `get` would return null.
        Map<Resource, Eta> etas = new IdentityHashMap<>();
        Resource best = suitable.stream()
                .min(Comparator.comparingDouble(r ->
                        etas.computeIfAbsent(r, unit -> estimateEta(incident, unit, context)).minutes()))
                .orElseThrow();
        claimedIds.add(best.getId());
        Eta eta = etas.computeIfAbsent(best, unit -> estimateEta(incident, unit, context));

        decision.put("allocatedResourceId", best.getResourceId());
        decision.put("resourceType", best.getType().name());
        decision.put("estimatedTravelTimeMinutes", eta.minutes());
        decision.put("estimatedTravelTimeWindow", eta.window());
        decision.put("etaSource", eta.source());
        /*
         * The winning unit's load is exposed as structured fields, not only inside
         * the rationale string. The console explains "why this unit" factor by
         * factor, and parsing numbers back out of prose to do it would be brittle
         * (and would silently break the day this sentence is reworded).
         */
        decision.put("unitCurrentLoad", best.getCurrentLoad());
        decision.put("unitCapacity", best.getCapacity());
        decision.put("rationale", String.format(
                "Selected %s %s for a %s incident (priority %d): ETA %s via %s, unit load %d/%d",
                best.getType().name(), best.getResourceId(), incident.getSeverity().name(),
                incident.getPriorityScore(), eta.window(), eta.source(),
                best.getCurrentLoad(), best.getCapacity()));
        return decision;
    }

    private List<Resource> findSuitableResources(EmergencyIncident incident, List<Resource> availableResources,
                                                 Set<Long> excludedIds) {
        return availableResources.stream()
                .filter(r -> !excludedIds.contains(r.getId()))
                .filter(r -> r.getCurrentLoad() != null && r.getCapacity() != null
                        && r.getCurrentLoad() < r.getCapacity())
                // `available` is a denormalised flag that a PATCH to /load or
                // /status can leave stale; the status enum is the durable truth.
                .filter(r -> r.getStatus() == ResourceStatus.AVAILABLE
                        || r.getStatus() == ResourceStatus.STANDBY)
                .filter(r -> isResourceSuitableForIncident(r, incident))
                .toList();
    }

    /**
     * Capability filter: the more severe the scene, the more a unit has to bring.
     * LOW and MEDIUM incidents can be served by any unit (a supply truck is a valid
     * answer to a water shortage); HIGH and above need a medical or rescue asset.
     */
    private boolean isResourceSuitableForIncident(Resource resource, EmergencyIncident incident) {
        if (incident.getSeverity() == IncidentSeverity.CATASTROPHIC
                || incident.getSeverity() == IncidentSeverity.CRITICAL) {
            return resource.getType() == ResourceType.AMBULANCE
                    || resource.getType() == ResourceType.HELICOPTER
                    || resource.getType() == ResourceType.RESCUE_TEAM
                    || resource.getType() == ResourceType.HOSPITAL;
        }
        if (incident.getSeverity() == IncidentSeverity.HIGH) {
            return resource.getType() == ResourceType.AMBULANCE
                    || resource.getType() == ResourceType.RESCUE_TEAM
                    || resource.getType() == ResourceType.HOSPITAL;
        }
        return true;
    }

    /**
     * Travel estimate with its provenance.
     *
     * <p>Each unit and the incident are anchored to the road-network node closest
     * to them, and the graph is asked for the best open route between those two
     * nodes. When the graph has no answer (closed roads, disconnected node, open
     * circuit breaker) the haversine estimate is used — a dispatcher still needs a
     * number, but {@code source} records how much to trust it.
     *
     * <p>The anchors are road-network <em>node names</em>, not hospital names: the
     * graph is keyed by the names in {@code road_network.fromLocation/toLocation},
     * so routing a hospital pair would miss every time and silently collapse to the
     * geometric estimate. Hospitals are only the fallback anchor for a point with
     * no road node near it.
     */
    private Eta estimateEta(EmergencyIncident incident, Resource resource, RouteContext context) {
        String origin = context.anchorFor(resource.getLatitude(), resource.getLongitude());
        String destination = context.anchorFor(incident.getLatitude(), incident.getLongitude());

        if (origin != null && destination != null) {
            RouteEstimate route = routingService.calculateRoute(origin, destination);
            if (route.reachable()) {
                int window = Math.max(2, (int) Math.round(route.minutes() * 0.2));
                return new Eta(route.minutes(),
                        route.minutes() + "–" + (route.minutes() + window) + " min",
                        ETA_SOURCE_ROAD_GRAPH);
            }
        }

        int geometric = calculateTravelTime(incident, resource);
        return new Eta(geometric, "~" + geometric + " min", ETA_SOURCE_GEOMETRIC);
    }

    /**
     * Per-call view of the graph: the candidate anchors with their coordinates,
     * plus a small memo so repeated lookups for the same unit do not rescan them.
     *
     * <p>Built once per optimisation pass instead of once per candidate: the
     * previous version resolved the nearest hospital inside a comparator, which ran
     * in {@code O(units × hospitals)} and called {@code findAll()} twice per pass.
     */
    private static final class RouteContext {

        /** Graph nodes are named locations; this is what an anchor resolves to. */
        private record Anchor(String name, double latitude, double longitude) {
        }

        private final List<Anchor> anchors;
        // Written from `anchorFor`, which a stream lambda may call; a
        // ConcurrentHashMap keeps that safe if the pass is ever parallelised, and
        // costs nothing on the single-threaded path.
        private final Map<String, String> memo = new ConcurrentHashMap<>();

        RouteContext(List<RoadNetwork> segments, List<Hospital> hospitals) {
            List<Anchor> collected = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (RoadNetwork segment : segments) {
                addAnchor(collected, seen, segment.getFromLocation(),
                        segment.getFromLatitude(), segment.getFromLongitude());
                addAnchor(collected, seen, segment.getToLocation(),
                        segment.getToLatitude(), segment.getToLongitude());
            }
            // Hospitals are a last resort: the graph has no node for them, so a
            // hospital anchor only helps when the caller's fallback can use it.
            for (Hospital hospital : hospitals) {
                addAnchor(collected, seen, hospital.getName(),
                        hospital.getLatitude(), hospital.getLongitude());
            }
            this.anchors = collected;
        }

        private void addAnchor(List<Anchor> target, Set<String> seen, String name,
                               Double latitude, Double longitude) {
            if (name == null || name.isBlank() || latitude == null || longitude == null) {
                return;
            }
            String key = RoutingService.normalize(name);
            if (seen.add(key)) {
                target.add(new Anchor(name, latitude, longitude));
            }
        }

        /** Name of the anchor closest to the point, or {@code null} when none exists. */
        String anchorFor(Double latitude, Double longitude) {
            if (latitude == null || longitude == null || anchors.isEmpty()) {
                return null;
            }
            String key = latitude + ":" + longitude;
            String cached = memo.get(key);
            if (cached != null) {
                return cached;
            }
            String name = anchors.stream()
                    .min(Comparator.comparingDouble(a -> distantKm(latitude, longitude, a)))
                    .map(Anchor::name)
                    .orElse(null);
            memo.put(key, name);
            return name;
        }

        private static double distantKm(double latitude, double longitude, Anchor anchor) {
            return RoutingService.haversineKm(latitude, longitude, anchor.latitude(), anchor.longitude());
        }
    }

    /** Straight-line estimate; the documented fallback when the graph cannot answer. */
    private int calculateTravelTime(EmergencyIncident incident, Resource resource) {
        double distance = RoutingService.haversineKm(incident.getLatitude(), incident.getLongitude(),
                resource.getLatitude(), resource.getLongitude());
        // A unit with no recorded speed is assumed to make 60 km/h.
        double speed = resource.getTravelSpeedKmh() != null ? resource.getTravelSpeedKmh() : 60.0;
        return (int) Math.ceil((distance / speed) * 60);
    }

    /**
     * Publishes the outcome of a full run through the outbox, so a broker outage
     * delays the event instead of failing the HTTP call that asked for the plan.
     */
    private void publishRun(List<Map<String, Object>> decisions, int incidents, int resources) {
        long assigned = decisions.stream()
                .filter(decision -> decision.get("allocatedResourceId") != null)
                .count();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("totalIncidents", incidents);
        payload.put("totalResources", resources);
        payload.put("assigned", assigned);
        payload.put("unassigned", incidents - assigned);
        payload.put("decisions", decisions);
        payload.put("optimizedAt", Instant.now().toString());

        eventPublisher.publish(EventEnvelope.of(
                DomainEventType.OPTIMIZATION_COMPLETED.name(),
                "fleet",
                "fleet",
                payload,
                CorrelationIdFilter.currentOrRandom()));
    }

    /** Travel estimate and where it came from, so a decision can be audited later. */
    private record Eta(int minutes, String window, String source) {
    }
}
