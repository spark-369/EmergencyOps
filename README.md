<div align="center">

# EmergencyOps — Resource Optimization Platform

**Intelligent Emergency Response & Resource Optimization Platform**

An end-to-end emergency dispatch console: incident intake, priority triage, resource
allocation, hospital capacity, road-network routing and fleet re-optimisation — backed
by a transactional-outbox event pipeline.

`Spring Boot 4.1` · `Java 17` · `PostgreSQL` · `Redis` · `JobRunr` · `Next.js 16` · `React 19` · `Redux Toolkit` · `Tailwind CSS 4`

</div>

---

## Table of contents

**Project**
1. [Overview](#1-overview)
2. [Key capabilities](#2-key-capabilities)
3. [System architecture](#3-system-architecture)
4. [Repository layout](#4-repository-layout)
5. [Technology stack](#5-technology-stack)

**Running the platform**
6. [Prerequisites](#6-prerequisites)
7. [Quick start (Docker Compose)](#7-quick-start-docker-compose)
8. [Local development](#8-local-development)
9. [Configuration reference](#9-configuration-reference)
10. [First run & bootstrap](#10-first-run--bootstrap)
11. [Building for production](#11-building-for-production)
12. [CI/CD](#12-cicd)

**Backend documentation**
13. [Backend architecture](#13-backend-architecture)
14. [Domain model](#14-domain-model)
15. [REST API reference](#15-rest-api-reference)
16. [Decision engine](#16-decision-engine)
17. [Event pipeline](#17-event-pipeline)
18. [Security model](#18-security-model)
19. [Error handling contract](#19-error-handling-contract)
20. [Observability](#20-observability)

**Frontend documentation**
21. [Frontend architecture](#21-frontend-architecture)
22. [Routing & screen map](#22-routing--screen-map)
23. [Data layer (RTK Query + axios)](#23-data-layer-rtk-query--axios)
24. [State management](#24-state-management)
25. [UI component library](#25-ui-component-library)
26. [Session lifecycle](#26-session-lifecycle)
27. [Design system & accessibility](#27-design-system--accessibility)

**Operations**
28. [Testing](#28-testing)
29. [Troubleshooting](#29-troubleshooting)
30. [Security posture & limitations](#30-security-posture--limitations)
31. [Extension guide](#31-extension-guide)
32. [Glossary](#32-glossary)


---

## 1. Overview

EmergencyOps is a two-application monorepo:

| Application | Port | Responsibility |
|---|---|---|
| `backend/` | `8080` | Spring Boot REST API, decision engine, event pipeline, persistence |
| `frontend/` | `3000` | Next.js operations console (dark, keyboard-first, map-aware) |

The platform models the full lifecycle of an emergency response:

```
report incident ─▶ compute priority ─▶ recommend a unit ─▶ dispatch ─▶ en-route ─▶ arrived ─▶ resolved
                        │                    │                │
                        │                    │                └─ allocation status + resource load
                        │                    └─ ETA from the road graph (haversine fallback)
                        └─ INCIDENT_CREATED fact (transactional outbox)
```

Every state change is written **and** announced. Writes commit together with an outbox row
in the same transaction; a durable background job delivers the event to Redis. A broker
outage therefore *delays* events instead of losing them, and the API keeps answering.

### Design principles

- **The API is the security boundary.** UI role checks are affordances only; every
  mutation is re-checked by `@PreAuthorize` on the controller.
- **Fail closed.** A missing JWT secret, a wildcard CORS origin or schema drift aborts
  startup instead of booting half-configured.
- **At-least-once delivery, exactly-once effect.** Consumers deduplicate on `eventId`.
- **Explainable decisions.** Every optimisation row carries a `rationale` and records
  whether its ETA came from the road graph or the geometric fallback.
- **Degrade, don't fail.** Routing has a circuit breaker and a fallback; the outbox is a
  safety net, not the fast path.

---

## 2. Key capabilities

| Domain | Capabilities |
|---|---|
| **Incidents** | Create, paginate, filter by severity/region, re-prioritise, guard-railed status lifecycle, allowed-transition discovery |
| **Resources** | Fleet registry (9 unit types), availability, live location, load updates, failure/maintenance/restore reporting |
| **Allocations** | Dispatch a unit to an incident, progress through `PENDING → ASSIGNED → EN_ROUTE → ARRIVED → COMPLETED`, cancel |
| **Hospitals** | Register capacity, bed/ICU/emergency updates, status transitions, region lookup |
| **Road network** | Directed segment graph, closures, congestion/delay factors, travel-time corrections |
| **Optimisation** | Fleet-wide greedy assignment, per-incident recommendation, ETA provenance, rationale |
| **Pipeline ops** | Outbox backlog, timeline per aggregate, bounded flush, event replay |
| **Administration** | User CRUD (admin only), role assignment, self-service password change |
| **Console** | Live dashboard, command palette (⌘K), Leaflet map picker, toasts, CSV export, accessible dialogs |


---

## 3. System architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                Browser                                       │
│   Next.js 16 App Router · React 19 · Redux Toolkit + RTK Query · Tailwind 4  │
│   JWT in localStorage → Authorization: Bearer <token> on every request       │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ HTTPS · CORS (exact origin allow-list)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│                     Spring Boot 4.1 API  (:8080/api/v1)                      │
│                                                                              │
│  SecurityFilterChain ─▶ CorrelationIdFilter ─▶ Controllers                   │
│                                 │                                            │
│                                 ▼                                            │
│  Services (Incident, Allocation, Resource, Hospital, RoadNetwork,            │
│            Optimization, Auth, User, EventProcessing)                        │
│         │                        │                       │                   │
│         │ PriorityCalculator     │ RoutingService        │ EventPublisher    │
│         │ (deterministic score)  │ (Dijkstra + breaker)  │ (outbox enqueue)  │
│         ▼                        ▼                       ▼                   │
│  ┌─────────────────────────────────────────┐   ┌──────────────────────────┐  │
│  │  PostgreSQL                             │   │  JobRunr (SQL job store  │  │
│  │  incidents · resources · allocations    │   │  in PostgreSQL)          │  │
│  │  hospitals · road_network · users       │   │  durable delivery jobs,  │  │
│  │  refresh_tokens · pipeline_events       │   │  retries, outbox sweep   │  │
│  │  jobrunr_*                              │   └────────────┬─────────────┘  │
│  └─────────────────────────────────────────┘                │                │
│                                                              ▼               │
│  RedisTopicSubscriber ◀──── Redis (pub/sub + capped list per topic) ◀────────┘
│         │                                                                    │
│         ▼                                                                    │
│  EventProcessingService ─▶ EmergencyEventPipeline ─▶ domain services         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Two stores, two jobs

| Store | Role | Why |
|---|---|---|
| **PostgreSQL** | System of record + outbox + JobRunr job store | Durable and transactional with the aggregate |
| **Redis** | Event transport (channel notification + capped per-topic list) | Fast fan-out; payloads remain readable afterwards |

> JobRunr deliberately uses its **SQL** storage provider (`jobrunr.database.type=sql`).
> Its Redis provider is still BETA upstream, and Redis here carries only published
> payloads — so a Redis outage delays events rather than losing scheduled work.

### Write path

```
HTTP request
   └─ service (@Transactional)
        ├─ validate against the lifecycle graph
        ├─ persist the aggregate
        └─ EventPublisher.publish(envelope)
              ├─ EventStore.persist → pipeline_events row (PENDING)
              └─ afterCommit → EventJobScheduling → JobRunr background job
                                     └─ EventDeliveryJob → RedisEventBus → PUBLISHED
```

### Read path

```
Browser ─▶ RTK Query hook ─▶ axiosBaseQuery ─▶ apiClient (Bearer header)
        ─▶ Spring controller ─▶ @PreAuthorize ─▶ service (read-only) ─▶ repository
        ─▶ DTO ─▶ JSON (nulls omitted) ─▶ RTK Query cache (tags invalidated on mutation)
```

---

## 4. Repository layout

```
v1/
├── README.md                        ← this document
├── .github/workflows/ci.yml         Backend tests · frontend typecheck/lint/build · audit
│
├── backend/                         Spring Boot 4.1 (Maven)
│   ├── pom.xml
│   ├── Dockerfile                   Multi-stage: maven build → temurin JRE alpine
│   ├── docker-compose.yml           postgres + redis + backend + frontend
│   └── src/
│       ├── main/
│       │   ├── java/com/pstu/backend/
│       │   │   ├── BackendApplication.java
│       │   │   ├── config/          Security, JWT, CORS, rate limits, JobRunr, Jackson
│       │   │   ├── controller/      REST endpoints (9 controllers)
│       │   │   ├── dto/             Request / response objects
│       │   │   ├── entity/          JPA entities
│       │   │   ├── enums/           IncidentStatus, Severity, ResourceType, Role, …
│       │   │   ├── exception/       Lifecycle graphs + GlobalExceptionHandler
│       │   │   ├── pipeline/        Outbox, JobRunr jobs, Redis transport, ingest loop
│       │   │   ├── repository/      Spring Data JPA repositories
│       │   │   ├── route/           RoutingService (least-cost travel time)
│       │   │   ├── security/        TokenService (JWT + refresh rotation)
│       │   │   ├── service/         Business logic
│       │   │   └── util/            PriorityCalculator
│       │   └── resources/
│       │       ├── application.properties   Single source of configuration
│       │       └── logback-spring.xml
│       └── test/java/com/pstu/backend/      ~78 tests (JUnit 5 + AssertJ + Mockito)
│
└── frontend/                        Next.js 16 App Router (TypeScript)
    ├── package.json
    ├── next.config.ts               Security headers, CSP, standalone output
    ├── tsconfig.json · eslint.config.mjs
    ├── Dockerfile                   deps → builder → runner (node:20-alpine)
    ├── app/                         Routes (App Router)
    │   ├── layout.tsx · page.tsx · globals.css · error.tsx
    │   ├── login/ · register/
    │   ├── incidents/ · allocations/ · resources/ · hospitals/ · road-network/
    │   ├── optimization/ · api-explorer/ · users/
    ├── components/
    │   ├── auth/                    <Can> role guard
    │   ├── incidents/               Detail drawer
    │   ├── layout/                  AppShell, sidebar, topbar, palette, health, user menu
    │   ├── providers/               StoreProvider, AuthProvider, ClientOnly, ProfileSync
    │   └── ui/                      Button, Card, Table, Modal, Registry, Map, Toasts…
    └── lib/
        ├── axios.ts                 Instances, interceptors, refresh-and-retry, normaliser
        ├── auth/session.ts          localStorage session + role helpers
        ├── store/                   store.ts, api.ts, axios-base-query.ts, ui-slice.ts
        ├── format.ts · navigation.ts · types.ts · use-registry.ts · use-api-notify.ts
```

---

## 5. Technology stack

### Backend

| Area | Choice | Notes |
|---|---|---|
| Framework | Spring Boot **4.1.0** | Java **17**, Maven wrapper included |
| Web | Spring Web MVC | REST/JSON |
| Persistence | Spring Data JPA / Hibernate | PostgreSQL dialect; H2 for tests |
| Security | Spring Security + `oauth2-resource-server` | Stateless JWT, HS256, `@EnableMethodSecurity` |
| Validation | Jakarta Bean Validation | `@Valid` on request bodies |
| Resilience | **Resilience4j 2.1.0** | Per-IP rate limiters + routing circuit breaker |
| Background jobs | **JobRunr 7.3.2** | SQL storage provider, recurring outbox sweep |
| Transport | Spring Data Redis (Lettuce) | Pub/sub + capped per-topic lists |
| Mapping | MapStruct 1.6.0 + Lombok | Entity ⇄ DTO |
| Metrics | Micrometer + Actuator | `/actuator/prometheus` |
| Logging | SLF4J + Logstash encoder | JSON-capable structured logs |
| Testing | JUnit 5, AssertJ, Mockito, MockMvc | Context-load test runs on H2 |

### Frontend

| Area | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.4.2** (App Router) | `output: "standalone"`, Turbopack |
| UI | **React 19.3**, TypeScript 5 (`strict`) | Client-rendered console |
| Data | **RTK Query** + **axios 1.x** | Custom `axiosBaseQuery` for auth/refresh |
| State | Redux Toolkit 2.5 | `api`, `ui`, `auth` slices |
| Styling | **Tailwind CSS 4** (`@tailwindcss/turbopack`) | Dark-only design tokens |
| Maps | Leaflet 1.9 | CSS bundled locally (CSP-safe) |
| Lint | ESLint 9 + `eslint-config-next` | `core-web-vitals` + `typescript` |

---

## 6. Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Docker Engine + Compose v2 | — | The one-command stack |
| JDK | **17** (Temurin recommended) | Running the backend from an IDE or CLI |
| Node.js | **20+** (LTS) | Running the console |
| PostgreSQL | **16** | Local backend run without Docker |
| Redis | **7** | Local backend run without Docker |

> The Maven wrapper (`backend/mvnw`) is committed, so a separate Maven install is
> optional.

---

## 7. Quick start (Docker Compose)

The compose file lives in `backend/` because that is where the Spring project and its
Dockerfile are; it builds **both** images.

```bash
cd backend
docker compose up --build
```

| Service | Container | URL |
|---|---|---|
| Frontend | `emergency-frontend` | http://localhost:3000 |
| Backend | `emergency-backend` | http://localhost:8080/api/v1 |
| OpenAPI-ish explorer | — | http://localhost:3000/api-explorer |
| PostgreSQL | `emergency-postgres` | `localhost:5432` (`emergency_db`) |
| Redis | `emergency-redis` | `localhost:6379` |

Then open http://localhost:3000 — on an empty database the login screen offers
**“Create the first administrator”** (see [First run](#10-first-run--bootstrap)).

### Secure the local stack

The compose file ships an obvious development fallback for `JWT_SECRET` and
`DB_PASSWORD`. Every token signed with that key is forgeable — override both for
anything beyond a laptop:

```bash
cd backend
JWT_SECRET=$(openssl rand -base64 48) \
DB_PASSWORD='choose-a-real-password' \
docker compose up --build
```

### Compose specifics worth knowing

| Setting | Value | Reason |
|---|---|---|
| `SPRING_JPA_HIBERNATE_DDL_AUTO` | `create` | First boot starts on an empty volume; `create` is additive and does not drop tables |
| `REDIS_HOST` | `redis` | `localhost` inside the container is the backend itself |
| `JOBRUNR_SKIP_CREATE` | `false` | JobRunr creates its `jobrunr_*` tables on first start |
| `NEXT_PUBLIC_API_BASE_URL` | build arg | Baked into the browser bundle — must be host-reachable |
| `BACKEND_URL` | `http://backend:8080` | Server-side axios uses the compose network |
| Redis persistence | AOF `everysec`, `noeviction` | Published payloads survive a restart; the buffer is never evicted |

Useful commands:

```bash
cd backend
docker compose ps                      # service health
docker compose logs -f backend         # follow API logs
docker compose down                    # stop (volumes kept)
docker compose down -v                 # stop and wipe all data
```

---

## 8. Local development

Two terminals, plus PostgreSQL and Redis running locally (for example
`docker compose up postgres redis`).

### Backend

```bash
cd backend

# 1. Generate a signing key (HS256 needs >= 32 bytes)
export JWT_SECRET=$(openssl rand -base64 48)

# 2. Point at local services (defaults shown; override if needed)
export DB_URL=jdbc:postgresql://localhost:5432/emergency_db
export DB_USERNAME=postgres
export DB_PASSWORD=postgres
export REDIS_HOST=localhost
export REDIS_PORT=6379

# 3. First run only: build the schema from the entities
export SPRING_JPA_HIBERNATE_DDL_AUTO=create
./mvnw spring-boot:run
```

Subsequent starts use the default `validate`, which fails fast on schema drift instead
of silently altering tables.

Alternative run modes:

```bash
./mvnw clean package -DskipTests && java -jar target/backend-0.0.1-SNAPSHOT.jar
./mvnw test                      # unit + context-load tests (H2, no services needed)
./mvnw verify                    # tests + packaging (what CI runs)
```

Smoke test:

```bash
curl -s http://localhost:8080/api/v1/health | jq
```

### Frontend

```bash
cd frontend
npm ci
# .env.local (optional — defaults to http://localhost:8080/api/v1)
printf 'NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api/v1\n' > .env.local
npm run dev                      # http://localhost:3000
```

| Script | Purpose |
|---|---|
| `npm run dev` | Turbopack dev server with HMR |
| `npm run build` | Production build (emits `.next/standalone`) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (`core-web-vitals` + TypeScript rules) |
| `npx tsc --noEmit` | Type-check only (used by CI) |

> `NEXT_PUBLIC_*` values are **inlined at build time**. Changing the API URL requires a
> rebuild, not just a restart, and the value also feeds the CSP `connect-src`.

### Suggested demo data order

The screens are more useful with a populated graph:

1. **Road Network** → create segments between named locations (`Clinic A → Junction B`).
2. **Hospitals** → register at least one with beds and ICU capacity.
3. **Resources** → register ambulances/teams with lat/lon and a travel speed.
4. **Incidents** → report one (status becomes `PRIORITIZED` with a computed score).
5. **Optimization** → *Re-optimise fleet*; each decision shows ETA provenance.
6. **Allocations** → dispatch a recommended unit and progress it to `ARRIVED`.

---

## 9. Configuration reference

The backend has **one** configuration document —
`backend/src/main/resources/application.properties` — and no Spring profiles. Environment
overrides use `${VAR:default}` placeholders on individual keys, which is deliberate: a
profile marker in a `.properties` file silently discards the whole document when that
profile is inactive.

### Backend environment variables

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | *(insecure dev fallback in the file)* | Base64 or raw key ≥ 32 bytes. **Override in every real deployment.** |
| `JWT_ISSUER` | `emergency-response-platform` | `iss` claim, validated on each request |
| `JWT_ACCESS_TTL` | `15m` | Access-token lifetime |
| `JWT_REFRESH_TTL` | `7d` | Refresh-token lifetime (rotated on use) |
| `DB_URL` | `jdbc:postgresql://localhost:5432/emergency_db` | JDBC URL |
| `DB_USERNAME` | `postgres` | Database user |
| `DB_PASSWORD` | *(dev fallback)* | Database password — **override** |
| `SPRING_JPA_HIBERNATE_DDL_AUTO` | `validate` | `create` once on a fresh DB, then `validate` |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Event transport |
| `REDIS_PASSWORD` / `REDIS_DATABASE` | *(empty)* / `0` | Auth / DB index |
| `REDIS_TIMEOUT` / `REDIS_CONNECT_TIMEOUT` | `2s` / `2s` | Fail fast on an unreachable broker |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated **exact** origins; `*` aborts startup |
| `RATE_LIMIT_LOGIN` / `_REGISTER` / `_REFRESH` | `10` / `5` / `60` per 60 s | Per-client-IP limits |
| `TRUST_FORWARDED_HEADERS` | `false` | Trust `X-Forwarded-For` / `X-Real-IP` (proxy only) |
| `PUBLIC_ACTUATOR_METRICS` | `false` | Expose `/actuator/prometheus` unauthenticated |
| `JOBRUNR_POLL_SECONDS` | `5` | JobRunr worker poll interval |
| `JOBRUNR_MAX_RETRIES` | `10` | Delivery retries (exponential back-off) |
| `JOBRUNR_SKIP_CREATE` | `false` | `true` once `jobrunr_*` tables exist |
| `OUTBOX_RELAY_ENABLED` | `true` | Register the recurring sweep |
| `OUTBOX_SWEEP_INTERVAL_SECONDS` | `15` | Sweep cadence |
| `EVENTS_*_TOPIC` | `emergency.<domain>.v1` | incidents, allocations, resources, optimization, all, accounts, failure |
| `EVENTS_CONSUMER_PATTERN` | 5 consumed topics | Comma-separated; intentionally **excludes** the failure topic |
| `EVENTS_CONSUMER_ENABLED` | `true` | Launch the in-process Redis subscriber |
| `EVENTS_REDIS_RETENTION` | `1000` | Payloads kept per topic in Redis |

### Notable backend defaults

| Property | Value | Rationale |
|---|---|---|
| `server.port` | `8080` | |
| `spring.jpa.open-in-view` | `false` | No lazy loading outside a transaction |
| `spring.jackson.default-property-inclusion` | `non_null` | Nulls omitted → frontend fields are optional |
| `server.error.include-stacktrace` / `-message` | `never` | No internals in API responses |
| `spring.cache.type` | `caffeine` | `maximumSize=500, expireAfterWrite=300s` |
| `management.endpoints.web.exposure.include` | `health,info,prometheus,metrics` | `env`, `beans`, `threaddump` deliberately **not** exposed |
| `jobrunr.dashboard.enabled` | `false` | Dashboard is unauthenticated; `/pipeline/outbox` replaces it |

### Frontend environment variables

| Variable | Scope | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | build-time, browser | `http://localhost:8080/api/v1` | API root; also used to build the CSP |
| `BACKEND_URL` | runtime, server | *(falls back to the above)* | Server-side axios base (`http://backend:8080`) |
| `NODE_ENV` | runtime | — | Selects the production CSP branch |
| `NEXT_TELEMETRY_DISABLED` | build | — | Set to `1` for reproducible builds |

---

## 10. First run & bootstrap

No accounts exist and none are seeded. The bootstrap flow is **one-shot by construction**:

1. `GET /api/v1/auth/registration-status` → `{ "registrationOpen": true }` on an empty DB.
2. The login screen shows **Create the first administrator**.
3. `POST /api/v1/auth/register` creates an `ADMIN`. The emptiness check and the insert
   share a transaction and the method is `synchronized`, so two concurrent requests cannot
   both succeed.
4. From then on the endpoint answers **409 Conflict** — permanently.
5. Further accounts are created by an `ADMIN` on the **Users** screen
   (`POST /api/v1/users`).

```bash
# First admin (works only once)
curl -s -X POST http://localhost:8080/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"ChangeMe!2026","displayName":"Ops Admin"}'

# Sign in
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"ChangeMe!2026"}'
```

---

## 11. Building for production

### Backend image

`backend/Dockerfile` is multi-stage: Maven builds from source (dependency layer cached on
`pom.xml`), then only the jar is copied into `eclipse-temurin:17-jre-alpine`, running as an
unprivileged `appuser`.

```bash
cd backend
docker build -t emergencyops/backend:local .
docker run --rm -p 8080:8080 \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e DB_URL=jdbc:postgresql://host.docker.internal:5432/emergency_db \
  -e DB_PASSWORD=secret \
  -e REDIS_HOST=host.docker.internal \
  emergencyops/backend:local
```

The image container-tunes the JVM (`-XX:MaxRAMPercentage=75`, G1, `ExitOnOutOfMemoryError`)
and health-checks `/actuator/health`.

### Frontend image

`frontend/Dockerfile` uses three stages (`deps → builder → runner`) and runs
`node server.js` from `.next/standalone`.

```bash
cd frontend
docker build \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.ops.example.com/api/v1 \
  -t emergencyops/frontend:local .
docker run --rm -p 3000:3000 -e BACKEND_URL=https://api.ops.example.com emergencyops/frontend:local
```

### Production checklist

- [ ] `JWT_SECRET` is a unique 48-byte secret, injected from a secret manager
- [ ] `DB_PASSWORD` is not the development fallback
- [ ] `CORS_ALLOWED_ORIGINS` lists the exact deployed console origin
- [ ] `SPRING_JPA_HIBERNATE_DDL_AUTO=validate` (schema created once, then locked)
- [ ] `JOBRUNR_SKIP_CREATE=true` once the `jobrunr_*` tables exist
- [ ] `PUBLIC_ACTUATOR_METRICS=false` unless the scraper authenticates
- [ ] `TRUST_FORWARDED_HEADERS=true` **only** behind a proxy that overwrites the headers
- [ ] TLS terminates in front of both services (HSTS is emitted by Next.js)

---

## 12. CI/CD

`.github/workflows/ci.yml` runs on pushes and pull requests to `main`/`master`:

| Job | Steps | Gate it provides |
|---|---|---|
| **backend** | JDK 17 → `mvn -B verify` | Compiles, runs the whole suite, packages; surefire reports uploaded on failure |
| **frontend** | Node 20 → `npm ci` → `tsc --noEmit` → `npm run lint` → `npm run build` | Type safety, lint, and a real production build |
| **frontend (guard)** | asserts `.next/standalone/server.js` exists | Prevents breaking the Docker image by dropping `output: "standalone"` |
| **security** | `npm audit --audit-level=high`, OWASP dependency-check | Fails on HIGH/CRITICAL advisories |

Concurrency cancels superseded runs on the same ref. Backend tests run against **H2**, so
no database service is required.

---

## 13. Backend architecture

### Layering

```
controller  ── HTTP mapping, @PreAuthorize, status codes          (no business rules)
service     ── transactions, lifecycle rules, event publication   (@Transactional)
repository  ── Spring Data JPA derived queries
entity      ── persistence model (Lombok builder/getter/setter, identity equality)
dto         ── API contract (validation annotations live here)
pipeline    ── outbox, transport, ingest loop, JobRunr jobs
```

Controllers never touch repositories directly, and DTOs never leak entities: services map
explicitly so lazy collections cannot trigger a `LazyInitializationException` after the
transaction closes (`spring.jpa.open-in-view=false`).

### Package map

| Package | Contents |
|---|---|
| `config` | `SecurityConfig`, `JwtKeyConfig`, `JwtProperties`, `JwtAuthenticationConverter`, `WebConfig` (CORS), `RateLimitConfig`, `ResilienceConfig`, `JobRunrConfig`, `JacksonConfig`, `LoggingFilter`, `EventPipelineProperties` |
| `controller` | `Auth`, `User`, `Incident`, `Allocation`, `Resource`, `Hospital`, `RoadNetwork`, `Optimization`, `Pipeline`, `Health` |
| `service` | `IncidentService`, `IncidentLifecycleService`, `AllocationService`, `ResourceService`, `HospitalService`, `RoadNetworkService`, `OptimizationService`, `AuthService`, `UserService`, `EventProcessingService` |
| `pipeline` | `EventEnvelope`, `DomainEventType`, `EventStore`, `EventPublisher`, `EventOutboxRelay`, `EventJobScheduling`, `EventDeliveryJob`, `RedisEventBus`, `RedisTopicSubscriber`, `EmergencyEventPipeline`, `CorrelationIdFilter`, `BrokerHealthProbe` |
| `route` | `RoutingService` (Dijkstra over `road_network`) |
| `exception` | `IncidentLifecycle`, `AllocationLifecycle`, `InvalidStateTransitionException`, `GlobalExceptionHandler` |
| `util` | `PriorityCalculator` |

### Transactional conventions

- `@Transactional` on the class for write services; read methods narrow to
  `@Transactional(readOnly = true)`.
- **All** incident status changes funnel through
  `IncidentLifecycleService.transition(...)`. It validates against the lifecycle graph and
  publishes `INCIDENT_STATUS_CHANGED` inside the caller's transaction, so the state and its
  announcement cannot disagree.
- Event publication is deferred to `afterCommit`, so a consumer can never observe a fact
  that rolls back.

### Concurrency & correctness details

| Concern | Implementation |
|---|---|
| Duplicate command delivery | `pipeline_events` stores the processed `eventId` in the same transaction as the write |
| Duplicate optimisation | `IdentityHashMap` of candidate ETAs; each unit claimed at most once |
| Bootstrap race | `synchronized` + transactional emptiness check in `registerFirstAdmin` |
| Schema drift | `ddl-auto=validate` fails startup instead of mutating tables |
| Unit with a null `id` | Identity-based equality; lazy collections excluded from `equals`/`hashCode` |

---

## 14. Domain model

### Entities

| Entity | Table | Key fields |
|---|---|---|
| `EmergencyIncident` | `emergency_incidents` | `incidentId` (UUID, unique), lat/lon, `severity`, `affectedPeople`, `timeSensitivityMinutes`, JSON `resourceRequirements` / `environmentalConditions`, `status`, `priorityScore`, `estimatedResponseTimeMinutes` |
| `Resource` | `resources` | `resourceId` (unique), `type`, lat/lon, `status`, `capacity`, `currentLoad`, `travelSpeedKmh`, JSON `operationalConstraints`, `available` |
| `ResourceAllocation` | `resource_allocations` | incident ⇄ resource, `status`, travel/resolution estimates, `decisionRationale` |
| `Hospital` | `hospitals` | `hospitalId` (unique), `name`, lat/lon, total/available beds, ICU capacity/available, emergency capacity/available, `status` |
| `RoadNetwork` | `road_network` | `fromLocation` → `toLocation` (directed), from/to lat-lon, `distanceKm`, `travelTimeMinutes`, `status` |
| `User` | `users` | `username` (case-insensitive unique), BCrypt `passwordHash`, `displayName`, `role`, `enabled`, `lastLoginAt` |
| `RefreshToken` | refresh-token table | Token **digest** only, expiry, revocation |
| `PipelineEventRecord` | `pipeline_events` | `eventId`, `eventType`, `aggregateId`, `partitionKey`, `correlationId`, `kind`, `status`, `attempts`, `exhausted`, `lastError`, `payload`, timestamps |

Indexes on `emergency_incidents` support the two hot queries: `(status, priorityScore)` for
the active list and `(latitude, longitude)` for region lookups.

### Enumerations

| Enum | Values |
|---|---|
| `IncidentSeverity` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, `CATASTROPHIC` |
| `IncidentStatus` | `RECEIVED`, `PRIORITIZED`, `ALLOCATING`, `IN_PROGRESS`, `RESOLVED`, `CANCELLED`, `FAILED` |
| `AllocationStatus` | `PENDING`, `ASSIGNED`, `EN_ROUTE`, `ARRIVED`, `COMPLETED`, `CANCELLED`, `FAILED` |
| `ResourceType` | `AMBULANCE`, `HOSPITAL`, `RESCUE_TEAM`, `HELICOPTER`, `EMERGENCY_OPERATION_CENTER`, `FIRE_TRUCK`, `POLICE_UNIT`, `SUPPLY_TRUCK`, `VOLUNTEER_TEAM` |
| `ResourceStatus` | `AVAILABLE`, `BUSY`, `MAINTENANCE`, `OFFLINE`, `DEPLOYED`, `STANDBY` |
| `HospitalStatus` | `OPERATIONAL`, `AT_CAPACITY`, `OVER_CAPACITY`, `MAINTENANCE`, `OFFLINE` |
| `RoadStatus` | `OPEN`, `CLOSED`, `DELAYED`, `CONGESTED` |
| `Role` | `ADMIN`, `DISPATCHER`, `FIELD_OPERATOR`, `VIEWER` |

### Incident lifecycle (closed graph)

```
RECEIVED ──▶ PRIORITIZED ──▶ ALLOCATING ──▶ IN_PROGRESS ──▶ RESOLVED
   │              │               │              │
   └──────────────┴───────────────┴──▶ CANCELLED
   └──────────────┴───────────────┴──▶ FAILED
```

- Terminal states have no outgoing edges; `RESOLVED`, `CANCELLED` and `FAILED` are final.
- A transition to the *current* status is rejected — that is what a duplicate delivery
  would attempt, and accepting it would re-run side effects.
- An illegal move raises `InvalidStateTransitionException` → **409** with the allowed set.
- The graph is exposed read-only at
  `GET /incidents/incident-id/{incidentId}/allowed-transitions` so the console renders only
  buttons that will work.

> New incidents are created as `PRIORITIZED`, never `RECEIVED`: the priority score is
> computed synchronously in the same transaction, so `RECEIVED` would be an unobservable
> state.

---

## 15. REST API reference

**Base URL:** `http://localhost:8080/api/v1` · **Content type:** `application/json`

All authenticated calls need `Authorization: Bearer <accessToken>`. Nulls are omitted from
responses (`spring.jackson.default-property-inclusion=non_null`).

### Role matrix

| Role | Read | Progress allocations / incidents | Create & delete inventory | User admin | Pipeline ops |
|---|:--:|:--:|:--:|:--:|:--:|
| `ADMIN` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `DISPATCHER` | ✅ | ✅ | ✅ | — | ✅ |
| `FIELD_OPERATOR` | ✅ | ✅ | — | — | — |
| `VIEWER` | ✅ | — | — | — | — |

### Authentication — `/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | public (10/min/IP) | Exchange credentials for tokens |
| `GET` | `/auth/registration-status` | public | Whether first-run registration is open |
| `POST` | `/auth/register` | public (5/min/IP) | Create the first `ADMIN`; `409` afterwards |
| `POST` | `/auth/refresh` | public (60/min/IP) | Rotate the refresh token, issue a new pair |
| `POST` | `/auth/logout` | public | Revoke the presented refresh token (`204`) |
| `GET` | `/auth/me` | any role | Identity of the caller |
| `POST` | `/auth/change-password` | any role | Change own password; revokes all sessions (`204`) |

`TokenResponse`:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "b7f1c0…-opaque-32-bytes…",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": { "id": 1, "username": "admin", "displayName": "Ops Admin",
            "roles": ["ADMIN"], "enabled": true }
}
```

Access-token claims: `iss`, `iat`, `exp`, `jti`, `sub` (username), `uid`, `name`, `roles`.

### Incidents — `/incidents`

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/incidents` | ADMIN, DISPATCHER, FIELD_OPERATOR | Report an incident → `201` |
| `GET` | `/incidents?page=&size=&sort=` | any | Paged (`Page<IncidentResponse>`) |
| `GET` | `/incidents/{id}` | any | By numeric id |
| `GET` | `/incidents/incident-id/{incidentId}` | any | By business UUID |
| `GET` | `/incidents/active` | any | Non-terminal, priority-ordered |
| `GET` | `/incidents/severity/{severity}` | any | Filter by severity |
| `GET` | `/incidents/region?minLat=&maxLat=&minLon=&maxLon=` | any | Bounding box |
| `GET` | `/incidents/incident-id/{incidentId}/allowed-transitions` | any | Legal next statuses |
| `PATCH` | `/incidents/{id}/status?status=` | ADMIN, DISPATCHER, FIELD_OPERATOR | Guarded transition |
| `POST` | `/incidents/{id}/reassign-priority` | ADMIN, DISPATCHER, FIELD_OPERATOR | Recompute score |
| `DELETE` | `/incidents/{id}` | ADMIN, DISPATCHER | Deletes → `204` |

```bash
curl -s -X POST http://localhost:8080/api/v1/incidents \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "latitude": 23.8103, "longitude": 90.4125,
        "locationDescription": "Multi-vehicle collision, Mirpur Road",
        "severity": "CRITICAL", "affectedPeople": 12,
        "timeSensitivityMinutes": 10,
        "environmentalConditions": { "weather": "heavy rain", "road": "flooded" }
      }'
```

### Resources — `/resources`

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/resources` | ADMIN, DISPATCHER | Register a unit → `201` |
| `GET` | `/resources` · `/{id}` · `/resource-id/{resourceId}` | any | Read |
| `GET` | `/resources/available` | any | Available units |
| `GET` | `/resources/type/{type}` | any | Filter by `ResourceType` |
| `GET` | `/resources/region?…` | any | Bounding box |
| `PATCH` | `/resources/{id}/status?status=` | any operational | Status change |
| `PATCH` | `/resources/{id}/location?latitude=&longitude=` | any operational | Position update |
| `PATCH` | `/resources/{id}/load?currentLoad=` | any operational | Occupancy update |
| `POST` | `/resources/{id}/failure` · `/maintenance` · `/restore` | any operational | Field reports |
| `DELETE` | `/resources/{id}` | ADMIN, DISPATCHER | Delete → `204` |

### Allocations — `/allocations`

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/allocations` | ADMIN, DISPATCHER | Dispatch a unit → `201` |
| `GET` | `/allocations/{id}` · `/active` | any | Read |
| `GET` | `/allocations/incident/{incidentId}` | any | Allocations for an incident |
| `GET` | `/allocations/incident/{incidentId}/summary` | any | Compact detail-drawer view |
| `PATCH` | `/allocations/{id}/status?status=` | ADMIN, DISPATCHER, FIELD_OPERATOR | Progress |
| `POST` | `/allocations/{id}/cancel` | ADMIN, DISPATCHER, FIELD_OPERATOR | Cancel |

```bash
curl -s -X POST http://localhost:8080/api/v1/allocations \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "incidentId": "6f1c…-uuid",
        "resourceId": "AMB-014",
        "estimatedTravelTimeMinutes": 9,
        "estimatedResolutionTimeMinutes": 45,
        "decisionRationale": "Closest advanced-life-support unit"
      }'
```

A dispatch on a terminal incident, or with an unavailable unit, is rejected with **409**.

### Hospitals — `/hospitals`

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/hospitals` | ADMIN, DISPATCHER | Register → `201` |
| `GET` | `/hospitals` · `/{id}` · `/hospital-id/{hospitalId}` | any | Read |
| `GET` | `/hospitals/available` · `/region?…` | any | Availability / bounding box |
| `PATCH` | `/hospitals/{id}/status?status=` | any operational | `HospitalStatus` change |
| `PATCH` | `/hospitals/{id}/beds?availableBeds=&icuAvailable=&emergencyAvailable=` | any operational | Capacity update (all params optional) |
| `DELETE` | `/hospitals/{id}` | ADMIN, DISPATCHER | Delete → `204` |

### Road network — `/road-network`

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/road-network` | ADMIN, DISPATCHER | Create a directed segment → `201` |
| `GET` | `/road-network` · `/{id}` | any | Read |
| `GET` | `/road-network/status/{status}` | any | Filter by `RoadStatus` |
| `GET` | `/road-network/route?fromLocation=&toLocation=` | any | Segments between two names |
| `PATCH` | `/road-network/{id}/status?status=` | any operational | Open / close / congest |
| `PATCH` | `/road-network/{id}?distanceKm=&travelTimeMinutes=` | any operational | Travel-time correction |
| `DELETE` | `/road-network/{id}` | ADMIN, DISPATCHER | Delete → `204` |

> Segment names are the routing graph's node identifiers. `fromLocation`/`toLocation` are
> matched case-insensitively; the edge is **directed**, so create both directions if needed.

### Optimisation — `/optimize`

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/optimize/reoptimize-all` | any authenticated | Fleet-wide plan; publishes `OPTIMIZATION_COMPLETED` |
| `GET` | `/optimize/incident/{incidentId}` | any authenticated | Recommendation for one incident |

```json
{
  "incidentId": "6f1c…",
  "incidentSeverity": "CRITICAL",
  "incidentPriority": 96,
  "recommendedResourceId": "AMB-014",
  "resourceType": "AMBULANCE",
  "estimatedTravelTimeMinutes": 9,
  "estimatedTravelTimeWindow": "9–11 min",
  "etaSource": "ROAD_GRAPH",
  "unitCurrentLoad": 1,
  "unitCapacity": 4,
  "rationale": "Selected AMBULANCE AMB-014 for a CRITICAL incident (priority 96): ETA 9–11 min via ROAD_GRAPH, unit load 1/4"
}
```

The engine **recommends only**; it never creates an allocation. Dispatching remains a
human decision (or an `ALLOCATION_REQUESTED` command on the stream).

### Pipeline operations — `/pipeline` (ADMIN, DISPATCHER)

| Method | Path | Description |
|---|---|---|
| `GET` | `/pipeline/timeline/{aggregateId}` | Every stored event for an aggregate, oldest first, with decoded `payload` |
| `GET` | `/pipeline/events?type=&limit=` | Events of one `DomainEventType`, newest first (limit clamped 1–200) |
| `GET` | `/pipeline/outbox` | `pending`, `gaveUp`, `published`, `broker`, `lastDeliveryError` |
| `POST` | `/pipeline/outbox/flush?budget=` | One bounded relay pass (budget clamped 100–10 000 ms) |
| `POST` | `/pipeline/replay/{eventId}` | Re-publish a stored envelope, preserving `eventId`; `503` if the broker refuses |

### Users — `/users` (ADMIN only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/users` · `/users/{id}` | List / read |
| `POST` | `/users` | Create with role → `201` |
| `PATCH` | `/users/{id}` | Update display name / role / enabled |
| `DELETE` | `/users/{id}` | Delete → `204` (an admin cannot delete their own account) |

### Health — `/health`

Public, unauthenticated, cheap. Returns liveness plus the outbox signal the console polls:

```json
{
  "status": "UP",
  "details": {
    "service": "emergency-response-platform",
    "status": "operational",
    "outboxPending": 0,
    "outboxGaveUp": 0,
    "outboxFailed": 0,
    "outboxPublished": 1287,
    "eventDelivery": "OK"
  }
}
```

`eventDelivery` is `OK` → `DELAYED` (rows queued) → `ATTENTION` (rows exhausted their
retry budget). Degraded is not `DOWN`: events are durable and re-offered every sweep.

---

## 16. Decision engine

### 16.1 Priority score — `PriorityCalculator`

A deterministic 0–100 score, computed once at creation (and on `reassign-priority`):

| Component | Rule | Max |
|---|---|---|
| Severity | `LOW` 10 · `MEDIUM` 30 · `HIGH` 60 · `CRITICAL` 80 · `CATASTROPHIC` 100 | 100 |
| Affected people | `min(affectedPeople / 10, 30)` | 30 |
| Time sensitivity | `max(0, 20 − timeSensitivityMinutes / 5)` | 20 |
| Environmental conditions | `+5` when the map is non-empty | 5 |
| **Total** | `min(sum, 100)` | **100** |

The score orders the active-incident list and the fleet-wide optimisation pass.

### 16.2 Candidate filtering — `findSuitableResources`

A unit is a candidate when **all** hold:

1. Not already claimed in this pass (each unit serves at most one incident).
2. `currentLoad < capacity`.
3. `status ∈ { AVAILABLE, STANDBY }` — the enum is durable truth; the denormalised
   `available` flag can be stale.
4. Capability matches severity:

| Severity | Eligible unit types |
|---|---|
| `CATASTROPHIC`, `CRITICAL` | `AMBULANCE`, `HELICOPTER`, `RESCUE_TEAM`, `HOSPITAL` |
| `HIGH` | `AMBULANCE`, `RESCUE_TEAM`, `HOSPITAL` |
| `LOW`, `MEDIUM` | any type |

### 16.3 Assignment — greedy, priority-first

```
incidents ← active (RECEIVED, PRIORITIZED, ALLOCATING, IN_PROGRESS)
            sorted by priorityScore DESC, then timeSensitivityMinutes ASC
for each incident:
    candidates ← suitable and unclaimed units
    if none: emit a decision with allocatedResourceId = null
    else:    pick argmin(ETA), claim the unit, emit decision + rationale
```

This is the classical priority-greedy heuristic: optimal for the lexicographic objective
"serve the most urgent incidents first" — what a manual dispatcher does anyway. It is
**not** a global minimum-cost assignment (no Hungarian algorithm), and each unit is handed
out at most once, so a plan never recommends the same ambulance twice.

### 16.4 ETA — graph first, geometry as fallback

```
resource position ─▶ nearest road node (anchor) ┐
incident position ─▶ nearest road node (anchor) ┴─▶ RoutingService.calculateRoute(from, to)
                                                     ├─ reachable → ROAD_GRAPH
                                                     └─ otherwise → GEOMETRIC_FALLBACK
```

- **`ROAD_GRAPH`** — Dijkstra over open segments; `CLOSED` edges removed; `CONGESTED`
  ×1.6 and `DELAYED` ×1.25 because stored times are free-flow values. Window is
  `minutes–(minutes + 20%)`, minimum 2 minutes.
- **`GEOMETRIC_FALLBACK`** — haversine distance ÷ speed (`travelSpeedKmh`, default
  `60 km/h`), rounded up; window shown as `~N min`.
- Anchor resolution is memoised per pass; if no road node is near a point, the nearest
  hospital is used as a last-resort anchor.

`etaSource` is returned to the client so a dispatcher knows how much to trust the number.
Routing is wrapped in a Resilience4j circuit breaker (`routingCircuitBreaker`): an open
breaker returns `unreachable` immediately instead of queueing on a saturated pool.

---

## 17. Event pipeline

### 17.1 Why an outbox

Publishing directly inside a transaction lets a consumer observe a fact that later rolls
back. Publishing before commit can lose it on a crash. The outbox solves both: the row is
written **with** the aggregate, and delivery happens **after** the commit.

```
① service writes aggregate + pipeline_events row (PENDING)   ── one transaction
② afterCommit → EventJobScheduling → JobRunr job (derived id) ── durable, outside the tx
③ EventDeliveryJob → RedisEventBus.publish → row PUBLISHED
④ EventOutboxRelay sweep (every 15 s) re-enqueues anything still PENDING
```

The JobRunr job id is derived from the event id, so the after-commit enqueue and a
concurrent sweep collapse into a single job.

### 17.2 Envelope — one wire shape

```json
{
  "eventId": "0f1c…uuid",
  "type": "INCIDENT_CREATED",
  "aggregateId": "6f1c…incident-uuid",
  "partitionKey": "6f1c…incident-uuid",
  "occurredAt": "2026-10-20T09:14:03.512Z",
  "correlationId": "9c2e…",
  "version": 1,
  "payload": { "incidentId": "6f1c…", "severity": "CRITICAL", "priorityScore": 96 },
  "metadata": {}
}
```

| Field | Purpose |
|---|---|
| `eventId` | Producer-generated UUID; the deduplication key; also `X-Event-Id` |
| `type` | `DomainEventType` — unknown names are rejected **at publish time** |
| `aggregateId` | Business identity of the aggregate (timeline key) |
| `partitionKey` | Ordering key (incident / resource / user id) |
| `correlationId` | Propagated from `X-Correlation-Id`; defaulted if absent |
| `version` | Envelope schema version (currently `1`) |
| `payload` | Event-specific body; **nulls allowed** (built over a mutable map) |

### 17.3 Event catalogue

| Type | Topic | Kind | Producer |
|---|---|---|---|
| `INCIDENT_REPORTED` | incidents | command | external / HTTP event API |
| `ALLOCATION_REQUESTED` | allocations | command | external dispatch command |
| `INCIDENT_STATUS_REQUESTED` | incidents | command | field operator status report |
| `INCIDENT_CREATED` | incidents | fact | `IncidentLifecycleService.publishCreated` |
| `INCIDENT_STATUS_CHANGED` | incidents | fact | `IncidentLifecycleService.transition` |
| `ALLOCATION_CREATED` / `_STATUS_CHANGED` / `_CANCELLED` | allocations | fact | `AllocationService` |
| `RESOURCE_STATUS_CHANGED` | resources | fact | `ResourceService` |
| `OPTIMIZATION_COMPLETED` / `_SKIPPED` | optimization | fact | `OptimizationService` |
| `USER_CREATED` / `USER_DELETED` | accounts | fact | `AuthService` / `UserService` |
| `PROCESSING_FAILED` | processing-failures | log | `EmergencyEventPipeline.reportFailure` |

**Naming rule:** `*_REQUESTED` are commands (never replayed — the client can retry);
`*_CREATED` / `*_UPDATED` are facts (replayable).

### 17.4 Ingest loop

`RedisTopicSubscriber` subscribes **only** to the explicit topic list in
`EVENTS_CONSUMER_PATTERN`. It deliberately excludes `emergency.processing-failures.v1` —
a previous pattern matched it, so the service consumed its own failure log.

```
Redis message
   └─ RedisTopicSubscriber (retry: 3 attempts, exponential back-off)
        ├─ parse failure / unknown enum → non-retryable → <failure-topic>.DLT
        └─ EventProcessingService.onEvent(topic, body)   [@Transactional]
              ├─ skip non-commands
              ├─ skip already-seen eventId            (idempotency)
              ├─ EmergencyEventPipeline.handle(envelope)
              │     ├─ INCIDENT_REPORTED          → create + prioritise + optimise
              │     ├─ ALLOCATION_REQUESTED       → dispatch
              │     └─ INCIDENT_STATUS_REQUESTED  → guarded transition
              └─ EventStore.recordProcessed(envelope)  ── marker in the same tx
```

Retry semantics: `IllegalArgumentException` is treated as **non-retryable** (a body that is
not a valid envelope can never become one). On final failure the message is copied to the
DLT rather than dropped, and `PROCESSING_FAILED` is stored **outside** the rolled-back
transaction so the record survives.

### 17.5 Redis layout

| Key / channel | Type | Content |
|---|---|---|
| `<topic>` | pub/sub channel | Notification that a payload was written |
| `emergency:events:<topic>` | capped list | Last `EVENTS_REDIS_RETENTION` (1000) payloads |
| `<failure-topic>.DLT` | list | Dead-lettered messages |

The list exists because a pub/sub message is gone once delivered: a subscriber that was
disconnected can still read the payload afterwards. The `pipeline_events` table remains the
system of record.

### 17.6 Operability

| Signal | Meaning | Action |
|---|---|---|
| `pending` rising | Broker or JobRunr unreachable | Check `lastDeliveryError`, Redis reachability |
| `gaveUp > 0` | Rows burned their retry budget (still retried) | Inspect the timeline; replay after a fix |
| `FAILED` rows | Payload cannot be decoded | Manual triage; they never clear by waiting |
| `eventDelivery: ATTENTION` | Exhausted rows exist | Operator attention required |
| `eventDelivery: DELAYED` | Fresh backlog only | Usually self-heals on the next sweep |

Replay keeps the original `eventId`, so a consumer that already applied the event recognises
the duplicate and does nothing.

---

## 18. Security model

### Authentication

| Aspect | Implementation |
|---|---|
| Mechanism | Stateless OAuth2 resource server; `Authorization: Bearer <JWT>` |
| Algorithm | HS256 (`NimbusJwtEncoder` / `NimbusJwtDecoder`) |
| Key | `JWT_SECRET` ≥ 32 bytes; startup aborts if missing or short |
| Validation | Signature + `iss` + `exp` on every request |
| Authorities | `roles` claim → `ROLE_*` via `JwtAuthenticationConverter` (unknown roles ignored) |
| Access token | 15 min default (`JWT_ACCESS_TTL`) |
| Refresh token | Opaque 256-bit random; **only its digest is stored**; rotated on every use |
| Passwords | BCrypt |
| Sessions | None — no `HttpSession`, no form login, no CSRF token (no ambient credential) |

`TokenService` issues access tokens with claims `iss`, `iat`, `exp`, `jti`, `sub`, `uid`,
`name`, `roles` (always a list).

### Enumeration & timing resistance

- Unknown username and wrong password raise the same `BadCredentialsException`.
- For an unknown user the BCrypt encoder still runs against a dummy hash, so response time
  does not reveal whether the account exists.

### Authorisation

- `@EnableMethodSecurity` + class-level `@PreAuthorize` on every controller, so a **newly
  added endpoint is protected by default**.
- Narrower method-level expressions for destructive operations (create/delete → ADMIN or
  DISPATCHER).

### Rate limiting (per client IP)

| Endpoint | Limit |
|---|---|
| `/auth/login` | 10 / 60 s |
| `/auth/register` | 5 / 60 s |
| `/auth/refresh` | 60 / 60 s |

Resilience4j instances are used as **templates**: a separate limiter is minted per client
key (`authLogin/203.0.113.7`). Ten failed logins from an attacker therefore cannot lock
every operator out. Memory is bounded (10 000 tracked keys, then a shared overflow bucket).

`X-Forwarded-For` / `X-Real-IP` are honoured **only** with
`TRUST_FORWARDED_HEADERS=true`; trusting client-supplied headers unconditionally would make
the limiter a no-op.

### CORS

- Exact origins only (`app.cors.allowed-origins`); a literal `*` **aborts startup**.
- `allowCredentials=false` — the API is header-authenticated, never cookie-authenticated.
- Allowed headers include `Authorization`, `Content-Type`, `X-Correlation-Id`;
  `X-Correlation-Id` is exposed back to the browser.

### Transport & headers

| Header | Value | Set by |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'`, API origin in `connect-src`, OSM tiles in `img-src`, `frame-ancestors 'none'` | Next.js |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Next.js |
| `X-Frame-Options` | `DENY` | Next.js |
| `X-Content-Type-Options` | `nosniff` | Next.js |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Next.js |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self)` | Next.js |
| `X-Powered-By` | *omitted* (`poweredByHeader: false`) | Next.js |

`'unsafe-eval'` and websocket sources are added **only** in development (React dev tooling
and Turbopack HMR); `upgrade-insecure-requests` is added **only** in production. Next.js and
Tailwind require `'unsafe-inline'` for scripts/styles today — this is a documented weakness,
not an oversight.

### Other hardening

- Error responses never include stack traces or exception messages
  (`server.error.include-*=never`); unexpected 500s return a `correlationId`.
- `X-Correlation-Id` is bound to MDC for every request and propagated into events.
- Actuator exposes only `health,info,prometheus,metrics`; `env` and `beans` are not exposed.
- `/actuator/prometheus` is public only when explicitly opted in.
- The JobRunr dashboard is disabled (unauthenticated HTML over job data).


---

## 19. Error handling contract

Every error — from controllers, security filters and validation — uses one envelope
(`ApiErrorBody` in `frontend/lib/types.ts`):

```json
{
  "timestamp": 1760951643512,
  "status": 409,
  "error": "Conflict",
  "message": "Incident 6f1c… cannot move from RESOLVED to ALLOCATING",
  "errors": { "latitude": "Latitude must be between -90 and 90" }
}
```

| Status | Raised by | Frontend behaviour |
|---|---|---|
| `400` | Bean Validation (`errors` map), bad query param, unreadable body | Field errors shown inline |
| `401` | Missing/invalid/expired token, bad credentials | Session cleared → `/login?next=…` |
| `403` | Authenticated but insufficient role | "Your role does not permit this action" — **no** sign-out |
| `404` | Unknown id / business id | "Record not found." |
| `405` | Wrong HTTP verb | Generic message |
| `409` | Illegal lifecycle transition, closed registration, unavailable resource | Message + allowed set; the UI refreshes |
| `429` | Per-IP rate limit (with `Retry-After: 60`) | "Rate limit exceeded. Please retry in a minute." — **no** sign-out |
| `500` | Unexpected | Generic message + `correlationId` to quote in a ticket |

Security-filter rejections (401/403) are written by `SecurityConfig` with the *same* shape,
because exceptions raised inside the resource-server filters never reach
`@ControllerAdvice`. A 401 also carries `WWW-Authenticate: Bearer`.

**Why 403 and 429 must not sign the user out:** both mean "you are authenticated but this
attempt is not allowed". The axios layer distinguishes them via `isUnauthenticated` (401)
versus `isForbidden` (403).

---

## 20. Observability

### Health endpoints

| Endpoint | Auth | Content |
|---|---|---|
| `GET /api/v1/health` | public | Liveness + outbox counters + `eventDelivery` |
| `GET /actuator/health` | public | Aggregate health (DB, circuit breakers, rate limiters) |
| `GET /actuator/health/liveness` · `/readiness` | public | Kubernetes probes |
| `GET /actuator/info` | public | Build info |
| `GET /actuator/metrics` | authenticated | Micrometer metric catalogue |
| `GET /actuator/prometheus` | authenticated by default | Prometheus scrape |

`management.endpoint.health.show-details=when_authorized`, so detail is not leaked to
anonymous callers.

### Logging

- Console pattern: `timestamp [thread] LEVEL logger - msg`.
- `logging.level.com.pstu.backend=INFO`; Hibernate SQL at `WARN`; Redis client at `WARN`.
- `CorrelationIdFilter` (highest precedence) binds `X-Correlation-Id` to MDC, so every log
  line of a request — and of the events it produced — shares one id.
- `LoggingFilter` logs method, path, status and duration.

### Metrics worth alerting on

| Signal | Source | Suggested alert |
|---|---|---|
| Outbox backlog | `/api/v1/health` → `outboxPending` | Rising for > 2 min |
| Exhausted rows | `outboxGaveUp` | `> 0` |
| Delivery errors | `/pipeline/outbox` → `lastDeliveryError` | Any new value |
| JobRunr failures | Micrometer job metrics | Failure rate > baseline |
| HTTP latency | `http.server.requests` (percentile histogram on) | p99 regression |
| Rate-limited requests | Resilience4j metrics | Spike from one IP |
| Circuit breaker state | `resilience4j_circuitbreaker_state` | `open` |

### Console surfaces

The top bar carries a live **health indicator** polling `/api/v1/health`; it shows
`OK` / `DELAYED` / `ATTENTION` and degrades to a badge instead of blocking navigation. The
**API Explorer** screen lists every endpoint with its verb and the screen that exercises it,
plus the live backend status.

---

## 21. Frontend architecture

### Composition

```
app/layout.tsx (server)
 └─ <AppShell> ("use client")
      └─ <StoreProvider>              Redux store, memoised per browser session
           └─ <AuthProvider>          hydration, session-expiry, route guards
                ├─ <Sidebar> <Topbar> <MobileNav> <CommandPalette>
                ├─ <main id="main-content">   ← route content
                └─ <ToastViewport>
```

`/login` and `/register` render **chromeless** (no chrome): there is no identity yet, and
navigation would leak the product structure.

### Rendering strategy

The console is intentionally **client-rendered** — RTK Query seeds `dataUpdatedAt:
Date.now()` on first render, which Next.js rejects during prerender. Anything that reads
live data is therefore mounted inside `<ClientOnly>`, so the server sends stable markup and
hydration does not mismatch.

`next.config.ts` sets `output: "standalone"` (required by the Docker image),
`cacheComponents`, `partialPrefetching`, and the Turbopack CSS rule for Tailwind 4.

### Directory conventions

| Path | Convention |
|---|---|
| `app/<segment>/page.tsx` | `"use client"` route screen |
| `app/<segment>/layout.tsx` | Server component exporting route `metadata` only |
| `components/ui/*` | Presentational primitives, no data fetching |
| `components/layout/*` | Chrome: shell, sidebar, topbar, palette, health, user menu |
| `components/providers/*` | Context/providers (`StoreProvider`, `AuthProvider`, `ClientOnly`) |
| `lib/*` | Framework-free logic: axios, types, formatting, hooks |

All imports use the `@/*` alias (→ `frontend/*`).

> It is `layout.tsx` per route segment that supplies route titles: each one exports
> `metadata` such as `{ title: "Allocations" }`, which the root layout's `%s · EmergencyOps`
> template renders.

### Forms & feedback pattern

1. A `<Modal>` or drawer owns local form state.
2. Submit calls a generated mutation wrapped by `useMutationToast()`.
3. Success → toast + cache invalidation → dialog closes.
4. Failure → error toast with the normalised message; dialog stays open.
5. `unwrap()` rejects on every non-2xx, so `ok: true` means the server committed.

---

## 22. Routing & screen map

| Route | Screen | Primary endpoints | Notes |
|---|---|---|---|
| `/` | **Command Center** | `/incidents/active`, `/allocations/active`, `/resources`, `/hospitals`, `/health`, `POST /optimize/reoptimize-all` | Stat cards, triage board, map, one-click re-optimise |
| `/incidents` | **Incidents** | `/incidents` (paged), `/severity/*`, `/region`, transitions, re-prioritise | Registry + detail drawer with timeline |
| `/allocations` | **Allocations** | `/allocations` (active / by incident / summary), status, cancel | Dispatch dialog, lifecycle progression |
| `/resources` | **Resources** | `/resources`, available/type/region, status/location/load, failure/maintenance/restore | Fleet registry with load meters |
| `/hospitals` | **Hospitals** | `/hospitals`, beds, status | Capacity editing, occupancy |
| `/road-network` | **Road Network** | `/road-network`, status, travel info | Graph maintenance, closures |
| `/optimization` | **Optimization** | `POST /optimize/reoptimize-all`, `GET /optimize/incident/{id}` | Decisions table, ETA source, rationale |
| `/api-explorer` | **API Explorer** | `/health` | Endpoint catalogue + live status |
| `/users` | **Users** | `/users` CRUD | `ADMIN` only; guarded by route + API |
| `/login` | **Sign in** | `/auth/login`, `/auth/registration-status` | Chromeless; honours `?next=` |
| `/register` | **First administrator** | `/auth/register` | Chromeless; only while no account exists |

Navigation metadata lives in `lib/navigation.ts` (`NAV_SECTIONS`), grouped as
**Operations · Assets · Intelligence · Administration**, with per-item `roles` for
presentation filtering (`visibleNavSections`). The API remains the enforcement point.

### Global keyboard & UX affordances

- **⌘K / Ctrl+K** — command palette across all visible routes.
- **Skip to content** link as the first tab stop; `#main-content` is focusable.
- Route transition uses a 4px translate + fade (`animate-route-in`).
- Toasts stack to a maximum of four and are dismissible.

---

## 23. Data layer (RTK Query + axios)

### Two instances

| Instance | Base URL | Used by |
|---|---|---|
| `apiClient` | `NEXT_PUBLIC_API_BASE_URL` | Browser (all UI data), RTK Query |
| `serverApiClient` | `BACKEND_URL + /api/v1` or the same default | Server components / route handlers |

Both share a 20 s timeout, `Accept: application/json`, and `paramsSerializer: { indexes: null }`
so Spring `Pageable` params serialise as `sort=field,asc`.

### Custom base query

`lib/store/axios-base-query.ts` adapts axios into `BaseQueryFn`:

- Accepts both `data` (axios) and `body` (FetchArgs) payloads.
- Normalises every failure into `FetchBaseQueryError` — `FETCH_ERROR` for transport
  failures, `{ status, data }` for HTTP responses — so one error shape reaches the UI.
- Reuses `apiClient`, so auth headers and refresh-and-retry apply to every query.

### Refresh-and-retry (the critical interceptor)

```
response 401 ─┬─ login/refresh/logout  → no retry
              ├─ no refresh token      → clearSession() → emit erp:session-expired
              └─ refreshInFlight       → await the same promise (single-flight)
                    ├─ success → persist new pair → retry the original request once
                    └─ failure → clearSession() → emit erp:session-expired
```

A single in-flight refresh is essential: RTK Query can fire several requests at once, and
because the backend **rotates (and revokes)** the refresh token, four parallel refreshes
would log the user out three times.

`clearSession()` dispatches a DOM event (`erp:session-expired`) rather than importing the
store, avoiding a `store → api → axios → store` import cycle. `<AuthProvider>` listens.

### API slice — `lib/store/api.ts`

- One `builder.query` / `builder.mutation` per backend endpoint.
- 17 cache tags (`Incident`, `IncidentList`, `IncidentPage`, `IncidentActive`, `Resource`,
  `Allocation`, `Hospital`, `Road`, `Optimization`, `Pipeline`, `User`, `Health`, …).
- Mutations invalidate exactly the lists they changed, so screens refresh without polling.
- `resolveIncidentPrimaryKey` translates a business `incidentId` into the numeric key that
  `PATCH`/`DELETE` require — the console never guesses an identifier.

### Error normalisation — `lib/axios.ts`

`normalizeApiError()` yields:

| Field | Meaning |
|---|---|
| `status` | HTTP status (absent on transport failure) |
| `message` | Best available text (Spring `message` → `error` → axios message) |
| `fieldErrors` | Validation map for inline display |
| `isAuthError` | True for 401 **and** 403 |
| `isUnauthenticated` | True for 401 only → sign out |
| `isForbidden` | True for 403 only → keep the session |

Transport failures get an actionable message naming `NEXT_PUBLIC_API_BASE_URL`.

---

## 24. State management

`lib/store/store.ts` combines three reducers:

| Slice | State | Persisted |
|---|---|---|
| `api` (RTK Query) | Query/mutation cache keyed by endpoint + args | In memory (invalidated by tags) |
| `ui` | `sidebarCollapsed`, `paletteOpen`, `activeRegion`, `toasts[]` | Sidebar preference only (`eoc.sidebar.collapsed`) |
| `auth` | `user`, `accessToken`, `refreshToken`, `expiresAt`, `initialized` | Mirrors `localStorage['erp.session']` |

### `auth` slice

| Action | Effect |
|---|---|
| `hydrate()` | Loads the persisted session after mount (never during SSR) and sets `initialized` |
| `signIn(session)` | Sets state **and** writes `localStorage` |
| `signOut()` | Clears state **and** removes `localStorage` |
| `updateUser(user)` | Keeps the cached profile in sync after an admin changes the role |

### `ui` slice

| Action | Purpose |
|---|---|
| `toggleSidebar` / `setSidebarCollapsed` / `hydrateSidebar` | Persisted rail state |
| `setPaletteOpen` / `togglePalette` | ⌘K palette |
| `setActiveRegion` | Geo bounding box shared by region-aware screens |
| `pushToast` / `dismissToast` | Feedback stack (max 4) |

### Session persistence — `lib/auth/session.ts`

```json
{
  "accessToken": "eyJ…",
  "refreshToken": "b7f1…",
  "expiresAt": 1760952543512,
  "user": { "id": 1, "username": "admin", "roles": ["ADMIN"] }
}
```

- Stored under `erp.session` in `localStorage`; a record without `expiresAt > 0` is treated
  as signed out.
- `isAccessTokenExpiring()` uses a 15 s skew so refresh happens before a request fails.
- `isSafeNextPath()` rejects absolute, protocol-relative and backslash URLs — `?next=`
  comes from the URL, so following it blindly would be an open redirect.

> **Trade-off, stated plainly:** `localStorage` is readable by any script on the origin, so
> a successful XSS could exfiltrate tokens. Mitigations are short-lived access tokens,
> rotated refresh tokens, a strict CSP with no third-party script origins, and
> `frame-ancestors 'none'`.

---

## 25. UI component library

All primitives are hand-written, dependency-light, and consume semantic design tokens.

### `components/ui`

| Module | Exports | Purpose |
|---|---|---|
| `button.tsx` | `Button`, `LinkButton` | Variants/sizes, consistent focus ring |
| `card.tsx` | `Card`, `CardHeader`, `CardBody`, `CardFooter`, `StatCard` | Surfaces and KPI tiles |
| `badge.tsx` | `Badge`, `StatusBadge`, `SeverityBadge`, `MethodChip` | Status/severity colour mapping |
| `layout.tsx` | `PageHeader`, `Toolbar`, `Field`, `Input`, `Select`, `Textarea`, `EmptyState`, `ErrorState`, `Meter`, skeletons | Page scaffolding, form controls, states |
| `table.tsx` | `DataTable`, `Column<T>`, `KeyValue`, `Mono` | Sortable table with empty/loading states |
| `registry.tsx` | `RegistryTable`, `RegistryToolbar`, `RegistryFilterSelect` | The standard list screen (filter + sort + paginate) |
| `modal.tsx` | `Modal`, `ConfirmDialog` | Portal dialogs with focus trap + restore |
| `use-dialog-behavior.ts` | hook | Focus trap, `Escape`, scroll lock, return focus |
| `leaflet-map.tsx` | `MapPicker` | OSM tile map; tile origins allow-listed in the CSP |
| `coord-field.tsx` | `CoordField` | Map + lat/lon read-out |
| `key-value-editor.tsx` | `KeyValueEditor` | Edits the JSON maps (`conditions`, constraints) |
| `toast-viewport.tsx` | `ToastViewport` | Renders the toast stack from Redux |

### Screen-level components

| Module | Purpose |
|---|---|
| `layout/app-shell.tsx` | Providers + chrome; chromeless routes for `/login`, `/register` |
| `layout/sidebar.tsx` | Role-filtered sections, active badge count of active incidents |
| `layout/topbar.tsx` | Breadcrumb, palette trigger, health indicator, user menu |
| `layout/command-palette.tsx` | ⌘K navigation |
| `layout/health-indicator.tsx` | Live `/health` badge (`OK`/`DELAYED`/`ATTENTION`) |
| `layout/user-menu.tsx` | Identity, role hint, password dialog, sign out |
| `incidents/incident-detail.tsx` | Drawer: details, allocation summary, pipeline timeline |
| `auth/can.tsx` | `<Can roles={[...]}>` presentational role guard |

### Standard list screen pattern

```
<PageHeader/>                         title + actions
<StatCard/> × n                       KPIs computed client-side with useMemo
<RegistryToolbar/>                    search, filters, export
<RegistryTable columns={...}/>        generated columns, loading skeleton
  └─ detail drawer / edit modal       driven by row selection
```

`lib/use-registry.ts` supplies sorting, filtering and paging state; `lib/format.ts` supplies
`formatNumber`, `formatDateTime`, `formatRelative`, `formatCoord`, `percent`, `humanize`
and `SEVERITY_RANK`.

---

## 26. Session lifecycle

```
                 ┌──────────── mount ────────────┐
                 ▼                               │
   ┌──────────────────────┐   no session   ┌─────┴─────────────┐
   │ localStorage: erp.   │───────────────▶│  /login?next=path │
   │ session              │                └─────┬─────────────┘
   └──────────┬───────────┘                      │ credentials
              │ session found                    ▼
              ▼                          POST /auth/login
   hydrate() → initialized                     │ TokenResponse
              │                                 ▼
              ▼                          signIn() → localStorage
   route guards  ── role mismatch ──▶ "/"
              │
              ▼
   any request → 401 → refresh (single flight) → retry
                                   └─ fail → clearSession()
                                              → erp:session-expired
                                              → signOut() → /login?next=current
```

### Route guards (`components/providers/auth-provider.tsx`)

1. **Hydration first.** Guards wait for `initialized`, so the first paint never redirects.
2. **Unauthenticated + protected route** → `/login?next=<path>`; a 1.5 s hard-replace
   fallback covers a superseded router transition.
3. **Authenticated on `/login` or `/register`** → `/`.
4. **Role-restricted route** (`/users` → `ADMIN`) → `/` for other roles.
5. **`?next=` hardening.** The guard never forwards an existing `next` (that caused an
   unbounded `/login?next=%2Flogin…` growth loop), and `isSafeNextPath()` rejects
   off-origin targets.

Additional safeguards:

- `ProfileSync` refetches `/auth/me` so a role change is reflected without a re-login.
- `PasswordDialog` posts to `/auth/change-password` and, because all sessions are revoked,
  the client signs in again.
- Sign-out calls `/auth/logout` with the refresh token before clearing local state.

---

## 27. Design system & accessibility

### Dark-only operations console

The product is dark by design: `color-scheme: dark` is declared in the viewport export and
in `:root`, so native controls, scrollbars and mobile browser chrome are dark from the first
paint. Tokens live in `app/globals.css`.

| Token group | Examples |
|---|---|
| Canvas & layers | `--background #060a12`, `--surface #0c1420`, `--surface-muted`, `--surface-raised`, `--surface-overlay` |
| Borders | `--border-subtle #1d3047`, `--border-strong #2a4463` |
| Palette primitives | `slate-*`, `teal-*`, `rose-*`, `amber-*`, `emerald-*` |

The canvas is a deep, low-chroma navy so alarm colours (rose/amber/emerald) are the only
highly saturated pixels — instant scanning under pressure.

Typography is Geist and Geist Mono (`next/font/google`, self-hosted at build).

Leaflet's stylesheet is **bundled** (`@import "leaflet/dist/leaflet.css"`) rather than
fetched from a CDN: the CSP's `style-src` would block a third-party stylesheet, collapsing
the map.

### Accessibility checklist

| Concern | Implementation |
|---|---|
| Keyboard | Skip link first, ⌘K palette, full tab order through tables and dialogs |
| Dialogs | Portal + focus trap + `Escape` + focus restore (`useDialogBehavior`) |
| Focus visibility | Explicit focus rings on interactive elements |
| Semantics | Real `<table>`, `<button>`; `Field` associates label, control and error text |
| Live feedback | Toasts render through an `aria-live` viewport |
| Motion | Transition limited to a 4px translate + fade |
| Printing | `no-print` on footer/navigation so dashboards print cleanly |

### Formatting conventions (`lib/format.ts`)

- Numbers: locale-grouped (`formatNumber`).
- Times: absolute for records (`formatDateTime`), relative for "last updated" surfaces.
- Coordinates: compact fixed precision (`formatCoord`).
- Enums: `humanize("AT_CAPACITY")` → `"At capacity"`.

---

## 28. Testing

### Backend

```bash
cd backend
./mvnw test          # unit + context-load tests
./mvnw verify        # tests + packaging (CI)
```

Tests run against **H2 in memory**, so no PostgreSQL or Redis is needed. The context-load
test boots the full application.

| Area | Representative tests |
|---|---|
| Application context | `BackendApplicationTests.contextLoads` (boots with H2, H2-compatible JSON columns) |
| JWT | `JwtAuthenticationConverterTest` (role mapping, unknown roles ignored, missing claim) |
| Tokens | `TokenServiceTest` (rotation, expiry, short-secret startup failure) |
| Rate limiting | `RateLimitConfigTest` (per-client isolation, overflow bucket, forwarded headers) |
| Lifecycles | `LifecycleTest` (happy path, no reopen, terminal states) |
| Allocations | `AllocationIncidentTransitionTest` (first dispatch advances, repeats do not) |
| Ingest | `EventProcessingServiceTest` (dedupe, non-command skip, retryable vs not, topic list) |
| Pipeline | `EventEnvelopeTest`, `EventPublisherTest`, `EventOutboxRelayTest` |

A test asserts that the consumer topic list and the configured topics do **not** drift, and
that the failure topic is excluded.

### Frontend

```bash
cd frontend
npx tsc --noEmit     # type-check
npm run lint         # ESLint
npm run build        # production build (also validates next.config.ts)
test -f .next/standalone/server.js && echo "standalone OK"
```

There is no unit-test runner configured for the frontend; CI enforces types, lint and a
successful production build, which is what guards the shipped bundle.

### Manual verification checklist

- [ ] `GET /api/v1/health` returns `status: UP`
- [ ] Sign in, reload → session restored; sidebar preference remembered
- [ ] Create an incident → appears in the triage board with a priority score
- [ ] Illegal status move → `409` toast naming the allowed statuses
- [ ] `VIEWER` cannot see create/delete actions, and a forced call returns `403`
- [ ] Optimise → decisions show `ROAD_GRAPH` or `GEOMETRIC_FALLBACK`
- [ ] Stop Redis, create an incident → write succeeds, health shows `DELAYED`, `pending` > 0
- [ ] Restart Redis → backlog drains; timeline shows the events as `PUBLISHED`
- [ ] 6 wrong passwords → `429` with `Retry-After`, other users unaffected

---

## 29. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `app.jwt.secret is not set` at startup | `JWT_SECRET` missing/blank | `export JWT_SECRET=$(openssl rand -base64 48)` |
| `JWT_SECRET must be at least 32 bytes` | Key too short | Regenerate with `openssl rand -base64 48` |
| `url attribute is not specified` (startup) | Datasource placeholder unresolved | Set `DB_URL` |
| `Schema-validation: missing table` | `ddl-auto=validate` on an empty DB | Run once with `SPRING_JPA_HIBERNATE_DDL_AUTO=create` |
| `required a bean of type 'StorageProvider'` | JobRunr provider not pinned | Keep `jobrunr.database.type=sql` |
| `app.cors.allowed-origins must list exact origins` | A `*` in the CORS list | List each origin explicitly |
| Browser console: "Cannot reach the API" | Wrong API URL / backend down / CORS | Check `NEXT_PUBLIC_API_BASE_URL`, CORS origin, `X-Correlation-Id` |
| Map renders grey/empty | Leaflet CSS not loaded | Keep `@import "leaflet/dist/leaflet.css"` in `globals.css` |
| Every action logs the user out | Refresh rotation raced | Verify the single-flight `refreshInFlight` logic |
| `/login?next=/login` redirect loop | Guard forwarding an existing `next` | See `signInTarget` handling |
| Health shows `DELAYED` | Broker unreachable, events queued | Check `REDIS_HOST/PORT`; `GET /pipeline/outbox` → `lastDeliveryError` |
| `ATTENTION` persists | Rows exhausted retry budget | Inspect timeline, fix the cause, replay the event |
| JobRunr tables missing | `JOBRUNR_SKIP_CREATE=true` on a fresh DB | Set `false` for the first boot |
| Frontend build fails on CSP | `NEXT_PUBLIC_API_BASE_URL` not absolute | Provide a full URL, e.g. `https://api.example.com/api/v1` |
| `.next/standalone/server.js` missing | `output: "standalone"` removed | Restore it in `next.config.ts` |

### Where to look first

| Question | Source |
|---|---|
| Did the request reach the API? | `LoggingFilter` line with the `X-Correlation-Id` |
| What happened to one incident? | `GET /api/v1/pipeline/timeline/{incidentId}` |
| Why is nothing being published? | `GET /api/v1/pipeline/outbox` → `lastDeliveryError` |
| Why was this unit chosen? | `rationale` + `etaSource` on the optimisation decision |
| Why was a status change rejected? | The `409` body's message lists the allowed statuses |

---

## 30. Security posture & limitations

These are **known and documented** trade-offs, not undiscovered gaps.

| Area | Current state | Implication / mitigation |
|---|---|---|
| Token storage | JWT pair in `localStorage` | Readable by injected scripts; mitigated by short TTL, rotation and a strict CSP. httpOnly cookies would need CSRF protection |
| CSP | `'unsafe-inline'` for script/style | Required by Next.js bootstrap scripts and Tailwind; everything else is locked down |
| Rate limiting | In-process, per instance | With N instances the effective limit is N × configured. Move counters to Redis before scaling out |
| DDL management | Hibernate only (no Flyway/Liquibase) | Create once with `create`, then `validate`. Real migrations need a migration tool |
| Optimiser | Greedy heuristic | Not a global optimum; no composite multi-resource assignments |
| ETAs | Graph or straight-line | No live traffic feed; congestion is modelled by segment status factors |
| Event transport | Redis pub/sub + capped list | No replay-from-offset; the outbox table is the system of record |
| Event delivery | At-least-once | Consumers must stay idempotent (they dedupe on `eventId`) |
| Frontend tests | Typecheck + lint + build only | No component/e2e suite yet |
| JobRunr dashboard | Disabled | Use `/pipeline/*` and metrics instead |

---

## 31. Extension guide

### Add a REST endpoint

1. Add or extend the DTO in `dto/` with validation annotations.
2. Add the method to the relevant service (`@Transactional`).
3. Add the handler to the controller with the narrowest `@PreAuthorize`.
4. Map explicitly to a response DTO (never return entities).
5. Publish a domain fact via `EventPublisher` if the change matters downstream.
6. List the endpoint in `frontend/app/api-explorer/page.tsx`.

### Add a domain event

1. Add the constant to `DomainEventType` and its topic in `topic(...)`.
2. Decide whether it is a command (`isCommand()`) and whether it is replayable.
3. Publish with `EventEnvelope.of(...)` and a `correlationId`.
4. If it must be consumed, handle it in `EmergencyEventPipeline.handle`, and add the topic to
   `EVENTS_CONSUMER_PATTERN` **only** if this service should read it.
5. Add a test asserting the topic mapping.

### Add a console screen

1. `app/<segment>/layout.tsx` — server component exporting `metadata.title`.
2. `app/<segment>/page.tsx` — `"use client"`; wrap live content in `<ClientOnly>`.
3. Add endpoints to `lib/store/api.ts` with `providesTags` / `invalidatesTags`.
4. Add the route to `NAV_SECTIONS` in `lib/navigation.ts` (with `roles` if restricted).
5. Guard mutations with `<Can roles={[...]}>` — for UX only.

### Add a role

1. Add the enum constant in `enums/Role.java`.
2. Update `@PreAuthorize` expressions where the role should apply.
3. Mirror it in `frontend/lib/types.ts` (`ROLES`) and `lib/navigation.ts` (`ROLE_HINTS`).

---

## 32. Glossary

| Term | Meaning |
|---|---|
| **Aggregate** | A consistency boundary; here an incident, allocation, resource or hospital |
| **Outbox** | Table holding events written in the same transaction as the aggregate, until delivered |
| **Envelope** | The single wire format (`EventEnvelope`) wrapping every event |
| **Command** | An intent (`*_REQUESTED`) consumed by the ingest loop; never replayed |
| **Fact** | A statement that something happened (`*_CREATED`, `*_UPDATED`); replayable |
| **Correlation ID** | Identifier propagated from the originating request into every event and log line |
| **Idempotency marker** | The recorded `eventId` that makes redelivery a no-op |
| **DLT** | Dead-letter stream (`<failure-topic>.DLT`) for messages that cannot be applied |
| **ETA source** | `ROAD_GRAPH` or `GEOMETRIC_FALLBACK` — how an estimate was produced |
| **Anchor** | The road-network node nearest a coordinate, used as a routing endpoint |
| **Registry (UI)** | The standard list screen (toolbar + sortable table + drawer) |
| **Chromeless route** | A route rendered without sidebar/topbar (`/login`, `/register`) |
| **Bootstrap registration** | One-shot creation of the first `ADMIN` on an empty database |

---

<div align="center">

*EmergencyOps — Emergency Response & Resource Optimization Platform · Spring Boot 4.1 API + Next.js 16 console*

</div>


