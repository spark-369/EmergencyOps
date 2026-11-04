package com.pstu.backend.service;

import com.pstu.backend.dto.ChangePasswordRequest;
import com.pstu.backend.dto.LoginRequest;
import com.pstu.backend.dto.RegisterRequest;
import com.pstu.backend.dto.TokenResponse;
import com.pstu.backend.dto.UserResponse;
import com.pstu.backend.entity.User;
import com.pstu.backend.enums.Role;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.UserRepository;
import com.pstu.backend.security.TokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Credential verification, refresh and the one-shot bootstrap.
 *
 * <p>The security-critical property is account-enumeration resistance: an unknown
 * username and a wrong password must produce the same {@link BadCredentialsException},
 * and the password encoder must still run for an unknown user so the two paths take a
 * comparable amount of time. The bootstrap must create an {@code ADMIN} exactly once.
 */
class AuthServiceTest {

    private UserRepository userRepository;
    private PasswordEncoder passwordEncoder;
    private TokenService tokenService;
    private EventPublisher eventPublisher;
    private AuthService service;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        passwordEncoder = mock(PasswordEncoder.class);
        tokenService = mock(TokenService.class);
        eventPublisher = mock(EventPublisher.class);

        when(userRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service = new AuthService(userRepository, passwordEncoder, tokenService, eventPublisher);
    }

    private static User user(boolean enabled) {
        return User.builder().id(1L).username("dana").displayName("Dana")
                .role(Role.DISPATCHER).enabled(enabled).passwordHash("hashed").build();
    }

    private static LoginRequest login(String username, String password) {
        return LoginRequest.builder().username(username).password(password).build();
    }

    @Test
    void validCredentialsIssueATokenPair() {
        when(userRepository.findByUsernameIgnoreCase("dana")).thenReturn(Optional.of(user(true)));
        when(passwordEncoder.matches("secret-pass", "hashed")).thenReturn(true);
        when(tokenService.createAccessToken(any())).thenReturn("access-token");
        when(tokenService.createRefreshToken(any())).thenReturn("refresh-token");
        when(tokenService.accessTokenTtlSeconds()).thenReturn(900L);

        TokenResponse response = service.login(login("dana", "secret-pass"));

        assertThat(response.getAccessToken()).isEqualTo("access-token");
        assertThat(response.getRefreshToken()).isEqualTo("refresh-token");
        assertThat(response.getTokenType()).isEqualTo("Bearer");
        assertThat(response.getExpiresIn()).isEqualTo(900L);
    }

    @Test
    void anUnknownUsernameFailsLikeAWrongPasswordAndStillRunsTheEncoder() {
        when(userRepository.findByUsernameIgnoreCase("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.login(login("ghost", "secret-pass")))
                .isInstanceOf(BadCredentialsException.class)
                .hasMessage("Invalid username or password");

        // The dummy-hash comparison keeps the timing comparable: no enumeration signal.
        verify(passwordEncoder).matches(anyString(), anyString());
    }

    @Test
    void aWrongPasswordIsRejected() {
        when(userRepository.findByUsernameIgnoreCase("dana")).thenReturn(Optional.of(user(true)));
        when(passwordEncoder.matches("wrong", "hashed")).thenReturn(false);

        assertThatThrownBy(() -> service.login(login("dana", "wrong")))
                .isInstanceOf(BadCredentialsException.class)
                .hasMessage("Invalid username or password");
    }

    @Test
    void aDisabledAccountIsRejectedEvenWithTheRightPassword() {
        when(userRepository.findByUsernameIgnoreCase("dana")).thenReturn(Optional.of(user(false)));
        when(passwordEncoder.matches("secret-pass", "hashed")).thenReturn(true);

        assertThatThrownBy(() -> service.login(login("dana", "secret-pass")))
                .isInstanceOf(BadCredentialsException.class)
                .hasMessage("This account is disabled");
    }

    @Test
    void anInvalidRefreshTokenIs401() {
        when(tokenService.rotate("stale")).thenReturn(null);

        assertThatThrownBy(() -> service.refresh("stale"))
                .isInstanceOf(BadCredentialsException.class)
                .hasMessageContaining("Refresh token is invalid");
    }

    @Test
    void changingAPasswordReVerifiesTheCurrentOneAndRevokesEverySession() {
        when(userRepository.findByUsernameIgnoreCase("dana")).thenReturn(Optional.of(user(true)));
        when(passwordEncoder.matches("old-pass", "hashed")).thenReturn(true);

        service.changePassword("dana", ChangePasswordRequest.builder()
                .currentPassword("old-pass").newPassword("brand-new-pass").build());

        verify(passwordEncoder).encode("brand-new-pass");
        verify(tokenService).revokeAll(any());
    }

    @Test
    void changingAPasswordWithTheWrongCurrentOneIsRejected() {
        when(userRepository.findByUsernameIgnoreCase("dana")).thenReturn(Optional.of(user(true)));
        when(passwordEncoder.matches("wrong", "hashed")).thenReturn(false);

        assertThatThrownBy(() -> service.changePassword("dana", ChangePasswordRequest.builder()
                .currentPassword("wrong").newPassword("brand-new-pass").build()))
                .isInstanceOf(BadCredentialsException.class)
                .hasMessage("Current password is incorrect");

        verify(tokenService, never()).revokeAll(any());
    }

    @Test
    void theFirstAdminBootstrapCreatesAnAdminAndClosesRegistration() {
        // Empty before the insert, one row after: that is what "registration is now
        // closed" actually observes.
        when(userRepository.count()).thenReturn(0L, 1L);
        when(userRepository.existsByUsernameIgnoreCase("root")).thenReturn(false);

        UserResponse response = service.registerFirstAdmin(RegisterRequest.builder()
                .username("root").password("secret-pass").displayName("Root Admin").build());

        // Always ADMIN: the bootstrap path is not a role-selection surface.
        assertThat(response.getRole()).isEqualTo(Role.ADMIN);
        assertThat(service.isRegistrationOpen()).isFalse();

        ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(eventPublisher).publish(captor.capture());
        assertThat(captor.getValue().type().name()).isEqualTo("USER_CREATED");
        assertThat(captor.getValue().payload()).containsEntry("bootstrap", true);
    }

    @Test
    void theBootstrapIsRefusedOnceAnAccountExists() {
        when(userRepository.count()).thenReturn(1L);

        assertThatThrownBy(() -> service.registerFirstAdmin(RegisterRequest.builder()
                .username("root").password("secret-pass").displayName("Root").build()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Registration is closed");

        verify(eventPublisher, never()).publish(any());
    }
}
