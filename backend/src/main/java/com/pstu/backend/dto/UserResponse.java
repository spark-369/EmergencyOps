package com.pstu.backend.dto;

import com.pstu.backend.entity.User;
import com.pstu.backend.enums.Role;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Safe projection of {@link User}.
 *
 * <p>Never exposes {@code passwordHash}: the browser holds this object and reads
 * {@code roles} to decide which navigation entries and buttons to render.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserResponse {

    private Long id;

    private String username;

    private String displayName;

    /** Highest-privilege role first; duplicated into {@code roles} for the UI. */
    private List<String> roles;

    private Role role;

    private boolean enabled;

    public static UserResponse from(User user) {
        return UserResponse.builder()
                .id(user.getId())
                .username(user.getUsername())
                .displayName(user.getDisplayName())
                .role(user.getRole())
                .roles(user.getRole() == null ? List.of() : List.of(user.getRole().name()))
                .enabled(user.isEnabled())
                .build();
    }
}