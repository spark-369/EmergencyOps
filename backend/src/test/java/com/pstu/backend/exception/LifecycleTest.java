package com.pstu.backend.exception;

import com.pstu.backend.enums.AllocationStatus;
import com.pstu.backend.enums.IncidentStatus;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Guards the state machines the REST API, the optimizer and the ingest loop all
 * share. These were the holes that let a completed deployment be re-opened and a
 * resolved incident be re-dispatched.
 */
class LifecycleTest {

    @Test
    void incidentFollowsTheHappyPath() {
        assertThat(IncidentLifecycle.canTransition(IncidentStatus.PRIORITIZED, IncidentStatus.ALLOCATING)).isTrue();
        assertThat(IncidentLifecycle.canTransition(IncidentStatus.ALLOCATING, IncidentStatus.IN_PROGRESS)).isTrue();
        assertThat(IncidentLifecycle.canTransition(IncidentStatus.IN_PROGRESS, IncidentStatus.RESOLVED)).isTrue();
    }

    @ParameterizedTest
    @EnumSource(value = IncidentStatus.class, names = {"RESOLVED", "CANCELLED", "FAILED"})
    void incidentTerminalStatesAcceptNothing(IncidentStatus terminal) {
        assertThat(IncidentLifecycle.isTerminal(terminal)).isTrue();
        assertThat(IncidentLifecycle.allowedTargets(terminal)).isEmpty();
    }

    @Test
    void incidentCannotBeReopenedOrRepeated() {
        // Repeating the current status is what a duplicate Kafka delivery does.
        assertThatThrownBy(() -> IncidentLifecycle.requireTransition(
                "inc-1", IncidentStatus.IN_PROGRESS, IncidentStatus.IN_PROGRESS))
                .isInstanceOf(InvalidStateTransitionException.class);

        assertThatThrownBy(() -> IncidentLifecycle.requireTransition(
                "inc-1", IncidentStatus.RESOLVED, IncidentStatus.ALLOCATING))
                .isInstanceOf(InvalidStateTransitionException.class)
                .hasMessageContaining("Allowed next statuses");
    }

    @Test
    void allocationCannotGoBackwards() {
        assertThat(AllocationLifecycle.canTransition(AllocationStatus.PENDING, AllocationStatus.ASSIGNED)).isTrue();
        assertThat(AllocationLifecycle.canTransition(AllocationStatus.COMPLETED, AllocationStatus.PENDING)).isFalse();
        assertThat(AllocationLifecycle.canTransition(AllocationStatus.CANCELLED, AllocationStatus.EN_ROUTE)).isFalse();
    }

    @Test
    void allocationMaySkipForward() {
        // A unit already on scene is reported as ARRIVED without EN_ROUTE.
        assertThat(AllocationLifecycle.canTransition(AllocationStatus.PENDING, AllocationStatus.ARRIVED)).isTrue();
        assertThat(AllocationLifecycle.canTransition(AllocationStatus.EN_ROUTE, AllocationStatus.COMPLETED)).isTrue();
    }

    @Test
    void rejectionNamesBothStatesAndSuggestsAlternatives() {
        assertThatThrownBy(() -> AllocationLifecycle.requireTransition(
                "42", AllocationStatus.COMPLETED, AllocationStatus.ASSIGNED))
                .isInstanceOf(InvalidStateTransitionException.class)
                .isInstanceOfSatisfying(InvalidStateTransitionException.class, ex -> {
                    assertThat(ex.from()).isEqualTo("COMPLETED");
                    assertThat(ex.to()).isEqualTo("ASSIGNED");
                    assertThat(ex.aggregateId()).isEqualTo("42");
                });
    }
}
