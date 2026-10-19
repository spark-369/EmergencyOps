package com.pstu.backend.service;

import com.pstu.backend.dto.UserRequest;
import com.pstu.backend.dto.UserResponse;
import com.pstu.backend.dto.UserUpdateRequest;
import com.pstu.backend.entity.User;
import com.pstu.backend.enums.Role;
import com.pstu.backend.exception.ResourceNotFoundException;
import com.pstu.backend.pipeline.CorrelationIdFilter;
import com.pstu.backend.pipeline.DomainEventType;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.UserRepository;
import com.pstu.backend.security.TokenService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * User administration. Every endpoint here is {@code ADMIN}-only.
 *
 * <p>Account changes are also published as facts
 * ({@code USER_CREATED} / {@code USER_DELETED}) so an audit or SIEM consumer can
 * see access changes on the same bus as operational events, keyed by username so
 * the history of one account stays ordered.
 */
@Service
@Transactional
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokenService;
    private final EventPublisher eventPublisher;

    public UserService(UserRepository userRepository,
                       PasswordEncoder passwordEncoder,
                       TokenService tokenService,
                       EventPublisher eventPublisher) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
        this.eventPublisher = eventPublisher;
    }

    @Transactional(readOnly = true)
    public List<UserResponse> findAll() {
        return userRepository.findAll().stream().map(UserResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public UserResponse findById(Long id) {
        return UserResponse.from(require(id));
    }

    public UserResponse create(UserRequest request) {
        String username = request.getUsername().trim();
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            // 409 via GlobalExceptionHandler, matching existing duplicate handling.
            throw new IllegalStateException("Username '" + username + "' already exists");
        }
        User saved = userRepository.save(User.builder()
                .username(username)
                .passwordHash(passwordEncoder.encode(request.getPassword()))
                .displayName(request.getDisplayName().trim())
                .role(request.getRole())
                .enabled(!Boolean.FALSE.equals(request.getEnabled()))
                .build());
        publishAccount(DomainEventType.USER_CREATED, saved);
        return UserResponse.from(saved);
    }

    /**
     * Partial update. A role change or a disable revokes every refresh token, so
     * a demotion takes effect at the next refresh rather than lingering for the
     * full refresh-token lifetime.
     */
    public UserResponse update(Long id, UserUpdateRequest request) {
        User user = require(id);

        if (request.getDisplayName() != null && !request.getDisplayName().isBlank()) {
            user.setDisplayName(request.getDisplayName().trim());
        }
        if (request.getPassword() != null && !request.getPassword().isBlank()) {
            user.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        }

        boolean roleChanged = request.getRole() != null && request.getRole() != user.getRole();
        if (roleChanged) {
            user.setRole(request.getRole());
        }
        boolean disabled = request.getEnabled() != null && !request.getEnabled();
        if (request.getEnabled() != null) {
            user.setEnabled(request.getEnabled());
        }

        if (disabled) {
            // Refuse to remove the last way back in.
            ensureAnotherEnabledAdminExists(user, "disable this account");
        }

        User saved = userRepository.save(user);
        if (roleChanged || disabled) {
            tokenService.revokeAll(saved);
        }
        return UserResponse.from(saved);
    }

    public void delete(Long id, String actingUsername) {
        User user = require(id);
        if (user.getUsername().equalsIgnoreCase(actingUsername)) {
            throw new IllegalStateException("You cannot delete your own account");
        }
        ensureAnotherEnabledAdminExists(user, "delete this account");
        tokenService.revokeAll(user);
        // Published before the delete: the row (and so the username and role)
        // is gone once the transaction commits.
        publishAccount(DomainEventType.USER_DELETED, user);
        userRepository.delete(user);
    }

    /**
     * Publishes an account fact. No password material is included — the event
     * lands in a broker log that outlives the account, so it carries identity and
     * role only.
     */
    private void publishAccount(DomainEventType type, User user) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("username", user.getUsername());
        payload.put("displayName", user.getDisplayName());
        payload.put("role", user.getRole() == null ? null : user.getRole().name());
        payload.put("enabled", user.isEnabled());

        eventPublisher.publish(EventEnvelope.of(
                type.name(),
                user.getUsername(),
                user.getUsername(),
                payload,
                CorrelationIdFilter.currentOrRandom()));
    }

    private User require(Long id) {
        return userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User " + id + " does not exist"));
    }

    /**
     * Prevents an action that would leave zero enabled administrators, which
     * would permanently lock everyone out of user management.
     */
    private void ensureAnotherEnabledAdminExists(User candidate, String action) {
        if (candidate.getRole() != Role.ADMIN) {
            return;
        }
        long enabledAdmins = userRepository.findAll().stream()
                .filter(u -> u.getRole() == Role.ADMIN && u.isEnabled())
                .filter(u -> !u.getId().equals(candidate.getId()))
                .count();
        if (enabledAdmins == 0) {
            throw new IllegalStateException("Cannot " + action + ": it is the last enabled ADMIN");
        }
    }
}