package com.pstu.backend.service;

import com.pstu.backend.dto.ChangePasswordRequest;
import com.pstu.backend.dto.LoginRequest;
import com.pstu.backend.dto.RegisterRequest;
import com.pstu.backend.dto.TokenResponse;
import com.pstu.backend.dto.UserResponse;
import com.pstu.backend.entity.User;
import com.pstu.backend.enums.Role;
import com.pstu.backend.pipeline.CorrelationIdFilter;
import com.pstu.backend.pipeline.DomainEventType;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.UserRepository;
import com.pstu.backend.security.TokenService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Login, token refresh and logout.
 *
 * <p>Kept separate from {@link UserService} (administration) so the credential
 * verification path — the security-critical one — is small and auditable.
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokenService;
    private final EventPublisher eventPublisher;

    public AuthService(UserRepository userRepository,
                       PasswordEncoder passwordEncoder,
                       TokenService tokenService,
                       EventPublisher eventPublisher) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
        this.eventPublisher = eventPublisher;
    }

    /**
     * Verifies credentials and issues a token pair.
     *
     * <p>Unknown usernames and wrong passwords raise the same
     * {@link BadCredentialsException}: a distinct "user not found" reply would let
     * an attacker enumerate valid accounts.
     *
     * <p>The encoder still runs for unknown users to keep the response time
     * comparable, so timing does not reveal whether the account exists.
     */
    @Transactional
    public TokenResponse login(LoginRequest request) {
        String username = request.getUsername() == null ? "" : request.getUsername().trim();
        char[] rawPassword = request.getPassword() == null
                ? new char[0]
                : request.getPassword().toCharArray();

        User user = userRepository.findByUsernameIgnoreCase(username).orElse(null);
        if (user == null) {
            passwordEncoder.matches(new String(rawPassword), DUMMY_HASH);
            throw new BadCredentialsException("Invalid username or password");
        }
        if (!passwordEncoder.matches(new String(rawPassword), user.getPasswordHash())) {
            throw new BadCredentialsException("Invalid username or password");
        }
        if (!user.isEnabled()) {
            throw new BadCredentialsException("This account is disabled");
        }

        user.setLastLoginAt(LocalDateTime.now());
        userRepository.save(user);

        return issue(user);
    }

    /**
     * Exchanges a refresh token for a new pair (rotating it).
     *
     * @throws BadCredentialsException when the token is unknown, revoked, expired
     *                                or belongs to a disabled account.
     */
    @Transactional
    public TokenResponse refresh(String refreshToken) {
        TokenService.RefreshResult rotated = tokenService.rotate(refreshToken);
        if (rotated == null) {
            throw new BadCredentialsException("Refresh token is invalid or has expired");
        }
        return TokenResponse.of(
                rotated.accessToken(),
                rotated.refreshToken(),
                tokenService.accessTokenTtlSeconds(),
                UserResponse.from(rotated.user()));
    }

    /** Client-initiated logout: the presented refresh token is revoked. */
    @Transactional
    public void logout(String refreshToken) {
        tokenService.revoke(refreshToken);
    }

    public UserResponse currentUser(String username) {
        return userRepository.findByUsernameIgnoreCase(username)
                .map(UserResponse::from)
                .orElseThrow(() -> new BadCredentialsException("Account no longer exists"));
    }

    /**
     * Changes the caller's own password.
     *
     * <p>The current password is re-verified, so possessing a token is not enough
     * to take over the account. Every other refresh token is then revoked: if the
     * password was changed because it leaked, any session opened with the old one
     * must die with it.
     *
     * @throws BadCredentialsException when the current password is wrong, or the
     *                                account no longer exists.
     */
    @Transactional
    public void changePassword(String username, ChangePasswordRequest request) {
        User user = userRepository.findByUsernameIgnoreCase(username)
                .orElseThrow(() -> new BadCredentialsException("Account no longer exists"));

        if (!passwordEncoder.matches(request.getCurrentPassword(), user.getPasswordHash())) {
            // Same generic message as a failed login: never reveal which part failed.
            throw new BadCredentialsException("Current password is incorrect");
        }

        user.setPasswordHash(passwordEncoder.encode(request.getNewPassword()));
        userRepository.save(user);

        tokenService.revokeAll(user);
    }

    /** True while no account exists, i.e. the first-run bootstrap is still open. */
    @Transactional(readOnly = true)
    public boolean isRegistrationOpen() {
        return userRepository.count() == 0;
    }

    /**
     * Creates the first administrator, then permanently closes registration.
     *
     * <p><strong>One-shot by construction.</strong> The emptiness check and the
     * insert share a transaction, and the method is {@code synchronized} so two
     * concurrent requests cannot both observe an empty table and each create an
     * admin. The window is a handful of requests during initial setup, so the
     * cost of serialising it is nil.
     *
     * <p>Always {@link Role#ADMIN}: this path exists to bootstrap the system, not
     * to add members. Afterwards the account is indistinguishable from any other,
     * and every further user is created through {@code /api/v1/users}.
     *
     * @throws IllegalStateException when registration is already closed, which the
     *                              controller surfaces as 409 Conflict.
     */
    @Transactional
    public synchronized UserResponse registerFirstAdmin(RegisterRequest request) {
        if (userRepository.count() > 0) {
            throw new IllegalStateException(
                    "Registration is closed: an account already exists. "
                            + "Ask an administrator to create your account.");
        }

        String username = request.getUsername().trim();
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            // Unreachable while the table is empty, but kept so the invariant does
            // not depend on callers being first.
            throw new IllegalStateException("Username '" + username + "' already exists");
        }

        User admin = userRepository.save(User.builder()
                .username(username)
                .passwordHash(passwordEncoder.encode(request.getPassword()))
                .displayName(request.getDisplayName().trim())
                .role(Role.ADMIN)
                .enabled(true)
                .build());

        log.info("First administrator '{}' registered; open registration is now closed.",
                admin.getUsername());

        // The bootstrap path writes the user directly (it runs before any account
        // exists), so it must publish the fact itself — otherwise an audit consumer
        // would see every account except the first one.
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("username", admin.getUsername());
        payload.put("displayName", admin.getDisplayName());
        payload.put("role", admin.getRole() == null ? null : admin.getRole().name());
        payload.put("enabled", admin.isEnabled());
        payload.put("bootstrap", true);
        eventPublisher.publish(EventEnvelope.of(
                DomainEventType.USER_CREATED.name(),
                admin.getUsername(),
                admin.getUsername(),
                payload,
                CorrelationIdFilter.currentOrRandom()));

        return UserResponse.from(admin);
    }

    private TokenResponse issue(User user) {
        return TokenResponse.of(
                tokenService.createAccessToken(user),
                tokenService.createRefreshToken(user),
                tokenService.accessTokenTtlSeconds(),
                UserResponse.from(user));
    }

    /**
     * A BCrypt hash of a value no request can produce. Verifying against it when
     * the user is missing keeps the failure path as expensive as the success
     * path, which removes the account-enumeration timing signal.
     */
    private static final String DUMMY_HASH =
            "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
}