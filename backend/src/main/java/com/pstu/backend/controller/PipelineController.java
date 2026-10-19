package com.pstu.backend.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pstu.backend.entity.PipelineEventRecord;
import com.pstu.backend.entity.PipelineEventRecord.MessageKind;
import com.pstu.backend.pipeline.DomainEventType;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventOutboxRelay;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.pipeline.EventStore;
import com.pstu.backend.repository.PipelineEventRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Operator-facing window into the event pipeline.
 *
 * <p>Three capabilities, all restricted to admins and dispatchers because they
 * expose internal state or cause delivery:
 *
 * <ul>
 *   <li><strong>Timeline</strong> — every event recorded for one aggregate: the
 *       audit trail of an incident from report to resolve.</li>
 *   <li><strong>Backlog</strong> — what the outbox still owes Redis. A growing number
 *       here is the single best indicator that Redis (or JobRunr) is unreachable.</li>
 *   <li><strong>Replay</strong> — re-publishes a stored envelope (for example
 *       after a consumer was fixed), keeping the original event id so consumers
 *       that already applied it stay idempotent.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/pipeline")
@PreAuthorize("hasAnyRole('ADMIN','DISPATCHER')")
public class PipelineController {

    private final PipelineEventRepository repository;
    private final EventStore eventStore;
    private final EventPublisher publisher;
    private final EventOutboxRelay relay;

    /**
     * {@code host:port} of Redis, echoed by {@code GET /outbox}.
     *
     * <p>A field rather than a constructor argument so the four-argument constructor —
     * and every test that builds this controller with it — keeps working. Read-only
     * diagnostic context, not a dependency.
     */
    @Value("${spring.data.redis.host:localhost}:${spring.data.redis.port:6379}")
    private String redisAddress;

    /**
     * Jackson 2 mapper for decoding stored event payloads.
     *
     * <p>A field rather than a constructor argument, for the same reason as
     * {@code redisAddress}: the four-argument constructor is relied on by existing
     * tests, and deserialising a stored payload is a read-only concern of one
     * endpoint. It is the {@code JacksonConfig} bean, so date handling matches the
     * rest of the pipeline.
     */
    @Autowired
    private ObjectMapper objectMapper;

    public PipelineController(PipelineEventRepository repository,
                              EventStore eventStore,
                              EventPublisher publisher,
                              EventOutboxRelay relay) {
        this.repository = repository;
        this.eventStore = eventStore;
        this.publisher = publisher;
        this.relay = relay;
    }

    /** Events of one aggregate, oldest first. */
    @GetMapping("/timeline/{aggregateId}")
    public ResponseEntity<List<Map<String, Object>>> timeline(@PathVariable String aggregateId) {
        List<Map<String, Object>> timeline = repository
                .findByAggregateIdOrderByOccurredAtAsc(aggregateId).stream()
                .map(record -> {
                    Map<String, Object> view = new LinkedHashMap<>();
                    view.put("eventId", record.getEventId());
                    view.put("type", record.getEventType());
                    view.put("kind", record.getKind());
                    view.put("correlationId", record.getCorrelationId());
                    view.put("status", record.getStatus());
                    view.put("attempts", record.getPublishAttempts());
                    // Why a row is not moving. Without this the console could only say
                    // "pending" while the reason (broker unreachable, topic missing,
                    // authorization) sat unread in the database.
                    view.put("exhausted", record.isExhausted());
                    view.put("lastError", record.getLastError());
                    view.put("occurredAt", record.getOccurredAt());
                    view.put("publishedAt", record.getPublishedAt());
                    /*
                     * The stored envelope, parsed.
                     *
                     * A timeline of "INCIDENT_STATUS_CHANGED" lines tells an operator
                     * *that* something happened but not *what* — the answer
                     * (previousStatus -> status, the reason, the score that drove a
                     * re-prioritisation) lives in the payload, which the row has stored
                     * since the outbox was written.
                     *
                     * It is parsed here rather than returned as a JSON string so the
                     * console never has to `JSON.parse` an opaque field, and so a
                     * malformed row degrades to `null` instead of breaking the whole
                     * timeline response.
                     */
                    view.put("payload", parsePayload(objectMapper, record.getPayload()));
                    return view;
                })
                .toList();
        return ResponseEntity.ok(timeline);
    }

