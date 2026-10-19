# =============================================================================
# Spring Boot API, production image.
#
# Multi-stage so the image is *built from source* rather than from a jar someone
# happened to compile first. The previous single-stage file copied
# target/backend-0.0.1-SNAPSHOT.jar from the build context, which meant:
#   - `docker build` failed outright on a clean checkout (no target/ directory);
#   - the jar in the image could differ from the source in the context, so the
#     image was not reproducible from the repository;
#   - the image was tied to whatever JDK the developer happened to use.
#
# The dependency layer is cached on pom.xml alone, so a source-only change skips
# re-downloading the whole dependency tree.
# =============================================================================

FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /build

# Cache the dependency resolution separately from the sources.
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline

COPY src ./src
# Tests run in CI (`mvn verify`), not here: an image build should not need a
# database, and a red test must not be the thing that reveals itself in prod.
RUN mvn -B -q clean package -DskipTests

FROM eclipse-temurin:17-jre-alpine

RUN apk add --no-cache curl \
    && addgroup -S appgroup \
    && adduser -S appuser -G appgroup

WORKDIR /app

# Only the artifact is copied, so the runtime image carries no build tooling,
# no source and no Maven cache.
COPY --from=builder --chown=appuser:appgroup /build/target/backend-*.jar app.jar

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1

# -XX:MaxRAMPercentage instead of a fixed heap: the container limit is the only
# thing that knows how much memory the deployment actually has.
ENTRYPOINT ["java", \
  "-XX:MaxRAMPercentage=75", \
  "-XX:+UseG1GC", \
  "-XX:MaxGCPauseMillis=200", \
  "-XX:+ExitOnOutOfMemoryError", \
  "-Djava.security.egd=file:/dev/urandom", \
  "-jar", "app.jar"]