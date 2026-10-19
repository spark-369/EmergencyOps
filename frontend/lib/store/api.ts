import { createApi } from "@reduxjs/toolkit/query/react";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { axiosBaseQuery } from "@/lib/store/axios-base-query";
import { apiClient, normalizeApiError } from "@/lib/axios";

import type {
  Allocation,
  AllocationRequest,
  AllocationStatus,
  AllocationSummary,
  AuthUser,
  BedUpdateQuery,
  ChangePasswordRequest,
  HealthResponse,
  Hospital,
  HospitalRequest,
  HospitalStatus,
  Incident,
  IncidentOptimization,
  IncidentRequest,
  IncidentSeverity,
  IncidentStatus,
  LoginRequest,
  OutboxStatus,
  Page,
  PipelineEventView,
  RegionQuery,
  RegisterRequest,
  RegistrationStatusResponse,
  Resource,
  ResourceRequest,
  ResourceStatus,
  ResourceType,
  ReoptimizeResult,
  RoadNetworkRequest,
  RoadSegment,
  RoadStatus,
  TokenResponse,
  TravelInfoQuery,
  UserRequest,
  UserUpdateRequest,
} from "@/lib/types";

/**
 * Every tag list below maps 1:1 to a Spring controller so mutations can
 * invalidate precisely what they changed.
 */
const TAGS = [
  "Health",
  "Incident",
  "IncidentActive",
  "IncidentPage",
  "IncidentList",
  "Resource",
  "ResourceList",
  "Hospital",
  "HospitalList",
  "Allocation",
  "AllocationList",
  "Road",
  "RoadList",
  "Optimization",
  "Pipeline",
  "User",
  "UserList",
] as const;

export type ApiTag = (typeof TAGS)[number];

/**
 * `invalidatesTags` / `providesTags` expect `ApiTag[]`, so the shared lists are
 * annotated explicitly — without the annotation TypeScript widens each literal
 * to `string[]`, which is not assignable to the generated tag union.
 */
const INCIDENT_LIST_TAG: ApiTag[] = ["IncidentList", "IncidentActive", "IncidentPage"];
const INCIDENT_MUTATION_TAGS: ApiTag[] = ["Incident", "IncidentList", "IncidentPage"];

const RESOURCE_LIST_TAG: ApiTag[] = ["ResourceList"];
const RESOURCE_MUTATION_TAGS: ApiTag[] = ["Resource", "ResourceList"];

const HOSPITAL_MUTATION_TAGS: ApiTag[] = ["Hospital", "HospitalList"];

const ALLOCATION_LIST_TAG: ApiTag[] = ["AllocationList"];
const ALLOCATION_MUTATION_TAGS: ApiTag[] = ["Allocation", "AllocationList"];

const ROAD_MUTATION_TAGS: ApiTag[] = ["Road", "RoadList"];

/**
 * Resolves the numeric primary key of an incident from its business ID.
 *
 * `IncidentResponse` exposes both `id` (JPA key) and `incidentId` (business
 * UUID), but `PATCH|DELETE /incidents/{id}` only accept the numeric key, and
 * some call sites (QR codes, deep links, incident reports) only carry the
 * business ID. This helper performs the lookup and returns either the resolved
 * key or a descriptive `FetchBaseQueryError`, so the caller never fires a
 * request with a guessed identifier.
 */
async function resolveIncidentPrimaryKey(
  incidentId: string,
): Promise<{ data: number } | { error: FetchBaseQueryError }> {
  try {
    const { data } = await apiClient.get<{ id?: number }>(
      `/incidents/incident-id/${encodeURIComponent(incidentId)}`,
    );
    if (typeof data?.id === "number") return { data: data.id };
    return {
      error: {
        status: "CUSTOM_ERROR",
        error: `Incident ${incidentId} has no numeric primary key in the response.`,
        data:
          "The backend answered without an `id` field, so /incidents/{id} cannot be addressed. " +
          "Verify the backend version exposes `id` in IncidentResponse.",
      },
    };
  } catch (error) {
    // Distinguish "this incident does not exist" from a backend/CORS/auth
    // failure, which previously all surfaced as "No incident exists".
    const normalized = normalizeApiError(error);
    return {
      error:
        normalized.status === undefined
          ? { status: "FETCH_ERROR", error: normalized.message }
          : {
              status: normalized.status,
              data: { message: normalized.message },
            },
    };
  }
}

