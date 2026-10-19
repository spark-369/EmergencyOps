/**
 * TypeScript mirrors of the Spring Boot DTOs in
 * `backend/src/main/java/com/pstu/backend/{dto,entity,enums}`.
 *
 * The backend sets `spring.jackson.default-property-inclusion=non_null`, so every
 * nullable field may be absent from the payload. Properties are therefore optional
 * unless the controller marks them as required by validation.
 */

/* ------------------------------------------------------------------ enums */

export const ALLOCATION_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const INCIDENT_SEVERITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
  "CATASTROPHIC",
] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  "RECEIVED",
  "PRIORITIZED",
  "ALLOCATING",
  "IN_PROGRESS",
  "RESOLVED",
  "CANCELLED",
  "FAILED",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const RESOURCE_STATUSES = [
  "AVAILABLE",
  "BUSY",
  "MAINTENANCE",
  "OFFLINE",
  "DEPLOYED",
  "STANDBY",
] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export const RESOURCE_TYPES = [
  "AMBULANCE",
  "HOSPITAL",
  "RESCUE_TEAM",
  "HELICOPTER",
  "EMERGENCY_OPERATION_CENTER",
  "FIRE_TRUCK",
  "POLICE_UNIT",
  "SUPPLY_TRUCK",
  "VOLUNTEER_TEAM",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const HOSPITAL_STATUSES = [
  "OPERATIONAL",
  "AT_CAPACITY",
  "OVER_CAPACITY",
  "MAINTENANCE",
  "OFFLINE",
] as const;
export type HospitalStatus = (typeof HOSPITAL_STATUSES)[number];

export const ROAD_STATUSES = [
  "OPEN",
  "CLOSED",
  "DELAYED",
  "CONGESTED",
] as const;
export type RoadStatus = (typeof ROAD_STATUSES)[number];

/* ------------------------------------------------------------------ shared */

/** Free-form JSON object (`Map<String, Object>` on the backend). */
export type JsonMap = Record<string, unknown>;

/** Geo bounding box used by every `/region` endpoint. */
export interface RegionQuery {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Spring Data `Page<T>` envelope. */
export interface Page<T> {
  content: T[];
  pageable?: JsonMap;
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  first?: boolean;
  last?: boolean;
  numberOfElements?: number;
  empty?: boolean;
}

/** Body returned by `GlobalExceptionHandler`. */
export interface ApiErrorBody {
  timestamp?: number;
  status?: number;
  error?: string;
  message?: string;
  errors?: Record<string, string>;
  /**
   * Present on unexpected 500s only. The server logs the matching stack trace
   * under this id and deliberately omits the exception message.
   */
  correlationId?: string;
}

/* -------------------------------------------------------------------- auth */

/** Mirrors `com.pstu.backend.enums.Role`. Order is not significant. */
export const ROLES = ["ADMIN", "DISPATCHER", "FIELD_OPERATOR", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

/** Mirrors `UserResponse` — never contains the password hash. */
export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  roles: Role[];
  enabled: boolean;
}

/** Mirrors `LoginRequest`. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** Mirrors `TokenResponse`. `expiresIn` is seconds until the access token dies. */
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: AuthUser;
}

/** Mirrors `UserRequest` (ADMIN only). */
export interface UserRequest {
  username: string;
  password: string;
  displayName: string;
  role: Role;
  enabled?: boolean;
}

/** Mirrors `UserUpdateRequest`; omitted fields are left unchanged. */
export interface UserUpdateRequest {
  displayName?: string;
  password?: string;
  role?: Role;
  enabled?: boolean;
}

/** Mirrors `RegisterRequest` — first-run bootstrap only, no role field. */
export interface RegisterRequest {
  username: string;
  password: string;
  displayName: string;
}

/** Mirrors `RegistrationStatusResponse`. */
export interface RegistrationStatusResponse {
  registrationOpen: boolean;
}

/** Mirrors `ChangePasswordRequest`. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/* ------------------------------------------------------------------ health */

/**
 * Event-delivery state reported by `GET /health`.
 *
 * `OK` — outbox empty. `DELAYED` — events queued because the broker is
 * unreachable. `ATTENTION` — at least one event exhausted its retry budget and is
 * being re-offered on every relay pass. Both degradations are self-healing: the
 * outbox relay retries and nothing is lost, so neither is an API outage.
 */
export type EventDeliveryState = "OK" | "DELAYED" | "ATTENTION";

export interface HealthResponse {
  status?: string;
  /**
   * Backend detail map. The pipeline keys are `eventDelivery`
   * (`EventDeliveryState`), `outboxPending`, `outboxGaveUp`, `outboxFailed`,
   * `service` and `status`.
   */
  details?: Record<string, unknown>;
}

/* --------------------------------------------------------------- incidents */

export interface IncidentRequest {
  latitude: number;
  longitude: number;
  locationDescription: string;
  severity: IncidentSeverity;
  affectedPeople: number;
  timeSensitivityMinutes: number;
  resourceRequirements?: JsonMap;
  environmentalConditions?: JsonMap;
}

/** Nested `IncidentResponse.AllocationSummary`. */
export interface IncidentAllocationSummary {
  resourceId?: string;
  resourceType?: string;
  status?: AllocationStatus;
  estimatedTravelTimeMinutes?: number;
}

export interface Incident {
  /** JPA primary key — the `{id}` used by PATCH/DELETE `/incidents/{id}`. */
  id?: number;
  incidentId?: string;
  latitude?: number;
  longitude?: number;
  locationDescription?: string;
  severity?: IncidentSeverity;
  affectedPeople?: number;
  timeSensitivityMinutes?: number;
  resourceRequirements?: JsonMap;
  environmentalConditions?: JsonMap;
  status?: IncidentStatus;
  priorityScore?: number;
  estimatedResponseTimeMinutes?: number;
  createdAt?: string;
  updatedAt?: string;
  allocations?: IncidentAllocationSummary[];
}

/* --------------------------------------------------------------- resources */

export interface ResourceRequest {
  /**
   * No `resourceId` here: the backend generates the UUID on registration and
   * returns it in `Resource`. It used to be a required field that was then
   * discarded, so every payload omitting it was rejected with 400.
   */
  type: ResourceType;
  latitude: number;
  longitude: number;
  capacity: number;
  travelSpeedKmh: number;
  operationalConstraints?: JsonMap;
}

export interface Resource {
  /**
   * Numeric primary key — the `{id}` used by every mutating path
   * (`PATCH /resources/{id}/…`, `POST /{id}/failure`, `DELETE /resources/{id}`).
   */
  id?: number;
  /** Business identifier (UUID string). Used by `GET /resource-id/{resourceId}`. */
  resourceId?: string;
  type?: ResourceType;
  latitude?: number;
  longitude?: number;
  status?: ResourceStatus;
  capacity?: number;
  currentLoad?: number;
  travelSpeedKmh?: number;
  available?: boolean;
  operationalConstraints?: JsonMap;
  createdAt?: string;
  updatedAt?: string;
}

/* --------------------------------------------------------------- hospitals */

export interface HospitalRequest {
  hospitalId: string;
  name: string;
  latitude: number;
  longitude: number;
  totalBeds: number;
  icuCapacity: number;
  emergencyCapacity: number;
  status?: HospitalStatus;
}

export interface Hospital {
  /** Numeric primary key — used by every path variable of /hospitals. */
  id?: number;
  hospitalId?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  totalBeds?: number;
  availableBeds?: number;
  icuCapacity?: number;
  icuAvailable?: number;
  emergencyCapacity?: number;
  emergencyAvailable?: number;
  status?: HospitalStatus;
  createdAt?: string;
  updatedAt?: string;
}

/** Query params for `PATCH /hospitals/{id}/beds` (all optional). */
export interface BedUpdateQuery {
  availableBeds?: number;
  icuAvailable?: number;
  emergencyAvailable?: number;
}

/* ------------------------------------------------------------- allocations */

export interface AllocationRequest {
  incidentId: string;
  resourceId: string;
  estimatedTravelTimeMinutes: number;
  estimatedResolutionTimeMinutes: number;
  decisionRationale?: string;
}

export interface Allocation {
  /** Numeric primary key — used by every path variable of /allocations. */
  id?: number;
  incidentId?: string;
  resourceId?: string;
  status?: AllocationStatus;
  estimatedTravelTimeMinutes?: number;
  estimatedResolutionTimeMinutes?: number;
  decisionRationale?: string;
  allocatedAt?: string;
  arrivedAt?: string;
  completedAt?: string;
}

/** Response of `GET /allocations/incident/{incidentId}/summary`. */
export interface AllocationSummary {
  id?: number;
  incidentId?: string;
  resourceId?: string;
  resourceType?: string;
  status?: AllocationStatus;
  estimatedTravelTimeMinutes?: number;
  estimatedResolutionTimeMinutes?: number;
  decisionRationale?: string;
  allocatedAt?: string;
}

/* ------------------------------------------------------------ road network */

export interface RoadNetworkRequest {
  fromLocation: string;
  toLocation: string;
  fromLatitude: number;
  fromLongitude: number;
  toLatitude: number;
  toLongitude: number;
  distanceKm: number;
  travelTimeMinutes: number;
  status?: RoadStatus;
}

export interface RoadSegment {
  /** Numeric primary key — used by every path variable of /road-network. */
  id?: number;
  fromLocation?: string;
  toLocation?: string;
  fromLatitude?: number;
  fromLongitude?: number;
  toLatitude?: number;
  toLongitude?: number;
  distanceKm?: number;
  travelTimeMinutes?: number;
  status?: RoadStatus;
  lastUpdated?: string;
}

/** Query params for `PATCH /road-network/{id}` (both optional). */
export interface TravelInfoQuery {
  distanceKm?: number;
  travelTimeMinutes?: number;
}

/* ---------------------------------------------------------------- optimize */

/**
 * One row of a re-optimisation plan.
 *
 * `etaSource` records how the travel estimate was produced, so the console can
 * show confidence rather than a bare number: `ROAD_GRAPH` means the maintained
 * road network answered (closed and congested segments already priced in), while
 * `GEOMETRIC_FALLBACK` is the straight-line estimate used when the graph has no
 * route or its circuit breaker is open.
 */
export interface OptimizationDecision {
  incidentId?: string;
  incidentSeverity?: IncidentSeverity;
  incidentPriority?: number;
  allocatedResourceId?: string | null;
  resourceType?: ResourceType | null;
  estimatedTravelTimeMinutes?: number | null;
  /** Human-readable ETA band, e.g. `12–15 min` (road graph) or `~9 min`. */
  estimatedTravelTimeWindow?: string | null;
  etaSource?: EtaSource | null;
  /** Load of the selected unit when the decision was made. */
  unitCurrentLoad?: number | null;
  /** Capacity of the selected unit when the decision was made. */
  unitCapacity?: number | null;
  rationale?: string;
}

export type EtaSource = "ROAD_GRAPH" | "GEOMETRIC_FALLBACK";

/** Response of `POST /optimize/reoptimize-all`. */
export interface ReoptimizeResult {
  totalIncidents?: number;
  totalResources?: number;
  decisions?: OptimizationDecision[];
  /** Serialised as an ISO-8601 string (`java.util.Date`). */
  optimizedAt?: string;
}

/** Response of `GET /optimize/incident/{incidentId}`. */
export interface IncidentOptimization {
  incidentId?: string;
  incidentSeverity?: IncidentSeverity;
  incidentPriority?: number;
  recommendedResourceId?: string | null;
  resourceType?: ResourceType;
  estimatedTravelTimeMinutes?: number;
  estimatedTravelTimeWindow?: string;
  etaSource?: EtaSource;
  /** Load of the recommended unit when the decision was made. */
  unitCurrentLoad?: number | null;
  /** Capacity of the recommended unit when the decision was made. */
  unitCapacity?: number | null;
  rationale?: string;
}

/* ---------------------------------------------------------------- pipeline */

/**
 * Response of `GET /pipeline/outbox`.
 *
 * The transactional outbox holds every event until Kafka acknowledges it, so
 * these two numbers are the pipeline's health: `pending` rising means the broker
 * is unreachable (the relay is retrying), `gaveUp` means an event exhausted its
 * attempts and needs an operator to replay it.
 */
export interface OutboxStatus {
  /** Outbound facts the broker has not acknowledged, including exhausted rows. */
  pending?: number;
  /** Subset of `pending` that has burned through its retry budget. */
  gaveUp?: number;
  /** Facts the broker has acknowledged; bookkeeping rows are excluded. */
  published?: number;
  /** Broker address the producer is currently configured with. */
  broker?: string;
  /**
   * Most recent delivery failure, verbatim from `lastError`.
   *
   * This is the answer to "why is nothing PUBLISHED": an unreachable broker, a
   * missing topic or a rejected ACL all surface here rather than only in the
   * database.
   */
  lastDeliveryError?: string | null;
}

/** Delivery state of one stored event. */
export type PipelineDeliveryStatus = "PENDING" | "PUBLISHED" | "GAVE_UP" | "FAILED";

/**
 * What a stored row is. Only `OUTBOUND` is ever delivered; `PROCESSED` and
 * `FAILURE` are bookkeeping and are written as `PUBLISHED` so the relay ignores
 * them.
 */
export type PipelineMessageKind = "OUTBOUND" | "PROCESSED" | "FAILURE";

/** Row of `GET /pipeline/timeline/{aggregateId}` — one hop of an incident's history. */
export interface PipelineEventView {
  eventId?: string;
  /** `DomainEventType` name, e.g. `INCIDENT_CREATED`. */
  type?: string;
  kind?: PipelineMessageKind;
  correlationId?: string;
  status?: PipelineDeliveryStatus;
  attempts?: number;
  /** True once the retry budget is spent; the row is still retried. */
  exhausted?: boolean;
  /** Last delivery error, when an attempt has failed. */
  lastError?: string;
  occurredAt?: string;
  publishedAt?: string;
  /**
   * The stored event envelope, decoded server-side.
   *
   * This is what makes the timeline legible: `INCIDENT_STATUS_CHANGED` carries
   * `previousStatus` and `status`, `ALLOCATION_CREATED` carries the resource and
   * its ETA. Without it the console can only name the event type.
   *
   * `null` when the stored payload is absent or not a JSON object — the backend
   * tolerates a corrupt historical row rather than failing the whole response.
   */
  payload?: Record<string, unknown> | null;
}
