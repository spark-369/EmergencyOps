package com.pstu.backend.security;

import com.pstu.backend.config.JwtProperties;
import com.pstu.backend.entity.RefreshToken;
import com.pstu.backend.entity.User;
import com.pstu.backend.repository.RefreshTokenRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

/**
 * Mints and rotates tokens.
 *
 * <p>Claim layout consumed by the frontend and by
 * {@link com.pstu.backend.config.JwtAuthenticationConverter}:
 * <ul>
 *   <li>{@code sub}     — username (the principal identity)</li>
 *   <li>{@code uid}     — database id, so the UI can key records without a lookup</li>
 *   <li>{@code name}    — display name, shown in the shell</li>
 *   <li>{@code roles}   — list of {@code Role} names, mapped to {@code ROLE_*} authorities</li>
 *   <li>{@code iss}/{@code iat}/{@code exp}/{@code jti} — standard claims</li>
 * </ul>
 */
@Service
public class TokenService {

    private static final Logger log = LoggerFactory.getLogger(TokenService.class);

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int REFRESH_TOKEN_BYTES = 32;

    private final JwtEncoder jwtEncoder;
    private final RefreshTokenRepository refreshTokenRepository;
    private final JwtProperties properties;

    public TokenService(JwtEncoder jwtEncoder,
                        RefreshTokenRepository refreshTokenRepository,
                        JwtProperties properties) {
        this.jwtEncoder = jwtEncoder;
        this.refreshTokenRepository = refreshTokenRepository;
        this.properties = properties;
    }

    public long accessTokenTtlSeconds() {
        return properties.accessTokenTtl().toSeconds();
    }

    /**
     * Builds the signed access token for {@code user}.
     *
     * <p>The {@code alg} header is not set here: {@code NimbusJwtEncoder} was
     * configured with {@link org.springframework.security.oauth2.jose.jws.MacAlgorithm#HS256}
     * in {@code JwtKeyConfig}, and that decides the algorithm for every token it
     * produces. Passing a header explicitly would be redundant at best.
     *
     * <p>{@code roles} is always a list, even for a single role, so the decoder
     * side can read it with {@code getClaimAsStringList} unconditionally.
     *
     * <p>Deliberately not annotated: signing touches no database state, so it must
     * not start or suspend a transaction — {@link #rotate} calls it inside one.
     */
    public String createAccessToken(User user) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(properties.issuer())
                .issuedAt(now)
                .expiresAt(now.plus(properties.accessTokenTtl()))
                .subject(user.getUsername())
                .id(UUID.randomUUID().toString())
                .claim("uid", user.getId())
                .claim("name", user.getDisplayName())
                .claim("roles", List.of(user.getRole().name()))
                .build();
        return jwtEncoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();
    }

    /**
     * Issues an opaque refresh token and stores only its digest.
     *
     * <p>A random 256-bit value is used instead of a JWT: it carries no claims to
     * forge, and since it must be presented to the database anyway, a signed
     * token would add nothing.
     */
    @Transactional
    public String createRefreshToken(User user) {
        byte[] raw = new byte[REFRESH_TOKEN_BYTES];
        RANDOM.nextBytes(raw);
        String value = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);

        refreshTokenRepository.save(RefreshToken.builder()
                .tokenHash(hash(value))
                .user(user)
                .expiresAt(LocalDateTime.now().plus(properties.refreshTokenTtl()))
                .build());
        return value;
    }

    /**
     * Exchanges a refresh token for a new pair, rotating the old one.
     *
     * <p>An unknown, revoked or expired token yields {@code null} and the caller
     * answers 401 — the client then forces a fresh login.
     *
     * <p>Rotation order matters: the old row is revoked and flushed <em>before</em>
     * the replacement is issued, so a replayed token cannot be exchanged twice.
     * The unique index on {@code tokenHash} is the final backstop.
     */
    @Transactional
    public RefreshResult rotate(String presentedToken) {
        if (presentedToken == null || presentedToken.isBlank()) {
            return null;
        }

        // The client sends the opaque value; only its digest is stored, so the
        // lookup must hash the presented value the same way it was stored.
        String digest = hash(presentedToken);
        RefreshToken existing = refreshTokenRepository.findByTokenHash(digest).orElse(null);
        if (existing == null || !existing.isActive()) {
            return null;
        }

        User user = existing.getUser();
        if (!user.isEnabled()) {
            // A disabled account must not be able to extend its session. Logged at
            // debug: it is a normal outcome of an admin action, not an error.
            log.debug("Refresh rejected for disabled account id={}", user.getId());
            return null;
        }

        // Claim the token before issuing successors: if two requests race, the
        // second sees revoked = true and is rejected instead of minting a pair.
        existing.setRevoked(true);
        refreshTokenRepository.saveAndFlush(existing);

        return new RefreshResult(user, createAccessToken(user), createRefreshToken(user));
    }

    @Transactional
    public void revokeAll(User user) {
        // Bulk update: the JPQL statement bypasses the persistence context, so it
        // must be executed inside a writable transaction (hence the annotation).
        refreshTokenRepository.revokeAllForUser(user);
    }

    @Transactional
    public void revoke(String presentedToken) {
        if (presentedToken == null || presentedToken.isBlank()) {
            return;
        }
        refreshTokenRepository.findByTokenHash(hash(presentedToken)).ifPresent(token -> {
            token.setRevoked(true);
            refreshTokenRepository.save(token);
        });
    }

    /** SHA-256 hex digest; deterministic, so lookups stay a single indexed read. */
    static String hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            // SHA-256 is mandatory on every JVM.
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }

    /** Fresh credentials produced by {@link #rotate(String)}. */
    public record RefreshResult(User user, String accessToken, String refreshToken) {
    }
}