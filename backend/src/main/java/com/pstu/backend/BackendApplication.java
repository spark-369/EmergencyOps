package com.pstu.backend;

import com.pstu.backend.config.EventPipelineProperties;
import com.pstu.backend.config.JwtProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * {@code @EnableConfigurationProperties} binds {@code app.jwt.*} into
 * {@link JwtProperties} and {@code app.events.*} into
 * {@link EventPipelineProperties}. Without it the records are never registered as
 * beans and the JWT / event beans fail to start.
 *
 * <p>There is deliberately no {@code @EnableScheduling}: nothing is annotated
 * {@code @Scheduled} any more. The outbox relay runs as a JobRunr recurring job
 * ({@code EventJobScheduling}), which persists the schedule in the job store, so it
 * survives a restart and is coordinated across instances in a way the in-memory
 * Spring scheduler cannot offer.
 */
@SpringBootApplication
@EnableConfigurationProperties({JwtProperties.class, EventPipelineProperties.class})
public class BackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(BackendApplication.class, args);
	}

}

