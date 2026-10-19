package com.pstu.backend.config;

import com.pstu.backend.pipeline.CorrelationIdFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Access log line for every request.
 *
 * <p>This filter used to generate its own {@code X-Request-Id} and add it to the
 * MDC, which produced two unrelated ids per request: one that reached the client
 * and another that reached the logs. It now reads the id established by
 * {@link CorrelationIdFilter}, which runs at the very start of the chain and is
 * the same value echoed to the client and propagated into Kafka events — so a
 * report from an operator names one id that can be searched everywhere.
 */
@Component
public class LoggingFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(LoggingFilter.class);

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String correlationId = CorrelationIdFilter.current();
        if (correlationId != null) {
            MDC.put(CorrelationIdFilter.MDC_KEY, correlationId);
        }

        long startTime = System.currentTimeMillis();
        try {
            filterChain.doFilter(request, response);
        } finally {
            long duration = System.currentTimeMillis() - startTime;
            // One structured line per request, emitted *after* the status is known.
            // The MDC already carries method/path/correlationId.
            log.info("{} {} -> {} ({} ms)", request.getMethod(), request.getRequestURI(),
                    response.getStatus(), duration);
        }
    }
}
