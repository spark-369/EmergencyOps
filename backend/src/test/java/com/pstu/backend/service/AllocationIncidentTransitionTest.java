package com.pstu.backend.service;

import com.pstu.backend.enums.IncidentStatus;
import com.pstu.backend.exception.IncidentLifecycle;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The transaction-safety rule behind dispatching a second unit to the same incident.
 *
 * <p>{@code AllocationService.moveIncident} must decide whether to advance the
 * incident <em>before</em> calling {@code IncidentLifecycleService.transition}. Calling
 * and catching instead marked the shared transaction rollback-only, so the allocation
 * was discarded at commit and the client got an {@code UnexpectedRollbackException}
 * (HTTP 500) instead of a recorded allocation.
 *
 * <p>These assertions pin the predicate the fix relies on, so a future change to the
 * lifecycle graph cannot silently reintroduce the call-and-swallow pattern.
 */
class AllocationIncidentTransitionTest {

    private static boolean shouldAdvance(IncidentStatus from, IncidentStatus to) {
        return IncidentLifecycle.canTransition(from, to);
    }

    @Test
    void firstDispatchAdvancesTheIncident() {
        assertThat(shouldAdvance(IncidentStatus.PRIORITIZED, IncidentStatus.ALLOCATING)).isTrue();
    }

    @Test
    void secondDispatchDoesNotAttemptTheTransition() {
        // The incident is already ALLOCATING; calling transition() here would throw and
        // poison the caller's transaction.
        assertThat(shouldAdvance(IncidentStatus.ALLOCATING, IncidentStatus.ALLOCATING)).isFalse();
        assertThat(shouldAdvance(IncidentStatus.IN_PROGRESS, IncidentStatus.ALLOCATING)).isFalse();
    }

    @Test
    void arrivingUnitStillAdvancesAnAllocatingIncident() {
        assertThat(shouldAdvance(IncidentStatus.ALLOCATING, IncidentStatus.IN_PROGRESS)).isTrue();
    }

    @Test
    void terminalIncidentsAreNeverAdvanced() {
        assertThat(shouldAdvance(IncidentStatus.RESOLVED, IncidentStatus.ALLOCATING)).isFalse();
        assertThat(shouldAdvance(IncidentStatus.CANCELLED, IncidentStatus.IN_PROGRESS)).isFalse();
        assertThat(shouldAdvance(IncidentStatus.FAILED, IncidentStatus.IN_PROGRESS)).isFalse();
    }

    @Test
    void anIllegalTransitionWouldPoisonATransactionIfAttempted() {
        // Demonstrates the difference the fix makes: requireTransition throws, which is
        // what used to escape a participating @Transactional bean and mark the shared
        // transaction rollback-only. The guard avoids reaching this at all.
        assertThatThrownBy(() -> IncidentLifecycle.requireTransition(
                "inc-1", IncidentStatus.ALLOCATING, IncidentStatus.ALLOCATING))
                .isInstanceOf(RuntimeException.class);

        assertThatCode(() -> {
            if (shouldAdvance(IncidentStatus.ALLOCATING, IncidentStatus.ALLOCATING)) {
                IncidentLifecycle.requireTransition(
                        "inc-1", IncidentStatus.ALLOCATING, IncidentStatus.ALLOCATING);
            }
        }).doesNotThrowAnyException();
    }
}
