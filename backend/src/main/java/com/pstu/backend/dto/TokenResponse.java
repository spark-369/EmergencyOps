package com.pstu.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Issued token pair.
 *
 * <p>{@code expiresIn} is seconds until {@code accessToken} expiry, so the client
 * can refresh proactively instead of waiting for a 401.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TokenResponse {

    private String accessToken;

    private String refreshToken;

    /** Always {@code Bearer}. */
    private String tokenType;

    /** Access-token lifetime in seconds. */
    private long expiresIn;

    private UserResponse user;

    public static TokenResponse of(String accessToken, String refreshToken, long expiresIn,
                                   UserResponse user) {
        return TokenResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken)
                .tokenType("Bearer")
                .expiresIn(expiresIn)
                .user(user)
                .build();
    }
}