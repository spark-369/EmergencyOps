package com.pstu.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The JSON mapper the event pipeline serializes with.
 *
 * <p><strong>Why this bean exists.</strong> {@code EventStore},
 * {@code EventPublisher} and {@code EventProcessingService} inject
 * {@code com.fasterxml.jackson.databind.ObjectMapper} (Jackson 2) by constructor, but
 * Spring Boot 4 no longer auto-configures a bean of that type — its JSON
 * auto-configuration targets Jackson 3 in a different package
 * ({@code tools.jackson.*}). Without this bean the context fails to start with
 * "required a bean of type ... ObjectMapper that could not be found", which is what
 * happens when Boot 3-era code runs on Boot 4.
 *
 * <p><strong>Why declare it rather than migrate.</strong> The Jackson 2 API is what the
 * pipeline is written against, including checked {@code JsonProcessingException}
 * handling. Declaring the bean keeps that code correct and confines the version
 * decision to one class; both Jackson artifacts are pinned in {@code pom.xml} so the
 * types are guaranteed to be present.
 *
 * <p><strong>{@code @ConditionalOnMissingBean}.</strong> If some dependency does
 * register an {@code ObjectMapper}, that one wins and this method is skipped. Two
 * competing mappers would otherwise fail the context with a duplicate-bean error.
 *
 * <p><strong>{@link JavaTimeModule} is required, not optional.</strong>
 * {@code EventEnvelope} carries {@code Instant occurredAt}; without the module Jackson
 * serializes it as a nested object and fails to read it back, and without
 * {@code WRITE_DATES_AS_TIMESTAMPS=false} it becomes epoch millis — unreadable in the
 * dead-letter topic and incompatible with the ISO-8601 form the API returns elsewhere.
 */
@Configuration
public class JacksonConfig {

    @Bean
    @ConditionalOnMissingBean(ObjectMapper.class)
    public ObjectMapper objectMapper() {
        return new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }
}
