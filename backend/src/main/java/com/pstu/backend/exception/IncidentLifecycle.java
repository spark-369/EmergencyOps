package com.pstu.backend.exception;

import com.pstu.backend.enums.IncidentStatus;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * The incident lifecycle as a closed graph.
 *
 * <pre>
 * RECEIVED ──▶ PRIORITIZED ──▶ ALLOCATING ──▶ IN_PROGRESS ──▶ RESOLVED
 *    │              │               │              │
 *    └──────────────┴───────────────┴──▶ CANCELLED
 *    └──────────────┴───────────────┴──▶ FAILED
 * </pre>
 *
 * <p>Terminal states have no outgoing edges, and a "transition" to the current
 * status is rejected: both are what a duplicate Kafka delivery would attempt,
 * and silently accepting it would re-run side effects (capacity counters, outbox
 * rows) for the same fact.
 */
public final class IncidentLifecycle {

    private static final Map<IncidentStatus, Set<IncidentStatus>> GRAPH = buildGraph();

    private IncidentLifecycle() {
    }

    private static Map<IncidentStatus, Set<IncidentStatus>> buildGraph() {
        Map<IncidentStatus, Set<IncidentStatus>> graph = new EnumMap<>(IncidentStatus.class);
        graph.put(IncidentStatus.RECEIVED, EnumSet.of(
                IncidentStatus.PRIORITIZED, IncidentStatus.CANCELLED, IncidentStatus.FAILED));
        graph.put(IncidentStatus.PRIORITIZED, EnumSet.of(
                IncidentStatus.ALLOCATING, IncidentStatus.IN_PROGRESS,
                IncidentStatus.CANCELLED, IncidentStatus.FAILED));
        graph.put(IncidentStatus.ALLOCATING, EnumSet.of(
                IncidentStatus.IN_PROGRESS, IncidentStatus.CANCELLED, IncidentStatus.FAILED));
        graph.put(IncidentStatus.IN_PROGRESS, EnumSet.of(
                IncidentStatus.RESOLVED, IncidentStatus.FAILED));
        graph.put(IncidentStatus.RESOLVED, EnumSet.noneOf(IncidentStatus.class));
        graph.put(IncidentStatus.CANCELLED, EnumSet.noneOf(IncidentStatus.class));
        graph.put(IncidentStatus.FAILED, EnumSet.noneOf(IncidentStatus.class));
        return Collections.unmodifiableMap(graph);
    }

    /** Statuses that {@code from} may move to. Empty for terminal states. */
    public static Set<IncidentStatus> allowedTargets(IncidentStatus from) {
        return from == null ? EnumSet.allOf(IncidentStatus.class) : GRAPH.get(from);
    }

    public static boolean canTransition(IncidentStatus from, IncidentStatus to) {
        return to != null && allowedTargets(from).contains(to);
    }

    public static boolean isTerminal(IncidentStatus status) {
        return status != null && allowedTargets(status).isEmpty();
    }

    /** Throws {@link InvalidStateTransitionException} unless the move is legal. */
    public static void requireTransition(String incidentId, IncidentStatus from, IncidentStatus to) {
        if (!canTransition(from, to)) {
            throw new InvalidStateTransitionException("Incident", incidentId, from, to,
                    "Allowed next statuses from " + from + ": " + allowedTargets(from));
        }
    }
}
