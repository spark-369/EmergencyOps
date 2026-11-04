package com.pstu.backend.service;

import com.pstu.backend.dto.UserRequest;
import com.pstu.backend.dto.UserUpdateRequest;
import com.pstu.backend.entity.User;
import com.pstu.backend.enums.Role;
import com.pstu.backend.exception.ResourceNotFoundException;
import com.pstu.backend.pipeline.EventEnvelope;
import com.pstu.backend.pipeline.EventPublisher;
import com.pstu.backend.repository.UserRepository;
import com.pstu.backend.security.TokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
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
 * User administration guards.
 *
 * <p>The rules here are what stop an operator locking everyone out: an admin cannot
 * delete their own account, and the last enabled {@code ADMIN} cannot be deleted or
 * disabled. Both were the kind of mistake that is only discovered when the platform is
 * already unusable, so they are asserted directly. Every change also publishes an
 * account fact for the audit consumer.
 */
class UserServiceTest {

    private UserRepository userRepository;
    private PasswordEncoder passwordEncoder;
    private TokenService tokenService;
    private EventPublisher eventPublisher;
    private UserService service;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        passwordEncoder = mock(PasswordEncoder.class);
        tokenService = mock(TokenService.class);
        eventPublisher = mock(EventPublisher.class);

        when(passwordEncoder.encode(anyString())).thenReturn("hashed");
        when(userRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service = new UserService(userRepository, passwordEncoder, tokenService, eventPublisher);
    }

    private static User admin(long id, String username) {
        return User.builder().id(id).username(username).displayName("Admin")
                .role(Role.ADMIN).enabled(true).passwordHash("hashed").build();
    }

    private EventEnvelope publishedEnvelope() {
        ArgumentCaptor<EventEnvelope> captor = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(eventPublisher).publish(captor.capture());
        return captor.getValue();
    }

    @Test
    void creatingAUserHashesThePasswordAndPublishesTheFact() {
        when(userRepository.existsByUsernameIgnoreCase("dana")).thenReturn(false);

        service.create(UserRequest.builder()
                .username("  dana  ").password("secret-pass").displayName(" Dana Ops ")
                .role(Role.DISPATCHER).build());

        verify(passwordEncoder).encode("secret-pass");
        EventEnvelope envelope = publishedEnvelope();
        assertThat(envelope.type().name()).isEqualTo("USER_CREATED");
        // Username is trimmed and used as the partition key so one account stays ordered.
        assertThat(envelope.partitionKey()).isEqualTo("dana");
        // No password material ever reaches the event log.
        assertThat(envelope.payload()).doesNotContainKey("passwordHash");
    }

    @Test
    void aDuplicateUsernameIsRejected() {
        when(userRepository.existsByUsernameIgnoreCase("dana")).thenReturn(true);

        assertThatThrownBy(() -> service.create(UserRequest.builder()
                .username("dana").password("secret-pass").displayName("Dana")
                .role(Role.DISPATCHER).build()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("already exists");
    }

    @Test
    void deletingYourOwnAccountIsRefused() {
        when(userRepository.findById(1L)).thenReturn(Optional.of(admin(1L, "root")));

        assertThatThrownBy(() -> service.delete(1L, "root"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("cannot delete your own account");
    }

    @Test
    void theLastEnabledAdminCannotBeDeleted() {
        User onlyAdmin = admin(1L, "root");
        when(userRepository.findById(1L)).thenReturn(Optional.of(onlyAdmin));
        when(userRepository.findAll()).thenReturn(List.of(onlyAdmin));

        assertThatThrownBy(() -> service.delete(1L, "someone-else"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("last enabled ADMIN");
    }

    @Test
    void anAdminCanBeDeletedWhenAnotherEnabledAdminRemains() {
        User target = admin(1L, "root");
        User backup = admin(2L, "ops");
        when(userRepository.findById(1L)).thenReturn(Optional.of(target));
        when(userRepository.findAll()).thenReturn(List.of(target, backup));

        service.delete(1L, "someone-else");

        verify(tokenService).revokeAll(target);
        // Published before the delete so the username is still known to the consumer.
        assertThat(publishedEnvelope().type().name()).isEqualTo("USER_DELETED");
        verify(userRepository).delete(target);
    }

    @Test
    void disablingTheLastAdminIsRefused() {
        User onlyAdmin = admin(1L, "root");
        when(userRepository.findById(1L)).thenReturn(Optional.of(onlyAdmin));
        when(userRepository.findAll()).thenReturn(List.of(onlyAdmin));

        assertThatThrownBy(() -> service.update(1L,
                UserUpdateRequest.builder().enabled(false).build()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("last enabled ADMIN");
    }

    @Test
    void aRoleChangeRevokesEveryRefreshTokenSoADemotionTakesEffect() {
        User user = User.builder().id(1L).username("dana").displayName("Dana")
                .role(Role.DISPATCHER).enabled(true).passwordHash("hashed").build();
        when(userRepository.findById(1L)).thenReturn(Optional.of(user));

        service.update(1L, UserUpdateRequest.builder().role(Role.VIEWER).build());

        assertThat(user.getRole()).isEqualTo(Role.VIEWER);
        verify(tokenService).revokeAll(user);
    }

    @Test
    void anUnknownUserIdIs404() {
        when(userRepository.findById(9L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.findById(9L))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("9");
        verify(userRepository, never()).delete(any());
    }
}
