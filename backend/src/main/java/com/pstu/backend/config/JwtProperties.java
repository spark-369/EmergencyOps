package com.pstu.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.Duration;

/**
 * JWT settings, bound from {@code app.jwt.*}.
 *
 * <p>{@code secret} must be at least 32 bytes (256 bits) because it keys the
 * HS256 MAC. It is supplied through the {@code JWT_SECRET} environment variable
 * and is never defaulted: {@code JwtKeyConfig} refuses to start without it.
 *
 * <p>{@code @DefaultValue} (not field initialisers) supplies the fallbacks:
 * constructor binding only honours the latter for absent parameters, and the
 * property file always passes a value through.
 *
 * @param secret          Base64-encoded HMAC-SHA256 key material.
 * @param issuer          {@code iss} claim, validated on every request.
 * @param accessTokenTtl  Access-token lifetime. Short by design — the client
 *                        refreshes silently, so a leaked token ages out fast.
 * @param refreshTokenTtl Refresh-token lifetime (rotated on each use).
 */
@ConfigurationProperties(prefix = "app.jwt")
public record JwtProperties(
        String secret,
        @DefaultValue("emergency-response-platform") String issuer,
        @DefaultValue("15m") Duration accessTokenTtl,
        @DefaultValue("7d") Duration refreshTokenTtl) {
}