export const api = createApi({
  reducerPath: "api",
  baseQuery: axiosBaseQuery(),
  tagTypes: TAGS,
  // Cache lifetime for unsubscribed data (seconds).
  keepUnusedDataFor: 60,
  endpoints: (builder) => ({
    /* ----------------------------------------------------------- health */

    /** GET /api/v1/health */
    getHealth: builder.query<HealthResponse, void>({
      query: () => ({ url: "/health" }),
      providesTags: ["Health"],
    }),

    /* --------------------------------------------------------------- auth */

    /**
     * POST /api/v1/auth/login
     *
     * The token pair is returned to the caller rather than stored here: session
     * persistence is the `auth` slice's job, and keeping it out of the cache means
     * `resetApiState()` can never silently drop the user's session.
     */
    login: builder.mutation<TokenResponse, LoginRequest>({
      query: (body) => ({ url: "/auth/login", method: "POST", data: body }),
    }),

    /** POST /api/v1/auth/refresh — normally handled by the axios interceptor. */
    refresh: builder.mutation<TokenResponse, { refreshToken: string }>({
      query: (body) => ({ url: "/auth/refresh", method: "POST", data: body }),
    }),

    logout: builder.mutation<void, { refreshToken: string } | void>({
      query: (body) => ({ url: "/auth/logout", method: "POST", data: body ?? {} }),
    }),

    /** GET /api/v1/auth/me — re-reads the profile, e.g. after a role change. */
    me: builder.query<AuthUser, void>({
      query: () => ({ url: "/auth/me" }),
      providesTags: ["User"],
    }),

    /** POST /api/v1/auth/change-password — revokes every other session. */
    changePassword: builder.mutation<void, ChangePasswordRequest>({
      query: (body) => ({ url: "/auth/change-password", method: "POST", data: body }),
    }),

    /**
     * GET /api/v1/auth/registration-status — public.
     *
     * Drives whether the login screen offers the first-run link. It never provides
     * long-lived cached data, so `keepUnusedDataFor: 0` avoids showing a stale
     * "registration open" after the account has been created.
     */
    registrationStatus: builder.query<RegistrationStatusResponse, void>({
      query: () => ({ url: "/auth/registration-status" }),
      keepUnusedDataFor: 0,
    }),

    /** POST /api/v1/auth/register — first-run bootstrap; 409 once an account exists. */
    register: builder.mutation<AuthUser, RegisterRequest>({
      query: (body) => ({ url: "/auth/register", method: "POST", data: body }),
    }),

    /* -------------------------------------------------------------- users */

    listUsers: builder.query<AuthUser[], void>({
      query: () => ({ url: "/users" }),
      providesTags: ["UserList"],
    }),

    createUser: builder.mutation<AuthUser, UserRequest>({
      query: (body) => ({ url: "/users", method: "POST", data: body }),
      invalidatesTags: ["UserList"],
    }),

    updateUser: builder.mutation<AuthUser, { id: number; body: UserUpdateRequest }>({
      query: ({ id, body }) => ({ url: `/users/${id}`, method: "PATCH", data: body }),
      invalidatesTags: ["UserList", "User"],
    }),

    /**
     * GET /api/v1/users/{id} (ADMIN only).
     *
     * Tagged `User` rather than `UserList`: this backs an account lookup, and a
     * `UserList` tag would make it refetch whenever an unrelated account is
     * created or edited.
     */
    getUserById: builder.query<AuthUser, number>({
      query: (id) => ({ url: `/users/${id}` }),
      providesTags: ["User"],
    }),

    deleteUser: builder.mutation<void, number>({
      query: (id) => ({ url: `/users/${id}`, method: "DELETE" }),
      invalidatesTags: ["UserList"],
    }),

    /* -------------------------------------------------------- incidents */

    /** POST /api/v1/incidents */
    createIncident: builder.mutation<Incident, IncidentRequest>({
      query: (body) => ({ url: "/incidents", method: "POST", data: body }),
      invalidatesTags: INCIDENT_MUTATION_TAGS,
    }),

    /** GET /api/v1/incidents?page&size&sort */
    getAllIncidents: builder.query<
      Page<Incident>,
      { page?: number; size?: number; sort?: string } | void
    >({
      query: (args) => ({
        url: "/incidents",
        params: {
          page: args?.page ?? 0,
          size: args?.size ?? 20,
          sort: args?.sort ?? "priorityScore,desc",
        },
      }),
      providesTags: ["IncidentPage"],
    }),

    /** GET /api/v1/incidents/{id} — JPA primary key, used by the ID lookup. */
    getIncidentById: builder.query<Incident, number>({
      query: (id) => ({ url: `/incidents/${id}` }),
      providesTags: ["Incident"],
    }),

    /** GET /api/v1/incidents/incident-id/{incidentId} */
    getIncidentByIncidentId: builder.query<Incident, string>({
      query: (incidentId) => ({
        url: `/incidents/incident-id/${encodeURIComponent(incidentId)}`,
      }),
      providesTags: ["Incident"],
    }),

    /** GET /api/v1/incidents/active */
    getActiveIncidents: builder.query<Incident[], void>({
      query: () => ({ url: "/incidents/active" }),
      providesTags: ["IncidentActive", "IncidentList"],
    }),

    /** GET /api/v1/incidents/severity/{severity} */
    getIncidentsBySeverity: builder.query<Incident[], IncidentSeverity>({
      query: (severity) => ({ url: `/incidents/severity/${severity}` }),
      providesTags: ["IncidentList"],
    }),

    /** GET /api/v1/incidents/region?minLat&maxLat&minLon&maxLon */
    getIncidentsInRegion: builder.query<Incident[], RegionQuery>({
      query: (region) => ({ url: "/incidents/region", params: region }),
      providesTags: ["IncidentList"],
    }),

    /**
     * GET /api/v1/incidents/incident-id/{incidentId}/allowed-transitions
     *
     * The statuses the backend will actually accept next. The incident lifecycle
     * is a closed graph (see `IncidentLifecycle`), so offering every value of
     * `INCIDENT_STATUSES` in a dropdown invites a 409. This lets the dialog show
     * only the legal moves.
     */
    getAllowedIncidentTransitions: builder.query<IncidentStatus[], string>({
      query: (incidentId) => ({
        url: `/incidents/incident-id/${encodeURIComponent(incidentId)}/allowed-transitions`,
      }),
      // Not keyed by incident: the tag is coarse, which is deliberate — a status
      // change invalidates it, so the list refreshes after every transition.
      providesTags: ["Incident"],
    }),

    /**
     * PATCH /api/v1/incidents/{id}/status?status=
     *
     * <p>Addressed by business `incidentId`. `IncidentResponse` exposes the JPA `id`
     * too, but the console never holds it for a status change, and the variant that
     * took one was never called — so this is the single entry point. Resolving the key
     * here also means a caller cannot PATCH the wrong incident by mixing the two id
     * spaces.
     */
    updateIncidentStatusByIncidentId: builder.mutation<
      Incident,
      { incidentId: string; status: IncidentStatus }
    >({
      queryFn: async ({ incidentId, status }, _api, _extra, baseQuery) => {
        const resolved = await resolveIncidentPrimaryKey(incidentId);
        if ("error" in resolved) return { error: resolved.error };
        const query = await baseQuery({
          url: `/incidents/${resolved.data}/status`,
          method: "PATCH",
          params: { status },
        });
        // `BaseQueryResult` is a union; narrow on the discriminant instead of
        // relying on truthiness so `data`/`error` keep their real types.
        if ("error" in query && query.error !== undefined) {
          return { error: query.error };
        }
        return { data: query.data as Incident };
      },
      invalidatesTags: INCIDENT_MUTATION_TAGS,
    }),

    /**
     * DELETE /api/v1/incidents/{id} addressed by business incidentId.
     *
     * <p>Declared as `null`, not `void`: the endpoint answers `204 No Content`, and
     * a `queryFn` must return a result object. `data: null` is a present value that
     * survives RTK Query's validation, whereas `data: undefined` is serialised away
     * (leaving `{}`, which RTK Query rejects at runtime) and `null` is not
     * assignable to `void` (which fails to compile). Either way the payload is
     * meaningless for a 204 — call sites use `isSuccess`, not `data`.
     */
    deleteIncidentByIncidentId: builder.mutation<null, string>({
      queryFn: async (incidentId, _api, _extra, baseQuery) => {
        const resolved = await resolveIncidentPrimaryKey(incidentId);
        if ("error" in resolved) return { error: resolved.error };
        const query = await baseQuery({
          url: `/incidents/${resolved.data}`,
          method: "DELETE",
        });
        if ("error" in query && query.error !== undefined) {
          return { error: query.error };
        }
        return { data: null };
      },
      invalidatesTags: INCIDENT_MUTATION_TAGS,
    }),

    /** POST /api/v1/incidents/{id}/reassign-priority addressed by incidentId. */
    reassignIncidentPriorityByIncidentId: builder.mutation<Incident, string>({
      queryFn: async (incidentId, _api, _extra, baseQuery) => {
        const resolved = await resolveIncidentPrimaryKey(incidentId);
        if ("error" in resolved) return { error: resolved.error };
        const query = await baseQuery({
          url: `/incidents/${resolved.data}/reassign-priority`,
          method: "POST",
        });
        if ("error" in query && query.error !== undefined) {
          return { error: query.error };
        }
        return { data: query.data as Incident };
      },
      invalidatesTags: INCIDENT_MUTATION_TAGS,
    }),

    /* -------------------------------------------------------- resources */

    /** POST /api/v1/resources */
    createResource: builder.mutation<Resource, ResourceRequest>({
      query: (body) => ({ url: "/resources", method: "POST", data: body }),
      invalidatesTags: RESOURCE_MUTATION_TAGS,
    }),

    /** GET /api/v1/resources */
    getAllResources: builder.query<Resource[], void>({
      query: () => ({ url: "/resources" }),
      providesTags: ["ResourceList"],
    }),

    /** GET /api/v1/resources/{id} — note: `id` is numeric in this endpoint path */
    getResourceById: builder.query<Resource, number>({
      query: (id) => ({ url: `/resources/${id}` }),
      providesTags: ["Resource"],
    }),

    /** GET /api/v1/resources/resource-id/{resourceId} */
    getResourceByResourceId: builder.query<Resource, string>({
      query: (resourceId) => ({
        url: `/resources/resource-id/${encodeURIComponent(resourceId)}`,
      }),
      providesTags: ["Resource"],
    }),

    /** GET /api/v1/resources/available */
    getAvailableResources: builder.query<Resource[], void>({
      query: () => ({ url: "/resources/available" }),
      providesTags: ["ResourceList"],
    }),

    /** GET /api/v1/resources/type/{type} */
    getResourcesByType: builder.query<Resource[], ResourceType>({
      query: (type) => ({ url: `/resources/type/${type}` }),
      providesTags: ["ResourceList"],
    }),

    /** GET /api/v1/resources/region?minLat&maxLat&minLon&maxLon */
    getResourcesInRegion: builder.query<Resource[], RegionQuery>({
      query: (region) => ({ url: "/resources/region", params: region }),
      providesTags: ["ResourceList"],
    }),

    /** PATCH /api/v1/resources/{id}/status?status= */
    updateResourceStatus: builder.mutation<
      Resource,
      { id: number; status: ResourceStatus }
    >({
      query: ({ id, status }) => ({
        url: `/resources/${id}/status`,
        method: "PATCH",
        params: { status },
      }),
      invalidatesTags: RESOURCE_MUTATION_TAGS,
    }),

    /** PATCH /api/v1/resources/{id}/location?latitude&longitude */
    updateResourceLocation: builder.mutation<
      Resource,
      { id: number; latitude: number; longitude: number }
    >({
      query: ({ id, latitude, longitude }) => ({
        url: `/resources/${id}/location`,
        method: "PATCH",
        params: { latitude, longitude },
      }),
      invalidatesTags: RESOURCE_MUTATION_TAGS,
    }),

    /** PATCH /api/v1/resources/{id}/load?currentLoad= */
    updateResourceLoad: builder.mutation<
      Resource,
      { id: number; currentLoad: number }
    >({
      query: ({ id, currentLoad }) => ({
        url: `/resources/${id}/load`,
        method: "PATCH",
        params: { currentLoad },
      }),
      invalidatesTags: RESOURCE_MUTATION_TAGS,
    }),

    /** POST /api/v1/resources/{id}/failure — returns 200 with empty body */
    reportResourceFailure: builder.mutation<void, number>({
      query: (id) => ({ url: `/resources/${id}/failure`, method: "POST" }),
      invalidatesTags: RESOURCE_MUTATION_TAGS,
    }),

    /** POST /api/v1/resources/{id}/maintenance — returns 200 with empty body */
    reportResourceMaintenance: builder.mutation<void, number>({
      query: (id) => ({ url: `/resources/${id}/maintenance`, method: "POST" }),
      invalidatesTags: RESOURCE_MUTATION_TAGS,
    }),

    /** POST /api/v1/resources/{id}/restore — returns 200 with empty body */
    restoreResource: builder.mutation<void, number>({
      query: (id) => ({ url: `/resources/${id}/restore`, method: "POST" }),
      invalidatesTags: RESOURCE_MUTATION_TAGS,
    }),

    /** DELETE /api/v1/resources/{id} — 204 No Content */
    deleteResource: builder.mutation<void, number>({
      query: (id) => ({ url: `/resources/${id}`, method: "DELETE" }),
      invalidatesTags: RESOURCE_MUTATION_TAGS,
    }),

    /* -------------------------------------------------------- hospitals */

    /** POST /api/v1/hospitals */
    registerHospital: builder.mutation<Hospital, HospitalRequest>({
      query: (body) => ({ url: "/hospitals", method: "POST", data: body }),
      invalidatesTags: HOSPITAL_MUTATION_TAGS,
    }),

    /** GET /api/v1/hospitals */
    getAllHospitals: builder.query<Hospital[], void>({
      query: () => ({ url: "/hospitals" }),
      providesTags: ["HospitalList"],
    }),

    /** GET /api/v1/hospitals/{id} */
    getHospitalById: builder.query<Hospital, number>({
      query: (id) => ({ url: `/hospitals/${id}` }),
      providesTags: ["Hospital"],
    }),

    /** GET /api/v1/hospitals/hospital-id/{hospitalId} */
    getHospitalByHospitalId: builder.query<Hospital, string>({
      query: (hospitalId) => ({
        url: `/hospitals/hospital-id/${encodeURIComponent(hospitalId)}`,
      }),
      providesTags: ["Hospital"],
    }),

    /** GET /api/v1/hospitals/available */
    getAvailableHospitals: builder.query<Hospital[], void>({
      query: () => ({ url: "/hospitals/available" }),
      providesTags: ["HospitalList"],
    }),

    /** GET /api/v1/hospitals/region?minLat&maxLat&minLon&maxLon */
    getHospitalsInRegion: builder.query<Hospital[], RegionQuery>({
      query: (region) => ({ url: "/hospitals/region", params: region }),
      providesTags: ["HospitalList"],
    }),

    /** PATCH /api/v1/hospitals/{id}/status?status= */
    updateHospitalStatus: builder.mutation<
      Hospital,
      { id: number; status: HospitalStatus }
    >({
      query: ({ id, status }) => ({
        url: `/hospitals/${id}/status`,
        method: "PATCH",
        params: { status },
      }),
      invalidatesTags: HOSPITAL_MUTATION_TAGS,
    }),

    /** PATCH /api/v1/hospitals/{id}/beds?availableBeds&icuAvailable&emergencyAvailable */
    updateHospitalBeds: builder.mutation<
      Hospital,
      { id: number; beds: BedUpdateQuery }
    >({
      query: ({ id, beds }) => ({
        url: `/hospitals/${id}/beds`,
        method: "PATCH",
        params: beds,
      }),
      invalidatesTags: HOSPITAL_MUTATION_TAGS,
    }),

    /** DELETE /api/v1/hospitals/{id} — 204 No Content */
    deleteHospital: builder.mutation<void, number>({
      query: (id) => ({ url: `/hospitals/${id}`, method: "DELETE" }),
      invalidatesTags: HOSPITAL_MUTATION_TAGS,
    }),

    /* ------------------------------------------------------ allocations */

    /** POST /api/v1/allocations — 201 Created */
    allocateResource: builder.mutation<Allocation, AllocationRequest>({
      query: (body) => ({ url: "/allocations", method: "POST", data: body }),
      invalidatesTags: [
        ...ALLOCATION_MUTATION_TAGS,
        ...RESOURCE_LIST_TAG,
        ...INCIDENT_LIST_TAG,
      ],
    }),

    /** GET /api/v1/allocations/{id} */
    getAllocationById: builder.query<Allocation, number>({
      query: (id) => ({ url: `/allocations/${id}` }),
      providesTags: ["Allocation"],
    }),

    /** GET /api/v1/allocations/incident/{incidentId} */
    getAllocationsByIncident: builder.query<Allocation[], string>({
      query: (incidentId) => ({
        url: `/allocations/incident/${encodeURIComponent(incidentId)}`,
      }),
      providesTags: ["AllocationList"],
    }),

    /** GET /api/v1/allocations/active (PENDING only, oldest first) */
    getActiveAllocations: builder.query<Allocation[], void>({
      query: () => ({ url: "/allocations/active" }),
      providesTags: ["AllocationList"],
    }),

    /** PATCH /api/v1/allocations/{id}/status?status= */
    updateAllocationStatus: builder.mutation<
      Allocation,
      { id: number; status: AllocationStatus }
    >({
      query: ({ id, status }) => ({
        url: `/allocations/${id}/status`,
        method: "PATCH",
        params: { status },
      }),
      invalidatesTags: [
        ...ALLOCATION_MUTATION_TAGS,
        ...RESOURCE_LIST_TAG,
        ...INCIDENT_LIST_TAG,
      ],
    }),

    /** POST /api/v1/allocations/{id}/cancel */
    cancelAllocation: builder.mutation<Allocation, number>({
      query: (id) => ({ url: `/allocations/${id}/cancel`, method: "POST" }),
      invalidatesTags: [
        ...ALLOCATION_MUTATION_TAGS,
        ...RESOURCE_LIST_TAG,
        ...INCIDENT_LIST_TAG,
      ],
    }),

    /** GET /api/v1/allocations/incident/{incidentId}/summary */
    getAllocationSummaryByIncident: builder.query<AllocationSummary[], string>({
      query: (incidentId) => ({
        url: `/allocations/incident/${encodeURIComponent(incidentId)}/summary`,
      }),
      providesTags: ["AllocationList"],
    }),

    /* ----------------------------------------------------- road network */

    /** POST /api/v1/road-network — 201 Created */
    createRoadSegment: builder.mutation<RoadSegment, RoadNetworkRequest>({
      query: (body) => ({
        url: "/road-network",
        method: "POST",
        data: body,
      }),
      invalidatesTags: ROAD_MUTATION_TAGS,
    }),

    /** GET /api/v1/road-network */
    getAllRoadSegments: builder.query<RoadSegment[], void>({
      query: () => ({ url: "/road-network" }),
      providesTags: ["RoadList"],
    }),

    /** GET /api/v1/road-network/{id} */
    getRoadSegmentById: builder.query<RoadSegment, number>({
      query: (id) => ({ url: `/road-network/${id}` }),
      providesTags: ["Road"],
    }),

    /** GET /api/v1/road-network/status/{status} */
    getRoadSegmentsByStatus: builder.query<RoadSegment[], RoadStatus>({
      query: (status) => ({ url: `/road-network/status/${status}` }),
      providesTags: ["RoadList"],
    }),

    /** GET /api/v1/road-network/route?fromLocation&toLocation */
    getRoadSegmentsBetweenLocations: builder.query<
      RoadSegment[],
      { fromLocation: string; toLocation: string }
    >({
      query: (params) => ({ url: "/road-network/route", params }),
      providesTags: ["RoadList"],
    }),

    /** PATCH /api/v1/road-network/{id}/status?status= */
    updateRoadStatus: builder.mutation<
      RoadSegment,
      { id: number; status: RoadStatus }
    >({
      query: ({ id, status }) => ({
        url: `/road-network/${id}/status`,
        method: "PATCH",
        params: { status },
      }),
      invalidatesTags: ROAD_MUTATION_TAGS,
    }),

    /** PATCH /api/v1/road-network/{id}?distanceKm&travelTimeMinutes */
    updateTravelInfo: builder.mutation<
      RoadSegment,
      { id: number; travelInfo: TravelInfoQuery }
    >({
      query: ({ id, travelInfo }) => ({
        url: `/road-network/${id}`,
        method: "PATCH",
        params: travelInfo,
      }),
      invalidatesTags: ROAD_MUTATION_TAGS,
    }),

    /** DELETE /api/v1/road-network/{id} — 204 No Content */
    deleteRoadSegment: builder.mutation<void, number>({
      query: (id) => ({ url: `/road-network/${id}`, method: "DELETE" }),
      invalidatesTags: ROAD_MUTATION_TAGS,
    }),

    /* -------------------------------------------------------- optimize */

    /** POST /api/v1/optimize/reoptimize-all */
    reoptimizeAll: builder.mutation<ReoptimizeResult, void>({
      query: () => ({ url: "/optimize/reoptimize-all", method: "POST" }),
      invalidatesTags: ["Optimization", ...ALLOCATION_LIST_TAG, ...INCIDENT_LIST_TAG],
    }),

    /** GET /api/v1/optimize/incident/{incidentId} */
    optimizeForIncident: builder.query<IncidentOptimization, string>({
      query: (incidentId) => ({
        url: `/optimize/incident/${encodeURIComponent(incidentId)}`,
      }),
      providesTags: ["Optimization"],
    }),

    /* ---------------------------------------------------------- pipeline */

    /**
     * GET /api/v1/pipeline/outbox
     *
     * What the transactional outbox still owes the broker. `pending` counts every
     * outbound fact the broker has not acknowledged and *includes* `gaveUp`, which
     * is the subset that has burned through its retry budget and is still re-offered
     * each relay pass. `published` excludes bookkeeping rows (processed commands and
     * `PROCESSING_FAILED` logs), so it means "facts that really reached Kafka".
     */
    getOutboxStatus: builder.query<OutboxStatus, void>({
      query: () => ({ url: "/pipeline/outbox" }),
      providesTags: ["Pipeline"],
    }),

    /**
     * GET /api/v1/pipeline/timeline/{aggregateId}
     *
     * Every event recorded for one incident, oldest first — the audit trail of
     * report → dispatch → arrival → resolution, including the correlation id that
     * ties it to the originating HTTP request.
     */
    getPipelineTimeline: builder.query<PipelineEventView[], string>({
      query: (aggregateId) => ({
        url: `/pipeline/timeline/${encodeURIComponent(aggregateId)}`,
      }),
      providesTags: ["Pipeline"],
    }),

    /**
     * GET /api/v1/pipeline/events?type=&limit=
     *
     * All recorded events of one `DomainEventType`, newest first. Pairs with the
     * replay endpoint: an operator filters to `PROCESSING_FAILED` to find the event
     * id worth re-sending.
     *
     * `type` is a plain string rather than a TS enum: the catalogue lives in the
     * backend (`DomainEventType`) and would drift the moment a new fact type is
     * added. An unknown name is rejected there with 400.
     */
    getPipelineEvents: builder.query<
      PipelineEventView[],
      { type: string; limit?: number }
    >({
      query: ({ type, limit }) => ({
        url: "/pipeline/events",
        params: { type, limit: limit ?? 50 },
      }),
      providesTags: ["Pipeline"],
    }),

    /**
     * POST /api/v1/pipeline/outbox/flush
     *
     * Forces one relay pass instead of waiting for the 15 s schedule. Useful right
     * after a broker outage, when the backlog is known to be deliverable.
     */
    flushOutbox: builder.mutation<{ delivered: number; pending: number }, void>({
      query: () => ({ url: "/pipeline/outbox/flush", method: "POST" }),
      invalidatesTags: ["Pipeline"],
    }),

    /**
     * POST /api/v1/pipeline/replay/{eventId}
     *
     * Re-publishes a stored event, keeping its original event id so consumers that
     * already applied it treat the copy as a duplicate. Answers 503 when the broker
     * still refuses, which is why the result carries `delivered` rather than relying
     * on the status code alone.
     */
    replayPipelineEvent: builder.mutation<{ eventId: string; delivered: boolean }, string>({
      query: (eventId) => ({
        url: `/pipeline/replay/${encodeURIComponent(eventId)}`,
        method: "POST",
      }),
      invalidatesTags: ["Pipeline"],
    }),
  }),
});

