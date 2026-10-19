package com.pstu.backend.dto;

import com.pstu.backend.enums.Role;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body of {@code PATCH /api/v1/users/{id}} (ADMIN only).
 *
 * <p>Every field is optional: {@code null} means "leave unchanged". A blank
 * {@code password} is rejected by validation rather than treated as a no-op, so
 * an empty submit cannot silently lock the account out.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserUpdateRequest {

    @Size(max = 150, message = "Display name must be at most 150 characters")
    private String displayName;

    @Size(min = 8, max = 200, message = "Password must be between 8 and 200 characters")
    private String password;

    private Role role;

    private Boolean enabled;
}