package com.pstu.backend.config;

import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * The one named Resilience4j object the application injects.
 *
 * <p>Not applied by AOP: {@code RoutingService} takes the {@link CircuitBreaker}
 * as a constructor argument, so the latency budget is visible where it is enforced.
 */
@Configuration
public class ResilienceConfig {

    /**
     * Breaker guarding the road-network query used to compute ETAs.
     *
     * <p>Named instance rather than an annotation: {@code RoutingService} also has
     * a geometric fallback in {@code OptimizationService}, so the breaker only has
     * to stop hammering a failing database, not mask the failure. Routing runs once
     * per incident per optimisation pass, and a stale graph is better than a slow
     * response.
     */
    @Bean
    public CircuitBreaker routingCircuitBreaker() {
        CircuitBreakerConfig config = CircuitBreakerConfig.custom()
                .failureRateThreshold(50)
                .slowCallRateThreshold(60)
                .slowCallDurationThreshold(Duration.ofSeconds(2))
                .waitDurationInOpenState(Duration.ofSeconds(20))
                .slidingWindowSize(20)
                .minimumNumberOfCalls(10)
                .permittedNumberOfCallsInHalfOpenState(3)
                .build();
        return CircuitBreaker.of("routing", config);
    }
}