package com.pstu.backend.controller;

import com.pstu.backend.config.RateLimitConfig;
import com.pstu.backend.dto.ChangePasswordRequest;
import com.pstu.backend.dto.LoginRequest;
import com.pstu.backend.dto.RefreshRequest;
import com.pstu.backend.dto.RegisterRequest;
import com.pstu.backend.dto.RegistrationStatusResponse;
import com.pstu.backend.dto.TokenResponse;
import com.pstu.backend.dto.UserResponse;
import com.pstu.backend.service.AuthService;
import io.github.resilience4j.ratelimiter.RequestNotPermitted;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Authentication endpoints.
 *
 * <p>The login endpoint takes the credential payload in the request body, never
 * in the URL: query strings and path segments end up in access logs, proxies and
 * browser history, which is an unacceptable place for a password.
 *
 * <p>{@code /login} and {@code /refresh} are the only unauthenticated routes in
 * the API (see {@code SecurityConfig}).
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;
    private final RateLimitConfig rateLimits;

    public AuthController(AuthService authService, RateLimitConfig rateLimits) {
        this.authService = authService;
        this.rateLimits = rateLimits;
    }

    /**
     * Enforces a per-client limit before the endpoint body runs.
     *
     * <p>This is deliberately a plain method call rather than
     * {@code @RateLimiter(name = ...)}. The annotation takes a fixed instance name
     * and therefore shares one counter across every caller, which is precisely the
     * failure mode {@link RateLimitConfig} documents: ten bad logins would block
     * the whole console. Asking the config for the <em>current client's</em>
     * limiter is the smallest expression of "per IP, not per endpoint".
     *
     * <p>{@code RequestNotPermitted} propagates to {@code GlobalExceptionHandler},
     * which renders the 429 envelope.
     */
    private void enforceLimit(String limiterName) {
        var limiter = rateLimits.forCurrentClient(limiterName);
        if (!limiter.acquirePermission()) {
            throw RequestNotPermitted.createRequestNotPermitted(limiter);
        }
    }

    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest request) {
        enforceLimit(RateLimitConfig.LOGIN_LIMITER);
        return ResponseEntity.ok(authService.login(request));
    }

    /**
     * Whether the first-run registration flow is still open.
     *
     * <p>Unauthenticated by necessity: the login screen must decide whether to
     * offer the "create the first administrator" link before anyone can sign in.
     */
    @GetMapping("/registration-status")
    public ResponseEntity<RegistrationStatusResponse> registrationStatus() {
        return ResponseEntity.ok(
                RegistrationStatusResponse.builder()
                        .registrationOpen(authService.isRegistrationOpen())
                        .build());
    }

    /**
     * Creates the first administrator. Works only while no account exists.
     *
     * <p>Answers 409 once any account is present, so this cannot be used as an
     * open registration endpoint after setup.
     */
    @PostMapping("/register")
    public ResponseEntity<UserResponse> register(@Valid @RequestBody RegisterRequest request) {
        enforceLimit(RateLimitConfig.REGISTER_LIMITER);
        return new ResponseEntity<>(
                authService.registerFirstAdmin(request), HttpStatus.CREATED);
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@Valid @RequestBody RefreshRequest request) {
        enforceLimit(RateLimitConfig.REFRESH_LIMITER);
        return ResponseEntity.ok(authService.refresh(request.getRefreshToken()));
    }

    /**
     * Revokes the presented refresh token. Deliberately does not require a valid
     * access token: a client whose access token just expired must still be able
     * to end its session.
     */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@RequestBody(required = false) RefreshRequest request) {
        if (request != null) {
            authService.logout(request.getRefreshToken());
        }
        return ResponseEntity.noContent().build();
    }

    /** Identity of the caller, resolved from validated JWT claims. */
    @GetMapping("/me")
    public ResponseEntity<UserResponse> me(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(authService.currentUser(jwt.getSubject()));
    }

    /**
     * Changes the caller's own password.
     *
     * <p>Authenticated (any role), but identified by the token — the request has no
     * way to target another account. All other sessions are revoked, so the client
     * must sign in again afterwards.
     */
    @PostMapping("/change-password")
    public ResponseEntity<Void> changePassword(@AuthenticationPrincipal Jwt jwt,
                                               @Valid @RequestBody ChangePasswordRequest request) {
        authService.changePassword(jwt.getSubject(), request);
        return ResponseEntity.noContent().build();
    }
}