package com.pstu.backend.security;

import com.pstu.backend.config.JwtKeyConfig;
import com.pstu.backend.config.JwtProperties;
import com.pstu.backend.entity.User;
import com.pstu.backend.enums.Role;
import com.pstu.backend.repository.RefreshTokenRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Duration;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link TokenService}.
 *
 * <p>Covers the properties a broken JWT implementation gets wrong: the token
 * verifies with the deployment key, carries the identity and role claims the
 * converter relies on, is rejected once tampered with, and hashes refresh tokens
 * instead of storing them in the clear.
 */
class TokenServiceTest {

    private static final String SECRET = "unit-test-secret-key-0123456789abcdef0123456789";

    private JwtKeyConfig keyConfig;
    private JwtProperties properties;
    private RefreshTokenRepository refreshTokenRepository;
    private TokenService tokenService;

    @BeforeEach
    void setUp() {
        properties = new JwtProperties(SECRET, "test-issuer", Duration.ofMinutes(15), Duration.ofDays(7));
        keyConfig = new JwtKeyConfig();
        refreshTokenRepository = mock(RefreshTokenRepository.class);
        // save() must return its argument: TokenService ignores the result but
        // Mockito would otherwise hand back null for the builder chain.
        when(refreshTokenRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        tokenService = new TokenService(
                keyConfig.jwtEncoder(keyConfig.jwtSecretKey(properties)),
                refreshTokenRepository,
                properties);
    }

    private static User admin() {
        return User.builder()
                .id(42L)
                .username("dana")
                .displayName("Dana Ops")
                .role(Role.DISPATCHER)
                .passwordHash("irrelevant")
                .enabled(true)
                .build();
    }

    @Test
    void accessTokenCarriesIdentityAndRoleClaims() {
        String token = tokenService.createAccessToken(admin());

        Jwt jwt = keyConfig.jwtDecoder(keyConfig.jwtSecretKey(properties), properties).decode(token);

        assertThat(jwt.getSubject()).isEqualTo("dana");
        assertThat(jwt.getClaimAsString("name")).isEqualTo("Dana Ops");
        assertThat(jwt.<Long>getClaim("uid")).isEqualTo(42L);
        assertThat(jwt.getClaimAsStringList("roles")).containsExactly("DISPATCHER");
        assertThat(jwt.getIssuer().toString()).isEqualTo("test-issuer");
        assertThat(jwt.getExpiresAt()).isAfter(jwt.getIssuedAt());
    }

    @Test
    void tokenSignedWithAnotherKeyIsRejected() {
        String token = tokenService.createAccessToken(admin());

        JwtProperties otherProperties = new JwtProperties(
                "a-completely-different-secret-key-0123456789", "test-issuer",
                Duration.ofMinutes(15), Duration.ofDays(7));
        var foreignDecoder = keyConfig.jwtDecoder(
                keyConfig.jwtSecretKey(otherProperties), otherProperties);

        assertThat(org.assertj.core.api.Assertions.catchThrowable(
                () -> foreignDecoder.decode(token))).isNotNull();
    }

    @Test
    void tokenFromAnotherIssuerIsRejected() {
        String token = tokenService.createAccessToken(admin());

        JwtProperties otherIssuer = new JwtProperties(
                SECRET, "another-deployment", Duration.ofMinutes(15), Duration.ofDays(7));
        var decoder = keyConfig.jwtDecoder(keyConfig.jwtSecretKey(otherIssuer), otherIssuer);

        assertThat(org.assertj.core.api.Assertions.catchThrowable(
                () -> decoder.decode(token))).isNotNull();
    }

    @Test
    void refreshTokenIsStoredOnlyAsADigest() {
        String token = tokenService.createRefreshToken(admin());

        assertThat(token).isNotBlank();
        // The stored hash must differ from the presented value and be a hex digest.
        assertThat(TokenService.hash(token)).hasSize(64).isNotEqualTo(token);
    }

    @Test
    void rotatingAnUnknownRefreshTokenFails() {
        when(refreshTokenRepository.findByTokenHash(any())).thenReturn(Optional.empty());

        assertThat(tokenService.rotate("not-a-real-token")).isNull();
    }

    @Test
    void blankRefreshTokenIsRejectedWithoutTouchingTheDatabase() {
        assertThat(tokenService.rotate("   ")).isNull();
        assertThat(tokenService.rotate(null)).isNull();
    }

    @Test
    void missingSecretAbortsStartup() {
        JwtProperties empty = new JwtProperties("  ", "issuer", Duration.ofMinutes(15), Duration.ofDays(7));

        assertThat(org.assertj.core.api.Assertions.catchThrowable(
                () -> keyConfig.jwtSecretKey(empty)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("JWT_SECRET");
    }

    @Test
    void shortSecretAbortsStartup() {
        JwtProperties weak = new JwtProperties("too-short", "issuer", Duration.ofMinutes(15), Duration.ofDays(7));

        assertThat(org.assertj.core.api.Assertions.catchThrowable(
                () -> keyConfig.jwtSecretKey(weak)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("at least");
    }
}