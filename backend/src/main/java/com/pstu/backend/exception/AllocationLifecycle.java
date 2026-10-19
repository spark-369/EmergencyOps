package com.pstu.backend.exception;

import com.pstu.backend.enums.AllocationStatus;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * The deployment lifecycle of one unit against one incident.
 *
 * <pre>
 * PENDING ──▶ ASSIGNED ──▶ EN_ROUTE ──▶ ARRIVED ──▶ COMPLETED
 *    │            │            │            │
 *    └────────────┴────────────┴────────────┴──▶ CANCELLED
 *    └────────────┴────────────┴────────────┴──▶ FAILED
 * </pre>
 *
 * <p>Forward moves may skip a stage (a unit already on scene goes straight to
 * {@code ARRIVED}); backwards moves are rejected. Without this guard the API
 * accepted {@code COMPLETED → PENDING}, which re-opened a finished deployment and
 * released the unit's capacity a second time — the counter then drifted negative
 * in the other direction and the fleet looked larger than it was.
 */
public final class AllocationLifecycle {

    private static final Map<AllocationStatus, Set<AllocationStatus>> GRAPH = buildGraph();

    private AllocationLifecycle() {
    }

    private static Map<AllocationStatus, Set<AllocationStatus>> buildGraph() {
        Map<AllocationStatus, Set<AllocationStatus>> graph = new EnumMap<>(AllocationStatus.class);
        graph.put(AllocationStatus.PENDING, EnumSet.of(
                AllocationStatus.ASSIGNED, AllocationStatus.EN_ROUTE, AllocationStatus.ARRIVED,
                AllocationStatus.COMPLETED, AllocationStatus.CANCELLED, AllocationStatus.FAILED));
        graph.put(AllocationStatus.ASSIGNED, EnumSet.of(
                AllocationStatus.EN_ROUTE, AllocationStatus.ARRIVED, AllocationStatus.COMPLETED,
                AllocationStatus.CANCELLED, AllocationStatus.FAILED));
        graph.put(AllocationStatus.EN_ROUTE, EnumSet.of(
                AllocationStatus.ARRIVED, AllocationStatus.COMPLETED,
                AllocationStatus.CANCELLED, AllocationStatus.FAILED));
        graph.put(AllocationStatus.ARRIVED, EnumSet.of(
                AllocationStatus.COMPLETED, AllocationStatus.CANCELLED, AllocationStatus.FAILED));
        graph.put(AllocationStatus.COMPLETED, EnumSet.noneOf(AllocationStatus.class));
        graph.put(AllocationStatus.CANCELLED, EnumSet.noneOf(AllocationStatus.class));
        graph.put(AllocationStatus.FAILED, EnumSet.noneOf(AllocationStatus.class));
        return Collections.unmodifiableMap(graph);
    }

    public static Set<AllocationStatus> allowedTargets(AllocationStatus from) {
        return from == null ? EnumSet.allOf(AllocationStatus.class) : GRAPH.get(from);
    }

    public static boolean canTransition(AllocationStatus from, AllocationStatus to) {
        return to != null && allowedTargets(from).contains(to);
    }

    /** Throws {@link InvalidStateTransitionException} unless the move is legal. */
    public static void requireTransition(Object allocationId, AllocationStatus from, AllocationStatus to) {
        if (!canTransition(from, to)) {
            throw new InvalidStateTransitionException("Allocation", String.valueOf(allocationId), from, to,
                    "Allowed next statuses from " + from + ": " + allowedTargets(from));
        }
    }
}
