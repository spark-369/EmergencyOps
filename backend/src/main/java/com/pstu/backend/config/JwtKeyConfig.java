package com.pstu.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Symmetric (HMAC-SHA256) JWT signing and validation.
 *
 * <p>HMAC is the right choice for a single-service deployment: the same secret
 * signs and verifies, and there is no key-distribution problem to solve. If the
 * API is ever split across services, swap these beans for an RSA/EC key pair —
 * {@code TokenService} and the filter chain need no changes.
 *
 * <p><strong>Fail-closed.</strong> A missing or weak secret aborts startup rather
 * than falling back to a generated key: a random per-boot key would invalidate
 * every session on restart, and a hard-coded default would be a public secret.
 */
@Configuration
public class JwtKeyConfig {

    /** HS256 requires a key of at least 256 bits. */
    private static final int MIN_KEY_BYTES = 32;

    @Bean
    public SecretKey jwtSecretKey(JwtProperties properties) {
        String configured = properties.secret();
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException(
                    "app.jwt.secret is not set. Configure the JWT_SECRET environment variable "
                            + "with at least 32 bytes of random data, e.g. `openssl rand -base64 48`.");
        }

        byte[] keyBytes = decode(configured.trim());
        if (keyBytes.length < MIN_KEY_BYTES) {
            throw new IllegalStateException(
                    "JWT_SECRET must be at least " + MIN_KEY_BYTES + " bytes (it currently decodes "
                            + "to " + keyBytes.length + "). Generate one with `openssl rand -base64 48`.");
        }
        return new SecretKeySpec(keyBytes, "HmacSHA256");
    }

    /**
     * Accepts Base64 key material and falls back to the raw UTF-8 bytes, so both
     * {@code openssl rand -base64 48} output and a plain long passphrase work.
     */
    private static byte[] decode(String configured) {
        try {
            return Base64.getDecoder().decode(configured);
        } catch (IllegalArgumentException ignored) {
            return configured.getBytes(StandardCharsets.UTF_8);
        }
    }

    @Bean
    public JwtEncoder jwtEncoder(SecretKey jwtSecretKey) {
        return NimbusJwtEncoder.withSecretKey(jwtSecretKey)
                .algorithm(MacAlgorithm.HS256)
                .build();
    }

    @Bean
    public JwtDecoder jwtDecoder(SecretKey jwtSecretKey, JwtProperties properties) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(jwtSecretKey)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        // Rejects tokens minted by another deployment sharing the same secret,
        // and is required for a clean "token expired" distinction in the client.
        decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(properties.issuer()));
        return decoder;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}