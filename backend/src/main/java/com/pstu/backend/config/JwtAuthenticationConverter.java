package com.pstu.backend.config;

import com.pstu.backend.enums.Role;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.Arrays;
import java.util.Collection;
import java.util.List;

/**
 * Maps the {@code roles} claim onto Spring Security {@code ROLE_*} authorities.
 *
 * <p>Without this, a valid token authenticates but carries no authorities, and
 * every {@code @PreAuthorize("hasRole('ADMIN')")} would deny — the classic
 * "authenticated but forbidden" symptom.
 *
 * <p>Authority names are re-derived from the known {@code Role} enum rather than
 * trusted as free text, so a token cannot smuggle in an arbitrary authority
 * string.
 *
 * <h2>Why a named class instead of a lambda bean</h2>
 * <p>This converter is instantiated directly by {@code SecurityConfig} and is
 * deliberately <strong>not</strong> a {@code @Bean}. Spring Boot registers beans
 * implementing {@link Converter} with the application-wide conversion service, and
 * a lambda bean loses its generic signature at compile time — which made startup
 * fail with <em>"Unable to determine source type &lt;S&gt; and target type &lt;T&gt;
 * for your Converter"</em> (surfaced by Kafka's listener post-processor, the first
 * component to walk the converter list).
 *
 * <p>Keeping it out of the bean registry both avoids that failure and prevents a
 * security-only converter from participating in unrelated type conversion.
 */
public class JwtAuthenticationConverter
        implements Converter<Jwt, AbstractAuthenticationToken> {

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        return new JwtAuthenticationToken(jwt, authorities(jwt), jwt.getSubject());
    }

    private static Collection<GrantedAuthority> authorities(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        if (roles == null || roles.isEmpty()) {
            return List.of();
        }
        return roles.stream()
                .filter(JwtAuthenticationConverter::isKnownRole)
                .map(role -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + role))
                .toList();
    }

    private static boolean isKnownRole(String role) {
        return Arrays.stream(Role.values()).anyMatch(known -> known.name().equals(role));
    }
}