/**
 * Auto-generated hooks for every endpoint above. Each `GET` has a `useQuery`
 * variant (plus lazy/prefer-cache) and every `POST/PATCH/DELETE` has a
 * `useMutation` trigger.
 */
export const {
  // health
  useGetHealthQuery,
  // auth
  useLoginMutation,
  useRefreshMutation,
  useLogoutMutation,
  useMeQuery,
  useChangePasswordMutation,
  useRegistrationStatusQuery,
  useRegisterMutation,
  // users
  useListUsersQuery,
  useGetUserByIdQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,
  // incidents
  useCreateIncidentMutation,
  useGetAllIncidentsQuery,
  useGetIncidentByIdQuery,
  useGetIncidentByIncidentIdQuery,
  useGetActiveIncidentsQuery,
  useGetIncidentsBySeverityQuery,
  useGetIncidentsInRegionQuery,
  useGetAllowedIncidentTransitionsQuery,
  useUpdateIncidentStatusByIncidentIdMutation,
  useDeleteIncidentByIncidentIdMutation,
  useReassignIncidentPriorityByIncidentIdMutation,
  // resources
  useCreateResourceMutation,
  useGetAllResourcesQuery,
  useGetResourceByIdQuery,
  useGetResourceByResourceIdQuery,
  useGetAvailableResourcesQuery,
  useGetResourcesByTypeQuery,
  useGetResourcesInRegionQuery,
  useUpdateResourceStatusMutation,
  useUpdateResourceLocationMutation,
  useUpdateResourceLoadMutation,
  useReportResourceFailureMutation,
  useReportResourceMaintenanceMutation,
  useRestoreResourceMutation,
  useDeleteResourceMutation,
  // hospitals
  useRegisterHospitalMutation,
  useGetAllHospitalsQuery,
  useGetHospitalByIdQuery,
  useGetHospitalByHospitalIdQuery,
  useGetAvailableHospitalsQuery,
  useGetHospitalsInRegionQuery,
  useUpdateHospitalStatusMutation,
  useUpdateHospitalBedsMutation,
  useDeleteHospitalMutation,
  // allocations
  useAllocateResourceMutation,
  useGetAllocationByIdQuery,
  useGetAllocationsByIncidentQuery,
  useGetActiveAllocationsQuery,
  useUpdateAllocationStatusMutation,
  useCancelAllocationMutation,
  useGetAllocationSummaryByIncidentQuery,
  // road network
  useCreateRoadSegmentMutation,
  useGetAllRoadSegmentsQuery,
  useGetRoadSegmentByIdQuery,
  useGetRoadSegmentsByStatusQuery,
  useGetRoadSegmentsBetweenLocationsQuery,
  useUpdateRoadStatusMutation,
  useUpdateTravelInfoMutation,
  useDeleteRoadSegmentMutation,
  // optimize
  useReoptimizeAllMutation,
  useOptimizeForIncidentQuery,
  // pipeline
  useGetOutboxStatusQuery,
  useGetPipelineTimelineQuery,
  useGetPipelineEventsQuery,
  useFlushOutboxMutation,
  useReplayPipelineEventMutation,
} = api;
