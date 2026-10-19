package com.pstu.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Public readiness probe for the first-run registration flow.
 *
 * <p>Returned by {@code GET /api/v1/auth/registration-status}. It is unauthenticated
 * by necessity — the login page needs it before anyone can sign in — so it
 * discloses only whether any account exists, which is already inferable from the
 * login form answering "invalid credentials" for every input.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RegistrationStatusResponse {

    /**
     * True only while the user table is empty. The client uses it to show or hide
     * the "create the first administrator" link; the server enforces the same rule
     * inside {@code AuthService.registerFirstAdmin}.
     */
    private boolean registrationOpen;
}