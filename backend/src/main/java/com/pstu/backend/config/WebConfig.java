package com.pstu.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;
import java.util.List;

/**
 * CORS policy for the browser console.
 *
 * <p>Allowed origins are configuration-driven ({@code app.cors.allowed-origins},
 * a comma-separated list) and matched <strong>exactly</strong> via
 * {@code setAllowedOrigins}.
 *
 * <p>This class previously used {@code setAllowedOriginPatterns}. Patterns exist
 * to support wildcards, and a pattern list is far easier to get catastrophically
 * wrong: a single {@code *} entry — or a value like {@code https://*} that reads
 * like a hostname but is a wildcard — matches every origin while still looking
 * like configuration. Since the allowed origins are a fixed, known set, exact
 * matching is both sufficient and unsurprising.
 *
 * <p>There is no wildcard escape hatch. A literal {@code *} in the property is
 * rejected at startup rather than silently disabling the same-origin policy:
 * the API authenticates with a bearer token, so a wildcard origin would let any
 * website drive it on behalf of a signed-in operator.
 *
 * <p>Credentials stay disabled — the browser never sends cookies here.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final List<String> allowedOrigins;
    private final List<String> allowedMethods;

    public WebConfig(
            @Value("${app.cors.allowed-origins:http://localhost:3000}") String allowedOrigins,
            @Value("${app.cors.allowed-methods:GET,POST,PUT,PATCH,DELETE,OPTIONS}") String allowedMethods) {
        this.allowedOrigins = splitAndTrim(allowedOrigins);
        this.allowedMethods = splitAndTrim(allowedMethods);
        requireNoWildcard(this.allowedOrigins);
    }

    /**
     * Rejects a wildcard origin at startup.
     *
     * <p>Failing here is deliberate: the alternative is a deployment that boots
     * cleanly and is silently open to every origin. A misconfiguration that is
     * only visible in a pre-flight response is one nobody ever finds.
     */
    private static void requireNoWildcard(List<String> origins) {
        for (String origin : origins) {
            if (origin.contains("*")) {
                throw new IllegalStateException(
                        "app.cors.allowed-origins must list exact origins; '" + origin
                                + "' contains a wildcard. List each deployed frontend origin "
                                + "explicitly (e.g. https://ops.example.com).");
            }
        }
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        CorsConfiguration configuration = corsConfiguration();
        registry.addMapping("/**")
                .allowedOrigins(allowedOrigins.toArray(String[]::new))
                .allowedMethods(allowedMethods.toArray(String[]::new))
                .allowedHeaders(configuration.getAllowedHeaders().toArray(String[]::new))
                .exposedHeaders(configuration.getExposedHeaders().toArray(String[]::new))
                .allowCredentials(Boolean.TRUE.equals(configuration.getAllowCredentials()))
                .maxAge(3600);
    }

    /**
     * The same policy is registered as a {@link CorsConfigurationSource} so that
     * Spring Security's `cors(withDefaults())` applies it before the security
     * filter chain. Without it, a rejected pre-flight request is reported to the
     * browser as a CORS error instead of the real 401.
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", corsConfiguration());
        return source;
    }

    private CorsConfiguration corsConfiguration() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(allowedOrigins);
        configuration.setAllowedMethods(allowedMethods);
        configuration.setAllowedHeaders(List.of(
                "Authorization", "Content-Type", "Accept", "Origin",
                "X-Requested-With", "X-Correlation-Id"));
        configuration.setExposedHeaders(List.of("Location", "Retry-After", "X-Correlation-Id"));
        // The API uses a request header for auth, not cookies. Enabling
        // credentials would additionally make the wildcard origin illegal.
        configuration.setAllowCredentials(false);
        return configuration;
    }

    private static List<String> splitAndTrim(String raw) {
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .toList();
    }
}
