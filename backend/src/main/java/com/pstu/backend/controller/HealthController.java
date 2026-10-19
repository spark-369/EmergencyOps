package com.pstu.backend.controller;

import com.pstu.backend.dto.HealthResponse;
import com.pstu.backend.pipeline.EventOutboxRelay;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Service liveness plus the one number that says whether the pipeline is healthy.
 *
 * <p>A backlog in the outbox is not a crash — the API keeps answering — but it is
 * the earliest visible sign that the broker is unreachable, so it belongs on the
 * health surface the console already polls. The endpoint stays open (see
 * {@code SecurityConfig}); it exposes counts, not payloads.
 */
@RestController
@RequestMapping("/api/v1/health")
public class HealthController {

    private final EventOutboxRelay outboxRelay;

    public HealthController(EventOutboxRelay outboxRelay) {
        this.outboxRelay = outboxRelay;
    }

    @GetMapping
    public ResponseEntity<HealthResponse> health() {
        long pending = outboxRelay.pendingCount();
        long gaveUp = outboxRelay.gaveUpCount();
        long failed = outboxRelay.failedCount();
        long published = outboxRelay.publishedCount();

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("service", "emergency-response-platform");
        details.put("status", "operational");
        // Every outbound fact the broker has not acknowledged, whether or not it has
        // exhausted its retry budget. Before the `exhausted` flag split the two,
        // `pending` lost a row the moment it was flagged GAVE_UP — so a worsening
        // outage made the backlog look smaller.
        details.put("outboxPending", pending);
        details.put("outboxGaveUp", gaveUp);
        details.put("outboxFailed", failed);
        details.put("outboxPublished", published);
        // Degraded, not DOWN: events are queued durably and re-offered every relay
        // pass, so a broker outage delays delivery rather than losing it. ATTENTION
        // means a row exhausted its retry budget and is still being retried — an
        // operator should look, but the API and the data are fine.
        //
        // Undeliverable rows (corrupt payload) deliberately do not count: they never
        // clear by waiting, and would hold the indicator at ATTENTION permanently.
        //
        // `pending` now includes exhausted rows, so it is the superset: `gaveUp`
        // narrows it to the rows that have already burned their budget. Checking
        // `gaveUp` first means a backlog where *everything* has failed repeatedly
        // escalates to ATTENTION, while fresh rows that are still being delivered
        // normally only report DELAYED.
        details.put("eventDelivery", gaveUp > 0 ? "ATTENTION" : pending > 0 ? "DELAYED" : "OK");

        return ResponseEntity.ok(HealthResponse.builder()
                .status("UP")
                .details(details)
                .build());
    }
}
