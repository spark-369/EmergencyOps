package com.pstu.backend.pipeline;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * Establishes the correlation id for one request.
 *
 * <p>The id is taken from {@code X-Correlation-Id} when a trusted client (an
 * upstream gateway, the Next.js server) supplies one, and generated otherwise. It
 * is written to the MDC <em>and</em> echoed as a response header, so a support
 * ticket quoting the header can be traced through the API log, the persisted
 * outbox and the Kafka headers of every downstream event.
 *
 * <p>Runs {@link Ordered#HIGHEST_PRECEDENCE} so that every later filter,
 * including the security chain, logs under the same id. Unlike
 * {@code LoggingFilter}'s {@code requestId} (one id per hop), this value is
 * <em>propagated</em>: it is the thread that ties the hops together.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Correlation-Id";
    public static final String MDC_KEY = "correlationId";

    /** Guard against a caller smuggling control characters into log output. */
    private static final int MAX_LENGTH = 128;
    private static final java.util.regex.Pattern ALLOWED = java.util.regex.Pattern.compile("[A-Za-z0-9._:-]{1,128}");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String correlationId = resolve(request.getHeader(HEADER));
        MDC.put(MDC_KEY, correlationId);
        response.setHeader(HEADER, correlationId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }

    /** Returns a safe echo of {@code incoming}, or a fresh UUID. */
    static String resolve(String incoming) {
        if (incoming == null) {
            return UUID.randomUUID().toString();
        }
        String trimmed = incoming.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_LENGTH || !ALLOWED.matcher(trimmed).matches()) {
            return UUID.randomUUID().toString();
        }
        return trimmed;
    }

    /** The id of the current request, or {@code null} outside a request thread. */
    public static String current() {
        return MDC.get(MDC_KEY);
    }

    /**
     * Reads the id from the MDC, falling back to a random one. Kafka listeners run
     * on their own threads with no MDC, so consumers call this to keep the trace
     * continuous rather than emitting a log line with a null id.
     */
    public static String currentOrRandom() {
        String current = MDC.get(MDC_KEY);
        return current != null ? current : UUID.randomUUID().toString();
    }

    /**
     * Puts {@code correlationId} into the MDC for the current thread.
     *
     * <p>Kafka listener threads have no request context, so the consumer calls this
     * with the id from the envelope. A blank or absent id is ignored rather than
     * written, so a malformed event does not stamp every log line of the partition
     * with an empty frame. Returns the previous value so a caller that processes
     * several units of work on one thread can restore it.
     */
    public static String bind(String correlationId) {
        String previous = MDC.get(MDC_KEY);
        if (correlationId == null || correlationId.isBlank()) {
            return previous;
        }
        MDC.put(MDC_KEY, correlationId);
        return previous;
    }

    /** Removes the id from the MDC of the current thread. */
    public static void clear() {
        MDC.remove(MDC_KEY);
    }
}
