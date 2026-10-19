package com.pstu.backend.enums;

/**
 * Application roles embedded in the JWT as the {@code roles} claim.
 *
 * <p>Kept deliberately coarse: authorisation is expressed as "can this role
 * perform a mutation?" rather than per-endpoint permission codes, which keeps
 * {@code @PreAuthorize} expressions readable and the token small.
 *
 * <ul>
 *   <li>{@link #ADMIN} — everything, including user administration.</li>
 *   <li>{@link #DISPATCHER} — all operational mutations (incidents, allocations,
 *       resources, hospitals, road network, optimisation).</li>
 *   <li>{@link #FIELD_OPERATOR} — may report and progress incidents and update
 *       resource/hospital status, but cannot delete records.</li>
 *   <li>{@link #VIEWER} — read-only.</li>
 * </ul>
 */
public enum Role {
    ADMIN,
    DISPATCHER,
    FIELD_OPERATOR,
    VIEWER;

    /** Spring Security authority name, e.g. {@code ROLE_ADMIN}. */
    public String authority() {
        return "ROLE_" + name();
    }
}