package com.pstu.backend.config;

import io.github.resilience4j.ratelimiter.RateLimiter;
import io.github.resilience4j.ratelimiter.RateLimiterConfig;
import io.github.resilience4j.ratelimiter.RateLimiterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Behaviour of the per-client auth rate limiter.
 *
 * <p>The property that matters is isolation: one client exhausting its allowance
 * must not affect any other. A limiter that simply counts every login attempt
 * would pass a "does it return 429 eventually" test and still lock the whole
 * console out after ten bad passwords — so that is what these tests assert.
 */
class RateLimitConfigTest {

    private static final RateLimiterConfig TEMPLATE = RateLimiterConfig.custom()
            .limitForPeriod(2)
            .limitRefreshPeriod(Duration.ofMinutes(1))
            .timeoutDuration(Duration.ZERO)
            .build();

    private RateLimiterRegistry registry;
    private RateLimitConfig config;

    @BeforeEach
    void setUp() {
        // A plain in-memory registry: no Spring context, no metrics, no clock
        // indirection — the subject here is the keying, not the wiring.
        registry = RateLimiterRegistry.of(RateLimiterConfig.ofDefaults());
        for (String name : new String[]{
                RateLimitConfig.LOGIN_LIMITER,
                RateLimitConfig.REGISTER_LIMITER,
                RateLimitConfig.REFRESH_LIMITER}) {
            registry.rateLimiter(name, TEMPLATE);
        }
        config = new RateLimitConfig(registry, new MockEnvironment());
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void eachClientGetsItsOwnAllowance() {
        RateLimiter attacker = config.limiterFor(RateLimitConfig.LOGIN_LIMITER, "203.0.113.9");
        RateLimiter operator = config.limiterFor(RateLimitConfig.LOGIN_LIMITER, "198.51.100.4");

        // The attacker burns the whole allowance…
        assertThat(attacker.acquirePermission()).isTrue();
        assertThat(attacker.acquirePermission()).isTrue();
        assertThat(attacker.acquirePermission()).isFalse();

        // …and the operator is unaffected. This is the regression that a shared
        // @RateLimiter(name = "authLogin") would reintroduce.
        assertThat(operator.acquirePermission()).isTrue();
    }

    @Test
    void returningClientKeepsItsCounter() {
        RateLimiter first = config.limiterFor(RateLimitConfig.LOGIN_LIMITER, "203.0.113.9");
        assertThat(first.acquirePermission()).isTrue();

        // A second lookup must return the same counter, not a fresh one — otherwise
        // every request would get a clean allowance and the limiter would never fire.
        RateLimiter second = config.limiterFor(RateLimitConfig.LOGIN_LIMITER, "203.0.113.9");
        assertThat(second.acquirePermission()).isTrue();
        assertThat(second.acquirePermission()).isFalse();
    }

    @Test
    void templatesAreIndependentPerEndpoint() {
        RateLimiter login = config.limiterFor(RateLimitConfig.LOGIN_LIMITER, "203.0.113.9");
        RateLimiter refresh = config.limiterFor(RateLimitConfig.REFRESH_LIMITER, "203.0.113.9");

        login.acquirePermission();
        login.acquirePermission();
        assertThat(login.acquirePermission()).isFalse();

        // Exhausting login must not throttle refresh: the console refreshes silently
        // every 15 minutes and must keep working after a failed sign-in attempt.
        assertThat(refresh.acquirePermission()).isTrue();
    }

    @Test
    void blankOrMissingClientFallsBackToTheSharedBucket() {
        assertThat(config.limiterFor(RateLimitConfig.LOGIN_LIMITER, null))
                .isNotNull();
        assertThat(config.limiterFor(RateLimitConfig.LOGIN_LIMITER, "  "))
                .isNotNull();
    }

    @Test
    void unknownLimiterNameIsRejected() {
        assertThatThrownBy(() -> config.limiterFor("notConfigured", "203.0.113.9"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void trustsThePeerAddressByDefault() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("192.0.2.10");
        // A forged header. It must be ignored while trust-forwarded-headers is off.
        request.addHeader("X-Forwarded-For", "1.2.3.4");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(config.clientKey()).isEqualTo("192.0.2.10");
    }

    @Test
    void honoursForwardedHeaderWhenExplicitlyTrusted() {
        MockEnvironment trusted = new MockEnvironment();
        trusted.setProperty("app.security.trust-forwarded-headers", "true");
        RateLimitConfig trusting = new RateLimitConfig(registry, trusted);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.1");
        request.addHeader("X-Forwarded-For", "1.2.3.4, 10.0.0.1");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        // Left-most entry is the original client.
        assertThat(trusting.clientKey()).isEqualTo("1.2.3.4");
    }

    @Test
    void noRequestContextUsesTheSharedBucketRatherThanAFreshKey() {
        assertThat(config.clientKey()).isEqualTo(RateLimitConfig.OVERFLOW_KEY);
    }
}
