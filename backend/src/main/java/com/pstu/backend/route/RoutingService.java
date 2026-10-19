package com.pstu.backend.route;

import com.pstu.backend.entity.RoadNetwork;
import com.pstu.backend.entity.RoadNetwork.RoadStatus;
import com.pstu.backend.repository.RoadNetworkRepository;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.PriorityQueue;
import java.util.Set;

/**
 * Least-cost travel time over the {@code road_network} graph.
 *
 * <p>Estimating every ETA with straight-line (haversine) distance ignores closed
 * bridges and congestion — the two things a dispatcher cares about most. This
 * service answers the same question with the graph the operations team already
 * maintains, and degrades predictably:
 *
 * <ul>
 *   <li>{@code CLOSED} segments are removed before the search;</li>
 *   <li>{@code CONGESTED} / {@code DELAYED} segments cost their stored travel time
 *       multiplied by a factor, because the stored figure is the free-flow value;</li>
 *   <li>an unreachable destination returns {@link RouteEstimate#unreachable()} and
 *       the caller falls back to the geometric estimate.</li>
 * </ul>
 *
 * <p>The query sits behind a Resilience4j circuit breaker: a database hiccup
 * opening it makes callers fall back immediately instead of queueing on a
 * saturated pool. The breaker instance comes from {@code ResilienceConfig}.
 */
@Service
public class RoutingService {

    private static final Logger log = LoggerFactory.getLogger(RoutingService.class);

    /** Free-flow travel time is optimistic for a congested segment. */
    static final double CONGESTION_FACTOR = 1.6;
    static final double DELAY_FACTOR = 1.25;

    private final RoadNetworkRepository roadNetworkRepository;
    private final CircuitBreaker circuitBreaker;

    public RoutingService(RoadNetworkRepository roadNetworkRepository,
                          @Qualifier("routingCircuitBreaker") CircuitBreaker routingCircuitBreaker) {
        this.roadNetworkRepository = roadNetworkRepository;
        this.circuitBreaker = routingCircuitBreaker;
    }

    /**
     * Best route between two named locations (case-insensitive).
     *
     * @return the estimate, or {@link RouteEstimate#unreachable()} when no open
     *         path exists or the router is unavailable
     */
    public RouteEstimate calculateRoute(String fromLocation, String toLocation) {
        if (fromLocation == null || toLocation == null) {
            return RouteEstimate.unreachable();
        }
        String from = normalize(fromLocation);
        String to = normalize(toLocation);
        if (from.equals(to)) {
            return new RouteEstimate(0.0, 0, true, List.of(fromLocation));
        }
        // The breaker wrapper comes from resilience4j-circuitbreaker itself rather
        // than io.github.resilience4j.decorators.Decorators, which lives in the
        // separate `resilience4j-all` artifact and is not on the classpath.
        // executeSupplier records success/failure; when the breaker is open it
        // throws CallNotPermittedException without invoking the route query.
        try {
            return circuitBreaker.executeSupplier(() -> shortestPath(from, to));
        } catch (RuntimeException e) {
            // Catches the open-breaker rejection and any repository failure alike:
            // both must degrade to the caller's geometric estimate, otherwise one
            // bad query would fail the whole optimisation pass. The breaker has
            // already recorded the failure, so repeated errors open it and stop
            // hammering the database.
            log.warn("Routing {} -> {} unavailable ({}); caller falls back",
                    from, to, e.getClass().getSimpleName());
            return RouteEstimate.unreachable();
        }
    }

    public static String normalize(String location) {
        return location.trim().toLowerCase();
    }

