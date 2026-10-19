package com.pstu.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body of {@code POST /api/v1/auth/register} — first-run bootstrap only.
 *
 * <p>There is deliberately <strong>no role field</strong>. This endpoint exists to
 * create the very first account, which is always an {@code ADMIN}; letting the
 * caller choose a role would turn a bootstrap convenience into privilege
 * escalation. Every later account is created by an admin through
 * {@code /api/v1/users}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RegisterRequest {

    @NotBlank(message = "Username is required")
    @Size(min = 3, max = 100, message = "Username must be between 3 and 100 characters")
    @Pattern(
            regexp = "^[A-Za-z0-9._-]+$",
            message = "Username may contain only letters, digits, dot, underscore and hyphen")
    private String username;

    @NotBlank(message = "Password is required")
    @Size(min = 8, max = 200, message = "Password must be between 8 and 200 characters")
    private String password;

    @NotBlank(message = "Display name is required")
    @Size(max = 150, message = "Display name must be at most 150 characters")
    private String displayName;
}