package com.pstu.backend.exception;

import io.github.resilience4j.ratelimiter.RateLimiter;
import io.github.resilience4j.ratelimiter.RequestNotPermitted;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The JSON error contract the frontend is written against.
 *
 * <p>{@code lib/axios.ts} distinguishes a 401 (session expired — sign the user out)
 * from a 403 (wrong role — do not) and reads 429 to show "retry in a minute". Getting
 * a status wrong here therefore produces a visible product bug, not just a bad log
 * line, so each mapping is asserted directly.
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    private static Integer statusOf(ResponseEntity<Map<String, Object>> response) {
        return (Integer) response.getBody().get("status");
    }

    @Test
    void resourceNotFoundIs404() {
        ResponseEntity<Map<String, Object>> response =
                handler.handleResourceNotFound(new ResourceNotFoundException("User 1 does not exist"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(statusOf(response)).isEqualTo(404);
        assertThat(response.getBody().get("error")).isEqualTo("Not Found");
    }

    @Test
    void entityNotFoundIs404() {
        // Without this mapping a lookup by business id surfaced as a 500.
        ResponseEntity<Map<String, Object>> response =
                handler.handleEntityNotFound(new EntityNotFoundException("Incident not found: inc-1"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody().get("message")).isEqualTo("Incident not found: inc-1");
    }

    @Test
    void badCredentialsAre401() {
        ResponseEntity<Map<String, Object>> response =
                handler.handleBadCredentials(new BadCredentialsException("Invalid username or password"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(response.getBody().get("error")).isEqualTo("Unauthorized");
    }

    @Test
    void accessDeniedIs403AndDoesNotLeakTheInternalMessage() {
        ResponseEntity<Map<String, Object>> response =
                handler.handleAccessDenied(new AccessDeniedException("Access Denied"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        // The client-facing text is fixed, never the framework's message.
        assertThat(response.getBody().get("message"))
                .isEqualTo("Your role does not permit this action.");
    }

    @Test
    void illegalStateIs409() {
        ResponseEntity<Map<String, Object>> response =
                handler.handleIllegalState(new IllegalStateException("Username 'dana' already exists"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody().get("error")).isEqualTo("Conflict");
    }

    @Test
    void illegalArgumentIs400() {
        ResponseEntity<Map<String, Object>> response =
                handler.handleIllegalArgument(new IllegalArgumentException("bad input"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().get("message")).isEqualTo("bad input");
    }

    @Test
    void invalidStateTransitionIs409AndNamesBothStates() {
        InvalidStateTransitionException ex = new InvalidStateTransitionException(
                "Allocation", "42", "COMPLETED", "ASSIGNED",
                "Allowed next statuses from COMPLETED: []");

        ResponseEntity<Map<String, Object>> response = handler.handleInvalidTransition(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody())
                .containsEntry("aggregate", "Allocation")
                .containsEntry("aggregateId", "42")
                .containsEntry("from", "COMPLETED")
                .containsEntry("to", "ASSIGNED")
                .containsEntry("error", "Invalid State Transition");
        // The hint is what lets the console re-offer only the buttons that will work.
        assertThat((String) response.getBody().get("hint")).contains("Allowed next statuses");
    }

    @Test
    void rateLimitedIs429WithRetryAfter() {
        RequestNotPermitted ex = RequestNotPermitted.createRequestNotPermitted(
                RateLimiter.ofDefaults("authLogin-test"));

        ResponseEntity<Map<String, Object>> response = handler.handleRateLimited(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(response.getHeaders().getFirst(HttpHeaders.RETRY_AFTER)).isEqualTo("60");
        assertThat((String) response.getBody().get("message")).contains("Wait a minute");
    }

    @Test
    void malformedInputIs400() {
        ResponseEntity<Map<String, Object>> response = handler.handleBadRequest(
                new MissingServletRequestParameterException("minLat", "Double"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().get("error")).isEqualTo("Bad Request");
    }

    @Test
    void unsupportedMethodIs405() {
        ResponseEntity<Map<String, Object>> response =
                handler.handleMethodNotSupported(new HttpRequestMethodNotSupportedException("PUT"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.METHOD_NOT_ALLOWED);
    }

    @Test
    void unexpectedFailureIs500AndHidesTheInternalMessage() {
        ResponseEntity<Map<String, Object>> response =
                handler.handleGenericException(new RuntimeException("jdbc://secret-host connection refused"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat((String) response.getBody().get("message")).contains("Reference id");
        // A correlation id is echoed so an operator can find the stack trace…
        assertThat(response.getBody().get("correlationId")).isNotNull();
        // …but the raw exception text (host names, SQL) is never returned.
        assertThat((String) response.getBody().get("message")).doesNotContain("secret-host");
    }
}
