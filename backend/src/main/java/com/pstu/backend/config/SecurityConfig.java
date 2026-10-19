package com.pstu.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Stateless JWT security.
 *
 * <p>Access tokens arrive as {@code Authorization: Bearer <jwt>}; Spring Security's
 * resource-server support validates the signature, {@code iss} and {@code exp}, and
 * {@link JwtAuthenticationConverter} turns the {@code roles} claim into
 * {@code ROLE_*} authorities.
 *
 * <p>No {@code httpBasic()}, no form login, no CSRF token and no HTTP session: the
 * API is header-authenticated and stateless, so there is no ambient credential a
 * CSRF attack could ride on. {@code @EnableMethodSecurity} activates the
 * per-controller {@code @PreAuthorize} guards.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    /** Only these may be called without a token. */
    private static final String[] PUBLIC_ENDPOINTS = {
            "/api/v1/auth/login",
            "/api/v1/auth/refresh",
            "/api/v1/auth/logout",
            // First-run bootstrap. Safe to leave public: both endpoints check that
            // no account exists yet and stop working immediately afterwards.
            "/api/v1/auth/register",
            "/api/v1/auth/registration-status"
    };

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            Environment environment,
            @Value("${management.endpoints.web.base-path:/actuator}") String actuatorBasePath)
            throws Exception {
        // Constructed here rather than injected: see the class comment on
        // JwtAuthenticationConverter for why it must not be a bean (a bean of type
        // Converter is auto-registered with the global conversion service, which
        // rejects it and aborts startup).
        Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter =
                new JwtAuthenticationConverter();

        http
            .cors(Customizer.withDefaults())
            .csrf(csrf -> csrf.disable())
            .httpBasic(httpBasic -> httpBasic.disable())
            .formLogin(formLogin -> formLogin.disable())
            .logout(logout -> logout.disable())
            .headers(headers -> headers.frameOptions(frameOptions -> frameOptions.deny()))
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // Pre-flight requests never carry credentials.
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers(PUBLIC_ENDPOINTS).permitAll()
                .requestMatchers(
                        "/api/v1/health",
                        actuatorBasePath + "/health",
                        actuatorBasePath + "/health/**",
                        actuatorBasePath + "/info",
                        // Metrics are unauthenticated only when explicitly enabled
                        // (see `app.security.public-actuator-metrics`).
                        actuatorBasePath + "/prometheus").access(new PublicMetricsAccess(environment))
                // Everything else: any valid token. Per-endpoint role checks are
                // applied by @PreAuthorize on the controllers.
                .anyRequest().authenticated())
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter))
                .authenticationEntryPoint((request, response, authException) ->
                        writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized",
                                "Authentication required. Provide a valid Bearer access token."))
                .accessDeniedHandler((request, response, accessDeniedException) ->
                        writeError(response, HttpServletResponse.SC_FORBIDDEN, "Forbidden",
                                "Your role does not permit this action.")));
        return http.build();
    }

    /**
     * Writes the same JSON envelope as {@code GlobalExceptionHandler}, so the
     * frontend has one error shape to normalise.
     *
     * <p>Exceptions raised by the resource-server filters never reach a
     * {@code @ControllerAdvice}, so the body has to be produced here. Without it
     * Spring returns an empty 401/403 and the UI can only show a bare status.
     */
    private void writeError(HttpServletResponse response, int status, String error, String message)
            throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", System.currentTimeMillis());
        body.put("status", status);
        body.put("error", error);
        body.put("message", message);

        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        if (status == HttpServletResponse.SC_UNAUTHORIZED) {
            // Tells RFC-compliant clients that a Bearer token is expected.
            response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        }
        response.getWriter().write(objectMapper.writeValueAsString(body));
    }

    /**
     * Only exposes {@code /actuator/prometheus} publicly when explicitly opted in
     * via {@code app.security.public-actuator-metrics=true}. Metrics can disclose
     * internal hostnames and timings, so the default is authenticated-only.
     */
    static final class PublicMetricsAccess implements AuthorizationManager<RequestAuthorizationContext> {

        private final boolean expose;

        PublicMetricsAccess(Environment environment) {
            this.expose = Boolean.parseBoolean(
                    environment.getProperty("app.security.public-actuator-metrics", "false"));
        }

        @Override
        public AuthorizationDecision authorize(
                Supplier<? extends Authentication> authentication, RequestAuthorizationContext context) {
            if (expose) {
                return new AuthorizationDecision(true);
            }
            Authentication current = authentication.get();
            return new AuthorizationDecision(current != null && current.isAuthenticated());
        }
    }
}
