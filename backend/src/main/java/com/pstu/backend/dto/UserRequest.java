package com.pstu.backend.dto;

import com.pstu.backend.enums.Role;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Body of {@code POST /api/v1/users} (ADMIN only). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserRequest {

    @NotBlank(message = "Username is required")
    @Size(min = 3, max = 100, message = "Username must be between 3 and 100 characters")
    @Pattern(
            regexp = "^[A-Za-z0-9._-]+$",
            message = "Username may contain only letters, digits, dot, underscore and hyphen")
    private String username;

    /**
     * Minimum length is enforced here rather than in the service so the bound is
     * visible next to the field and returns a normal 400 validation payload.
     */
    @NotBlank(message = "Password is required")
    @Size(min = 8, max = 200, message = "Password must be between 8 and 200 characters")
    private String password;

    @NotBlank(message = "Display name is required")
    @Size(max = 150, message = "Display name must be at most 150 characters")
    private String displayName;

    @NotNull(message = "Role is required")
    private Role role;

    @Builder.Default
    private Boolean enabled = Boolean.TRUE;
}