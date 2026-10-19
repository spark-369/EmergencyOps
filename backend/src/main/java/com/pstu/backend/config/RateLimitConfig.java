package com.pstu.backend.config;

import io.github.resilience4j.ratelimiter.RateLimiter;
import io.github.resilience4j.ratelimiter.RateLimiterConfig;
import io.github.resilience4j.ratelimiter.RateLimiterRegistry;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.HashSet;
import java.util.Set;

/**
 * Per-client-IP rate limiters for the unauthenticated authentication endpoints.
 *
 * <p>Resilience4j's starter configures each named instance from
 * {@code resilience4j.ratelimiter.instances.<name>} (see
 * {@code application.properties}) but hands out one {@link RateLimiter} per name
 * — shared by every caller. That is correct for a general API limiter and wrong
 * for login: a single {@code limit-for-period: 10} across all clients means the
 * eleventh attempt from <em>anywhere in the world</em> waits for the period to
 * roll over. Ten failed logins from an attacker would lock every operator out of
 * an emergency console.
 *
 * <p>So the configured instances are treated as <em>templates</em>: their
 * configuration is copied once, and a separate limiter is minted per client key.
 * Keys live in the same registry under {@code authLogin/203.0.113.7}, so limits
 * stay isolated per client while configuration stays in one place.
 *
 * <p><strong>Bounded memory.</strong> A per-IP cache is itself a memory-exhaustion
 * vector: an attacker rotating source addresses would add an entry per request.
 * The tracked-key count is therefore capped; once full, new keys share a single
 * overflow bucket, so the limiter degrades under a flood instead of growing.
 *
 * <p><strong>Forwarding headers are opt-in.</strong> {@link #clientKey()} trusts
 * the TCP peer address by default and only reads {@code X-Forwarded-For} when
 * {@code app.security.trust-forwarded-headers=true}. Those headers are supplied
 * by the client and trivially forged; trusting them unconditionally makes the
 * limiter a no-op — send a new value per request, get a new bucket per request.
 */
@Configuration
public class RateLimitConfig {

    private static final Logger log = LoggerFactory.getLogger(RateLimitConfig.class);

    /** Names must match the instances declared in application.properties. */
    public static final String LOGIN_LIMITER = "authLogin";
    public static final String REGISTER_LIMITER = "authRegister";
    public static final String REFRESH_LIMITER = "authRefresh";

    /** Every limiter this class manages. */
    private static final String[] MANAGED = {LOGIN_LIMITER, REGISTER_LIMITER, REFRESH_LIMITER};

    /** Upper bound on distinct client keys held at once. */
    private static final int MAX_TRACKED_CLIENTS = 10_000;

    /** Bucket used once the tracked-key cap is reached. */
    static final String OVERFLOW_KEY = "shared-overflow";

    /** Separates the template name from the client key in registry keys. */
    private static final String KEY_SEPARATOR = "/";

    private final RateLimiterRegistry registry;
    private final boolean trustForwardedHeaders;

    /**
     * Clients that have been admitted a bucket.
     *
     * <p>Kept here rather than derived from the registry: the registry has no
     * "does this key exist" query that is cheap and version-stable, and both the
     * counting and the admission decision need to be O(1) on the hot path of the
     * login endpoint. Bounded by {@link #MAX_TRACKED_CLIENTS}.
     */
    private final Set<String> seenClients = new HashSet<>();

    /** Guards {@link #seenClients} so concurrent new clients cannot overshoot the cap. */
    private final Object admissionLock = new Object();

    public RateLimitConfig(RateLimiterRegistry registry, Environment environment) {
        this.registry = registry;
        this.trustForwardedHeaders = Boolean.parseBoolean(
                environment.getProperty("app.security.trust-forwarded-headers", "false"));

        // Validate at startup that every managed name is configured. Without this
        // a typo in either place would leave an endpoint silently unlimited.
        for (String name : MANAGED) {
            if (registry.find(name).isEmpty()) {
                throw new IllegalStateException(
                        "Rate limiter '" + name + "' is not configured. Add "
                                + "resilience4j.ratelimiter.instances." + name + ".* to configuration.");
            }
            RateLimiterConfig config = templateConfig(name);
            log.info("Rate limiter '{}' active: {} permits per {} per client",
                    name, config.getLimitForPeriod(), config.getLimitRefreshPeriod());
        }
    }

    /** The shared configuration registered by the starter for a managed name. */
    private RateLimiterConfig templateConfig(String name) {
        return registry.find(name).orElseThrow().getRateLimiterConfig();
    }

    /**
     * The limiter for a configured instance and the current HTTP client.
     *
     * @param name one of {@link #LOGIN_LIMITER}, {@link #REGISTER_LIMITER},
     *             {@link #REFRESH_LIMITER}
     */
    public RateLimiter forCurrentClient(String name) {
        return limiterFor(name, clientKey());
    }

    /** Exposed for call sites and tests that have already resolved the client. */
    public RateLimiter limiterFor(String name, String clientKey) {
        if (name == null || registry.find(name).isEmpty()) {
            throw new IllegalArgumentException("No rate limiter configured under '" + name + "'");
        }
        String admitted = admit(clientKey);
        String key = name + KEY_SEPARATOR + admitted;
        // `rateLimiter(name, supplier)` is idempotent: the supplier only runs on a
        // miss, so a returning client keeps its counter rather than a clean slate.
        return registry.rateLimiter(key,
                () -> RateLimiterConfig.from(templateConfig(name)).build());
    }

    /**
     * Decides which bucket a client belongs to, enforcing the tracked-key cap.
     *
     * <p>Beyond the cap every new client funnels into {@link #OVERFLOW_KEY}, so a
     * flood of forged clients is throttled collectively while already-known
     * clients keep their individual allowances.
     */
    private String admit(String clientKey) {
        if (clientKey == null || clientKey.isBlank()) {
            return OVERFLOW_KEY;
        }
        synchronized (admissionLock) {
            // Counting only *new* keys: a returning client must not consume a slot
            // on every request, or the cap would be reached by a handful of normal
            // users. `seenClients` is the admission set.
            if (seenClients.add(clientKey)) {
                if (seenClients.size() > MAX_TRACKED_CLIENTS) {
                    log.warn("Rate limiter map is full ({} tracked clients); new clients share "
                                    + "'{}'. This usually means a spoofed-source flood or a proxy "
                                    + "that is not forwarding the real client address.",
                            MAX_TRACKED_CLIENTS, OVERFLOW_KEY);
                    return OVERFLOW_KEY;
                }
            }
            return clientKey;
        }
    }

    /**
     * Best-effort identity of the calling client.
     *
     * <p>See the class comment: forwarding headers are honoured only when
     * explicitly trusted.
     */
    String clientKey() {
        HttpServletRequest request = currentRequest();
        if (request == null) {
            // No request context (a startup self-check, say): one shared bucket is
            // the safe answer, never an unbounded key.
            return OVERFLOW_KEY;
        }
        if (trustForwardedHeaders) {
            String forwarded = request.getHeader("X-Forwarded-For");
            if (forwarded != null && !forwarded.isBlank()) {
                // The left-most entry is the original client; proxies append the rest.
                return forwarded.split(",")[0].trim();
            }
            String realIp = request.getHeader("X-Real-IP");
            if (realIp != null && !realIp.isBlank()) {
                return realIp.trim();
            }
        }
        return request.getRemoteAddr();
    }

    private static HttpServletRequest currentRequest() {
        var attributes = RequestContextHolder.getRequestAttributes();
        return attributes instanceof ServletRequestAttributes servletAttributes
                ? servletAttributes.getRequest()
                : null;
    }
}