    /**
     * Parses a stored event payload, tolerating anything that is not a JSON object.
     *
     * <p>Returns {@code null} rather than throwing: an unparseable payload is
     * already recorded on the row as a delivery failure, and a timeline that
     * refuses to render because one historical row is corrupt would hide the
     * events that do explain the incident.
     */
    private static Map<String, Object> parsePayload(ObjectMapper objectMapper, String payload) {
        if (payload == null || payload.isBlank()) return null;
        try {
            return objectMapper.readValue(payload, new TypeReference<Map<String, Object>>() {
            });
        } catch (Exception ignored) {
            return null;
        }
    }

    /** Events of one type, newest first. */
    @GetMapping("/events")
    public ResponseEntity<List<Map<String, Object>>> events(
            @RequestParam DomainEventType type,
            @RequestParam(defaultValue = "50") int limit) {
        // Clamped: an unbounded limit is a trivial way to pull the whole store.
        int capped = Math.min(Math.max(limit, 1), 200);
        List<Map<String, Object>> events = repository
                .findByEventTypeOrderByOccurredAtDesc(type, PageRequest.of(0, capped)).stream()
                .map(record -> {
                    Map<String, Object> view = new LinkedHashMap<>();
                    view.put("eventId", record.getEventId());
                    view.put("aggregateId", record.getAggregateId());
                    view.put("correlationId", record.getCorrelationId());
                    view.put("status", record.getStatus());
                    view.put("occurredAt", record.getOccurredAt());
                    return view;
                })
                .toList();
        return ResponseEntity.ok(events);
    }

    /** Delivery backlog and dead-letter count. */
    @GetMapping("/outbox")
    public ResponseEntity<Map<String, Object>> outbox() {
        long pending = relay.pendingCount();
        long gaveUp = relay.gaveUpCount();
        long published = relay.publishedCount();
        Map<String, Object> status = new LinkedHashMap<>();
        // Unacknowledged outbound facts, including the exhausted ones below.
        status.put("pending", pending);
        // Subset of `pending` that has exhausted its retry budget.
        status.put("gaveUp", gaveUp);
        // Facts Redis has acknowledged; bookkeeping rows are excluded so this
        // cannot be inflated by consumer markers or PROCESSING_FAILED logs.
        status.put("published", published);

        /*
         * The diagnosis, in the same response as the numbers.
         *
         * "Why is nothing ever PUBLISHED?" is answered by the most recent delivery
         * error, and until now that only existed in the database — which meant an
         * operator seeing a growing `pending` had to open psql to learn that the Redis
         * address was wrong or the instance was full. Exposing it here keeps the
         * console the single place to look.
         */
        status.put("transport", "redis");
        status.put("broker", redisAddress);
        status.put("lastDeliveryError", repository
                .findFirstByKindAndLastErrorIsNotNullOrderByOccurredAtDesc(MessageKind.OUTBOUND)
                .map(PipelineEventRecord::getLastError)
                .orElse(null));
        return ResponseEntity.ok(status);
    }

    /**
     * Forces one bounded relay pass instead of waiting for the schedule.
     *
     * <p>Bounded on purpose. Each outbox row is a blocking {@code send().get()}, and
     * with an unreachable broker one row can wait out the producer's delivery timeout;
     * an unbounded pass therefore cannot answer before any sensible client timeout.
     * This call spends at most {@code flush-budget} and reports what it managed,
     * leaving the remainder to the scheduled pass that runs every 15 s.
     *
     * <p>Safe to retry: it re-publishes rows that are already committed, and the
     * consumer deduplicates on {@code eventId}, so a second call cannot apply an event
     * twice.
     */
    @PostMapping("/outbox/flush")
    public ResponseEntity<Map<String, Object>> flush(
            @RequestParam(defaultValue = "5000") long budget) {
        // Clamped: a caller must not be able to pin a request thread for a minute.
        long capped = Math.min(Math.max(budget, 100), 10_000);
        int delivered = relay.flushBounded(Duration.ofMillis(capped));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("delivered", delivered);
        result.put("pending", relay.pendingCount());
        result.put("budgetMs", capped);
        return ResponseEntity.ok(result);
    }

    /**
     * Re-publishes a stored event.
     *
     * <p>The envelope keeps its original {@code eventId}, so a consumer that
     * already applied it recognises the duplicate and does nothing.
     */
    @PostMapping("/replay/{eventId}")
    public ResponseEntity<Map<String, Object>> replay(@PathVariable String eventId) {
        return repository.findByEventId(eventId)
                .map(record -> {
                    EventEnvelope envelope = eventStore.deserialize(record);
                    boolean delivered = publisher.deliver(record, envelope);
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("eventId", eventId);
                    result.put("delivered", delivered);
                    return new ResponseEntity<>(result,
                            delivered ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
                })
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
