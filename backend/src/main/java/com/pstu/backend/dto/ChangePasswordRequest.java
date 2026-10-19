package com.pstu.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body of {@code POST /api/v1/auth/change-password}.
 *
 * <p>Requires the current password even though the caller already holds a valid
 * token: it prevents a stolen access token from being used to lock the real owner
 * out of their own account.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChangePasswordRequest {

    @NotBlank(message = "Current password is required")
    @Size(max = 200)
    private String currentPassword;

    @NotBlank(message = "New password is required")
    @Size(min = 8, max = 200, message = "New password must be between 8 and 200 characters")
    private String newPassword;
}