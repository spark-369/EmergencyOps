package com.pstu.backend.pipeline;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * The correlation id an inbound {@code X-Correlation-Id} header becomes.
 *
 * <p>The header is attacker-controlled, so the value that reaches the MDC, the
 * response and every persisted event must be safe to log. These tests pin the two
 * behaviours that matter: a well-formed id is echoed verbatim (so a trace survives
 * the hop), and anything malformed — control characters, an over-long value — is
 * discarded in favour of a generated UUID instead of being written through.
 */
class CorrelationIdFilterTest {

    private static boolean isUuid(String value) {
        try {
            UUID.fromString(value);
            return true;
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }

    @Test
    void absentHeaderYieldsAFreshUuid() {
        assertThat(isUuid(CorrelationIdFilter.resolve(null))).isTrue();
    }

    @Test
    void wellFormedHeaderIsEchoedVerbatim() {
        assertThat(CorrelationIdFilter.resolve("a1b2-c3d4.e5f6")).isEqualTo("a1b2-c3d4.e5f6");
    }

    @Test
    void surroundingWhitespaceIsTrimmed() {
        assertThat(CorrelationIdFilter.resolve("  trace-1  ")).isEqualTo("trace-1");
    }

    @Test
    void blankHeaderYieldsAFreshUuid() {
        assertThat(isUuid(CorrelationIdFilter.resolve("   "))).isTrue();
    }

    @Test
    void controlCharactersAreRejected() {
        // A newline would let a caller forge extra log lines.
        assertThat(isUuid(CorrelationIdFilter.resolve("bad\nid"))).isTrue();
        assertThat(isUuid(CorrelationIdFilter.resolve("bad id"))).isTrue();
    }

    @Test
    void overlongHeaderIsRejected() {
        assertThat(isUuid(CorrelationIdFilter.resolve("x".repeat(129)))).isTrue();
    }

    @Test
    void maximumLengthHeaderIsAccepted() {
        String atLimit = "x".repeat(128);
        assertThat(CorrelationIdFilter.resolve(atLimit)).isEqualTo(atLimit);
    }

    @Test
    void bindingAndReadingBackRoundTripsOnTheCallingThread() {
        String previous = CorrelationIdFilter.bind("corr-42");
        try {
            assertThat(CorrelationIdFilter.current()).isEqualTo("corr-42");
        } finally {
            CorrelationIdFilter.clear();
        }
        assertThat(previous).isNull();
        assertThat(CorrelationIdFilter.current()).isNull();
    }

    @Test
    void blankCorrelationIdIsIgnoredRatherThanWritten() {
        CorrelationIdFilter.bind("corr-1");
        try {
            // A malformed event must not stamp every subsequent log line with an
            // empty frame.
            assertThatCode(() -> CorrelationIdFilter.bind("  ")).doesNotThrowAnyException();
            assertThat(CorrelationIdFilter.current()).isEqualTo("corr-1");
        } finally {
            CorrelationIdFilter.clear();
        }
    }
}
