package com.pstu.backend.config;

import com.pstu.backend.enums.Role;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the JWT-to-authorities mapping.
 *
 * <p>This is the single point where a token's claims become the {@code ROLE_*}
 * authorities that every {@code @PreAuthorize} evaluates. If it silently produced
 * no authorities, the API would authenticate everyone and authorise nobody — the
 * kind of failure that looks like "everything is 403" in production.
 */
class JwtAuthenticationConverterTest {

    private final JwtAuthenticationConverter converter = new JwtAuthenticationConverter();

    private static Jwt tokenWithRoles(Object roles) {
        Jwt.Builder builder = Jwt.withTokenValue("token")
                .header("alg", "HS256")
                .issuer("test-issuer")
                .subject("dana")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(60));
        if (roles != null) {
            builder.claim("roles", roles);
        }
        return builder.build();
    }

    private static Collection<String> authorityNames(AbstractAuthenticationToken auth) {
        return auth.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList();
    }

    @Test
    void mapsRoleClaimToPrefixedAuthority() {
        AbstractAuthenticationToken auth = converter.convert(tokenWithRoles(List.of("ADMIN")));

        assertThat(authorityNames(auth)).containsExactly("ROLE_ADMIN");
        // The principal must be the username, which `@AuthenticationPrincipal Jwt`
        // consumers and `jwt.getSubject()` rely on.
        assertThat(auth.getName()).isEqualTo("dana");
        assertThat(auth.isAuthenticated()).isTrue();
    }

    @Test
    void mapsEveryKnownRole() {
        for (Role role : Role.values()) {
            AbstractAuthenticationToken auth =
                    converter.convert(tokenWithRoles(List.of(role.name())));
            assertThat(authorityNames(auth)).containsExactly(role.authority());
        }
    }

    @Test
    void ignoresUnknownRoleStrings() {
        // A forged or stale claim must not grant anything.
        AbstractAuthenticationToken auth =
                converter.convert(tokenWithRoles(List.of("SUPERUSER", "ROOT")));

        assertThat(authorityNames(auth)).isEmpty();
        assertThat(auth.isAuthenticated()).isTrue();
    }

    @Test
    void grantsOnlyTheKnownRolesFromAMixedClaim() {
        AbstractAuthenticationToken auth =
                converter.convert(tokenWithRoles(List.of("ADMIN", "WIZARD")));

        assertThat(authorityNames(auth)).containsExactly("ROLE_ADMIN");
    }

    @Test
    void tokenWithoutRolesClaimHasNoAuthorities() {
        AbstractAuthenticationToken auth = converter.convert(tokenWithRoles(null));

        assertThat(authorityNames(auth)).isEmpty();
    }
}