    /**
     * Great-circle distance in kilometres.
     *
     * <p>Public and shared rather than duplicated: the optimizer needs the same
     * geometry to pick the nearest anchor for a coordinate, and two copies of a
     * formula would be two places for the radius constant to drift.
     */
    public static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        double earthRadiusKm = 6371.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return earthRadiusKm * c;
    }

    /**
     * Dijkstra over the open segments — {@code O(E log V)} with a binary heap.
     *
     * <p>Segments are directed (the table models one-way flow as separate rows),
     * so the reverse edge is <em>not</em> implied: adding it would route
     * ambulances the wrong way down a one-way street. The loop skips stale queue
     * entries and stops at the first time the destination is popped, which is
     * optimal with non-negative weights.
     */
    @Transactional(readOnly = true)
    public RouteEstimate shortestPath(String from, String to) {
        List<RoadNetwork> segments = roadNetworkRepository.findByStatusNot(RoadStatus.CLOSED);
        if (segments.isEmpty()) {
            return RouteEstimate.unreachable();
        }

        Map<String, List<Edge>> adjacency = buildAdjacency(segments);
        Map<String, Double> best = new HashMap<>();
        Map<String, Edge> previous = new HashMap<>();
        PriorityQueue<Node> frontier = new PriorityQueue<>(Comparator.comparingDouble(Node::cost));

        best.put(from, 0.0);
        frontier.add(new Node(from, 0.0));
        boolean found = false;

        while (!frontier.isEmpty()) {
            Node current = frontier.poll();
            if (current.cost() > best.getOrDefault(current.name(), Double.MAX_VALUE)) {
                continue;
            }
            if (current.name().equals(to)) {
                found = true;
                break;
            }
            for (Edge edge : adjacency.getOrDefault(current.name(), List.of())) {
                double candidate = current.cost() + edge.minutes();
                Double known = best.get(edge.to());
                if (known == null || candidate < known) {
                    best.put(edge.to(), candidate);
                    previous.put(edge.to(), edge);
                    frontier.add(new Node(edge.to(), candidate));
                }
            }
        }

        if (!found) {
            log.debug("No open route from {} to {}", from, to);
            return RouteEstimate.unreachable();
        }

        List<Edge> pathEdges = pathEdges(previous, from, to);
        double kilometres = pathEdges.stream().mapToDouble(Edge::kilometres).sum();
        List<String> path = new ArrayList<>();
        // `previous` is keyed by destination node, so each edge maps to its origin
        // and the final node is appended. Walking the path once avoids recomputing
        // it (the previous version ran pathEdges twice for the same answer).
        pathEdges.forEach(edge -> path.add(edge.from()));
        path.add(to);

        double minutes = best.get(to);
        log.debug("Route {} -> {}: {} km in {} min", from, to,
                String.format("%.1f", kilometres), String.format("%.1f", minutes));
        return new RouteEstimate(kilometres, (int) Math.ceil(minutes), true, path);
    }

    /**
     * Edges of the chosen path, in origin-to-destination order.
     *
     * <p>{@code visited} guards against a cycle in {@code previous} (defensive: the
     * relaxation loop cannot create one, but a corrupted graph should not hang a
     * request).
     */
    private static List<Edge> pathEdges(Map<String, Edge> previous, String from, String to) {
        Deque<Edge> reversed = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        String cursor = to;
        while (!cursor.equals(from) && previous.containsKey(cursor) && visited.add(cursor)) {
            Edge edge = previous.get(cursor);
            reversed.addFirst(edge);
            cursor = edge.from();
        }
        return new ArrayList<>(reversed);
    }

    private static Map<String, List<Edge>> buildAdjacency(List<RoadNetwork> segments) {
        Map<String, List<Edge>> adjacency = new HashMap<>();
        for (RoadNetwork segment : segments) {
            if (segment.getFromLocation() == null || segment.getToLocation() == null) {
                continue;
            }
            // `status` is NOT NULL in the schema, but a legacy row or a hand-written
            // fixture can still carry null; the switch below would throw NPE and
            // fail the whole route. Treat an unknown status as free-flow instead.
            RoadStatus status = segment.getStatus();
            double multiplier = status == null ? 1.0 : switch (status) {
                case CONGESTED -> CONGESTION_FACTOR;
                case DELAYED -> DELAY_FACTOR;
                default -> 1.0;
            };
            double minutes = (segment.getTravelTimeMinutes() == null ? 0.0 : segment.getTravelTimeMinutes())
                    * multiplier;
            double kilometres = segment.getDistanceKm() == null ? 0.0 : segment.getDistanceKm();
            String from = normalize(segment.getFromLocation());
            adjacency.computeIfAbsent(from, key -> new ArrayList<>())
                    .add(new Edge(from, normalize(segment.getToLocation()), kilometres, minutes));
        }
        return adjacency;
    }

    private record Node(String name, double cost) {
    }

    private record Edge(String from, String to, double kilometres, double minutes) {
    }

    /**
     * Outcome of a routing query.
     *
     * @param distanceKm total distance of the chosen route
     * @param minutes    estimated travel time, rounded up
     * @param reachable  false when no open path exists
     * @param path       node names from origin to destination
     */
    public record RouteEstimate(double distanceKm, int minutes, boolean reachable, List<String> path) {

        private static final RouteEstimate UNREACHABLE =
                new RouteEstimate(Double.NaN, Integer.MAX_VALUE, false, List.of());

        public static RouteEstimate unreachable() {
            return UNREACHABLE;
        }

        public Optional<RouteEstimate> asOptional() {
            return reachable ? Optional.of(this) : Optional.empty();
        }
    }
}
