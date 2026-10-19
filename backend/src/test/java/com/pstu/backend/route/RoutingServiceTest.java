package com.pstu.backend.route;

import com.pstu.backend.entity.RoadNetwork;
import com.pstu.backend.entity.RoadNetwork.RoadStatus;
import com.pstu.backend.repository.RoadNetworkRepository;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The ETA engine. What matters operationally is not "a number comes back" but
 * that closed roads are avoided and congestion costs more, because those two are
 * what a dispatcher is actually asking about.
 */
class RoutingServiceTest {

    private RoadNetworkRepository repository;
    private RoutingService routingService;

    @BeforeEach
    void setUp() {
        repository = mock(RoadNetworkRepository.class);
        routingService = new RoutingService(repository, CircuitBreaker.ofDefaults("routing-test"));
    }

    private static RoadNetwork segment(String from, String to, double km, double minutes, RoadStatus status) {
        return RoadNetwork.builder()
                .fromLocation(from)
                .toLocation(to)
                .fromLatitude(0.0).fromLongitude(0.0)
                .toLatitude(0.0).toLongitude(0.0)
                .distanceKm(km)
                .travelTimeMinutes(minutes)
                .status(status)
                .build();
    }

    private void given(RoadNetwork... segments) {
        when(repository.findByStatusNot(any())).thenReturn(List.of(segments));
    }

    @Test
    void picksTheFastestOfTwoRoutes() {
        // Direct route is slower than the detour: the algorithm must prefer time,
        // not hop count.
        given(segment("Depot", "Scene", 12.0, 30.0, RoadStatus.OPEN),
                segment("Depot", "Bridge", 4.0, 5.0, RoadStatus.OPEN),
                segment("Bridge", "Scene", 5.0, 6.0, RoadStatus.OPEN));

        RoutingService.RouteEstimate route = routingService.calculateRoute("depot", "SCENE");

        assertThat(route.reachable()).isTrue();
        assertThat(route.minutes()).isEqualTo(11);
        assertThat(route.path()).containsExactly("depot", "bridge", "scene");
    }

    @Test
    void closedSegmentsAreNeverTaken() {
        given(segment("Depot", "Scene", 1.0, 2.0, RoadStatus.CLOSED),
                segment("Depot", "Mill", 5.0, 8.0, RoadStatus.OPEN),
                segment("Mill", "Scene", 5.0, 9.0, RoadStatus.OPEN));

        RoutingService.RouteEstimate route = routingService.calculateRoute("Depot", "Scene");

        assertThat(route.minutes()).isEqualTo(17);
        assertThat(route.path()).doesNotContain("scene-closed");
    }

    @Test
    void congestionIsPricedIn() {
        // 10 min of free flow becomes 16 min (×1.6) — more than the 15-minute
        // alternative, so the detour wins.
        given(segment("Depot", "Scene", 6.0, 10.0, RoadStatus.CONGESTED),
                segment("Depot", "Ridge", 3.0, 7.0, RoadStatus.OPEN),
                segment("Ridge", "Scene", 3.0, 8.0, RoadStatus.OPEN));

        assertThat(routingService.calculateRoute("Depot", "Scene").minutes()).isEqualTo(15);
    }

    @Test
    void unreachableDestinationIsReportedNotGuessed() {
        given(segment("Depot", "Scene", 1.0, 2.0, RoadStatus.OPEN));

        assertThat(routingService.calculateRoute("Depot", "Elsewhere").reachable()).isFalse();
        assertThat(routingService.calculateRoute("Depot", "Elsewhere").asOptional()).isEmpty();
    }

    @Test
    void segmentsAreDirected() {
        // Only Depo -> Scene exists; the reverse trip must not be invented.
        given(segment("Depot", "Scene", 1.0, 2.0, RoadStatus.OPEN));

        assertThat(routingService.calculateRoute("Scene", "Depot").reachable()).isFalse();
    }

    @Test
    void sameOriginAndDestinationIsZero() {
        RoutingService.RouteEstimate route = routingService.calculateRoute("Depot ", "depot");

        assertThat(route.reachable()).isTrue();
        assertThat(route.minutes()).isZero();
    }

    @Test
    void nullArgumentsFallBackInsteadOfThrowing() {
        assertThat(routingService.calculateRoute(null, "Scene").reachable()).isFalse();
        assertThat(routingService.calculateRoute("Depot", null).reachable()).isFalse();
    }

    @Test
    void openCircuitBreakerFallsBackToUnreachable() {
        CircuitBreaker openBreaker = CircuitBreaker.ofDefaults("open-test");
        openBreaker.transitionToOpenState();
        RoutingService guarded = new RoutingService(repository, openBreaker);

        assertThat(guarded.calculateRoute("Depot", "Scene").reachable()).isFalse();
    }
}
