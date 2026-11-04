package com.pstu.backend.util;

import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.entity.Resource;
import com.pstu.backend.enums.IncidentSeverity;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * The triage score and the straight-line travel estimate.
 *
 * <p>{@link PriorityCalculator} is the number every screen sorts by and the one the
 * optimizer hands the most urgent incident to first (README §16.1). A silent drift in
 * a single component would reorder the whole active-incident board without any
 * exception being raised, so each term is pinned here: the severity base, the
 * affected-people cap, the time-sensitivity decay, the environmental bonus, and the
 * 100 ceiling.
 */
class PriorityCalculatorTest {

    /** Incident shaped for scoring: no coordinates needed. */
    private static EmergencyIncident scoring(IncidentSeverity severity, int affectedPeople,
                                             int timeSensitivityMinutes,
                                             Map<String, Object> conditions) {
        return EmergencyIncident.builder()
                .severity(severity)
                .affectedPeople(affectedPeople)
                .timeSensitivityMinutes(timeSensitivityMinutes)
                .environmentalConditions(conditions)
                .build();
    }

    @Test
    void severityAloneDeterminesTheBaseScore() {
        // affectedPeople 0 and timeSensitivity 100 zero the other terms, so the
        // result is the severity contribution in isolation.
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.LOW, 0, 100, null)))
                .isEqualTo(10);
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.MEDIUM, 0, 100, null)))
                .isEqualTo(30);
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.HIGH, 0, 100, null)))
                .isEqualTo(60);
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.CRITICAL, 0, 100, null)))
                .isEqualTo(80);
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.CATASTROPHIC, 0, 100, null)))
                .isEqualTo(100);
    }

    @Test
    void affectedPeopleAddsAtMostThirtyPoints() {
        // 100 people -> min(10, 30) = 10.
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.HIGH, 100, 100, null)))
                .isEqualTo(70);
        // 1000 people -> the contribution is capped at 30, not 100.
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.HIGH, 1000, 100, null)))
                .isEqualTo(90);
    }

    @Test
    void timeSensitivityDecaysToZero() {
        // max(0, 20 - minutes/5): immediate is worth the full 20…
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.LOW, 0, 0, null)))
                .isEqualTo(30);
        // …25 minutes halves it…
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.LOW, 0, 25, null)))
                .isEqualTo(25);
        // …and past 100 minutes it contributes nothing rather than going negative.
        assertThat(PriorityCalculator.calculatePriority(scoring(IncidentSeverity.LOW, 0, 100, null)))
                .isEqualTo(10);
    }

    @Test
    void environmentalConditionsAddAFixedBonus() {
        assertThat(PriorityCalculator.calculatePriority(
                scoring(IncidentSeverity.LOW, 0, 100, Map.of("flood", "high"))))
                .isEqualTo(15);
        // An empty map is "no conditions", not "some conditions".
        assertThat(PriorityCalculator.calculatePriority(
                scoring(IncidentSeverity.LOW, 0, 100, Map.of())))
                .isEqualTo(10);
        assertThat(PriorityCalculator.calculatePriority(
                scoring(IncidentSeverity.LOW, 0, 100, null)))
                .isEqualTo(10);
    }

    @Test
    void scoreIsClampedToOneHundred() {
        // 100 + 30 + 20 + 5 = 155 before the cap.
        assertThat(PriorityCalculator.calculatePriority(
                scoring(IncidentSeverity.CATASTROPHIC, 300, 0, Map.of("x", 1))))
                .isEqualTo(100);
    }

    @Test
    void combinedScoreMatchesTheDocumentedExample() {
        // CRITICAL 80 + min(120/10, 30)=12 + (20 - 10/5)=18 + 5 = 115 -> 100.
        assertThat(PriorityCalculator.calculatePriority(
                scoring(IncidentSeverity.CRITICAL, 120, 10, Map.of("smoke", true))))
                .isEqualTo(100);
    }

    @Test
    void haversineDistanceIsZeroForTheSamePoint() {
        assertThat(PriorityCalculator.haversineDistance(23.8103, 90.4125, 23.8103, 90.4125))
                .isZero();
    }

    @Test
    void haversineDistanceMatchesTheKnownOneDegreeArc() {
        // One degree of longitude at the equator is ~111.19 km.
        assertThat(PriorityCalculator.haversineDistance(0.0, 0.0, 0.0, 1.0))
                .isCloseTo(111.19, within(1.0));
    }

    @Test
    void travelTimeIsDistanceOverSpeedRoundedUp() {
        EmergencyIncident scene = EmergencyIncident.builder()
                .latitude(0.0).longitude(0.0).build();

        // Same coordinates -> zero minutes.
        Resource atScene = Resource.builder().latitude(0.0).longitude(0.0)
                .travelSpeedKmh(60.0).build();
        assertThat(PriorityCalculator.calculateTravelTime(scene, atScene)).isZero();

        // ~111.19 km at 60 km/h -> ~111.19 min -> rounded up to 112.
        Resource oneDegreeAway = Resource.builder().latitude(0.0).longitude(1.0)
                .travelSpeedKmh(60.0).build();
        assertThat(PriorityCalculator.calculateTravelTime(scene, oneDegreeAway)).isEqualTo(112);
    }

    @Test
    void aUnitWithNoRecordedSpeedIsAssumedToMakeSixtyKmh() {
        EmergencyIncident scene = EmergencyIncident.builder()
                .latitude(0.0).longitude(0.0).build();
        Resource unknownSpeed = Resource.builder().latitude(0.0).longitude(1.0).build();

        // Null speed must fall back to 60 km/h rather than NPE.
        assertThat(PriorityCalculator.calculateTravelTime(scene, unknownSpeed)).isEqualTo(112);
    }
}
