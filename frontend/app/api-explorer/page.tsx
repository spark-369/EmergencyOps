"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, MethodChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { EmptyState, Input, PageHeader, Toolbar } from "@/components/ui/layout";
import { HealthIndicator } from "@/components/layout/health-indicator";
import { ClientOnly } from "@/components/providers/client-only";
import { useGetHealthQuery } from "@/lib/store/api";
import { API_BASE_URL } from "@/lib/axios";
import { formatDateTime, formatNumber } from "@/lib/format";


interface EndpointEntry {
  /**
   * `PUT` is in the union even though no controller defines one: the inventory is
   * meant to mirror the backend, and a future full-replace route should be
   * representable here on the day it is added.
   */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  screen: { label: string; href: string };
  /** RTK Query hook that issues the call. */
  hook: string;
}

interface EndpointGroup {
  controller: string;
  base: string;
  endpoints: EndpointEntry[];
}

const SCREENS = {
  incidents: { label: "Incidents", href: "/incidents" },
  resources: { label: "Resources", href: "/resources" },
  hospitals: { label: "Hospitals", href: "/hospitals" },
  allocations: { label: "Allocations", href: "/allocations" },
  roads: { label: "Road Network", href: "/road-network" },
  optimize: { label: "Optimization", href: "/optimization" },
  users: { label: "Users & access", href: "/users" },
  login: { label: "Sign in", href: "/login" },
  register: { label: "First-run setup", href: "/register" },
  dashboard: { label: "Command Center", href: "/" },
};

/**
 * Complete inventory of the Spring Boot v1 controllers
 * (`backend/src/main/java/com/pstu/backend/controller`).
 */
export const API_GROUPS: EndpointGroup[] = [
  {
    controller: "AuthController",
    base: "/api/v1/auth",
    endpoints: [
      // `/login` and `/refresh` are issued from two places: the sign-in form uses
      // `useLoginMutation`, while token rotation after a 401 happens inside the
      // axios interceptor with `useRefreshMutation` as the RTK Query equivalent.
      { method: "POST", path: "/auth/login", summary: "Exchange credentials for an access + refresh token", screen: SCREENS.login, hook: "useLoginMutation" },
      { method: "POST", path: "/auth/refresh", summary: "Rotate the refresh token for a new pair", screen: SCREENS.login, hook: "useRefreshMutation" },
      { method: "POST", path: "/auth/logout", summary: "Revoke the presented refresh token", screen: SCREENS.dashboard, hook: "useLogoutMutation" },
      { method: "GET", path: "/auth/me", summary: "Identity of the caller, resolved from JWT claims", screen: SCREENS.dashboard, hook: "useMeQuery" },
      { method: "POST", path: "/auth/change-password", summary: "Change own password and revoke all sessions", screen: SCREENS.dashboard, hook: "useChangePasswordMutation" },
      { method: "GET", path: "/auth/registration-status", summary: "Whether first-run registration is still open (public)", screen: SCREENS.register, hook: "useRegistrationStatusQuery" },
      { method: "POST", path: "/auth/register", summary: "Create the first ADMIN; 409 once any account exists", screen: SCREENS.register, hook: "useRegisterMutation" },
    ],
  },
  {
    controller: "UserController",
    base: "/api/v1/users",
    endpoints: [
      { method: "GET", path: "/users", summary: "List accounts (ADMIN only)", screen: SCREENS.users, hook: "useListUsersQuery" },
      { method: "GET", path: "/users/{id}", summary: "Fetch one account by numeric id (ADMIN only)", screen: SCREENS.users, hook: "useGetUserByIdQuery" },
      { method: "POST", path: "/users", summary: "Create an account (ADMIN only)", screen: SCREENS.users, hook: "useCreateUserMutation" },
      { method: "PATCH", path: "/users/{id}", summary: "Change role, password or enabled state (ADMIN only)", screen: SCREENS.users, hook: "useUpdateUserMutation" },
      { method: "DELETE", path: "/users/{id}", summary: "Delete an account and revoke its sessions (ADMIN only)", screen: SCREENS.users, hook: "useDeleteUserMutation" },
    ],
  },
  {
    controller: "HealthController",
    base: "/api/v1/health",
    endpoints: [
      {
        method: "GET",
        path: "/health",
        summary: "Liveness probe with service details",
        screen: SCREENS.dashboard,
        hook: "useGetHealthQuery",
      },
    ],
  },
  {
    controller: "IncidentController",
    base: "/api/v1/incidents",
    endpoints: [
      { method: "POST", path: "/incidents", summary: "Report an incident (priority computed server-side)", screen: SCREENS.incidents, hook: "useCreateIncidentMutation" },
      { method: "GET", path: "/incidents", summary: "Paged incident register (Spring Pageable)", screen: SCREENS.incidents, hook: "useGetAllIncidentsQuery" },
      { method: "GET", path: "/incidents/{id}", summary: "Fetch by numeric primary key", screen: SCREENS.incidents, hook: "useGetIncidentByIdQuery" },
      { method: "GET", path: "/incidents/incident-id/{incidentId}", summary: "Fetch by business incidentId", screen: SCREENS.incidents, hook: "useGetIncidentByIncidentIdQuery" },
      { method: "GET", path: "/incidents/active", summary: "Received / prioritized / allocating / in-progress", screen: SCREENS.dashboard, hook: "useGetActiveIncidentsQuery" },
      { method: "GET", path: "/incidents/incident-id/{incidentId}/allowed-transitions", summary: "Statuses the lifecycle permits next (409 otherwise)", screen: SCREENS.incidents, hook: "useGetAllowedIncidentTransitionsQuery" },
      { method: "GET", path: "/incidents/severity/{severity}", summary: "Filter by severity enum", screen: SCREENS.incidents, hook: "useGetIncidentsBySeverityQuery" },
      { method: "GET", path: "/incidents/region", summary: "Bounding-box query (minLat/maxLat/minLon/maxLon)", screen: SCREENS.incidents, hook: "useGetIncidentsInRegionQuery" },
      { method: "PATCH", path: "/incidents/{id}/status", summary: "Status via ?status= (numeric key resolved from the business id)", screen: SCREENS.incidents, hook: "useUpdateIncidentStatusByIncidentIdMutation" },
      { method: "POST", path: "/incidents/{id}/reassign-priority", summary: "Recalculate priority + response estimate", screen: SCREENS.incidents, hook: "useReassignIncidentPriorityByIncidentIdMutation" },
      { method: "DELETE", path: "/incidents/{id}", summary: "Delete incident (204 No Content)", screen: SCREENS.incidents, hook: "useDeleteIncidentByIncidentIdMutation" },
    ],
  },
  {
    controller: "ResourceController",
    base: "/api/v1/resources",
    endpoints: [
      { method: "POST", path: "/resources", summary: "Register resource (UUID generated)", screen: SCREENS.resources, hook: "useCreateResourceMutation" },
      { method: "GET", path: "/resources", summary: "All resources", screen: SCREENS.resources, hook: "useGetAllResourcesQuery" },
      { method: "GET", path: "/resources/{id}", summary: "Fetch by numeric primary key", screen: SCREENS.resources, hook: "useGetResourceByIdQuery" },
      { method: "GET", path: "/resources/resource-id/{resourceId}", summary: "Fetch by UUID resourceId", screen: SCREENS.resources, hook: "useGetResourceByResourceIdQuery" },
      { method: "GET", path: "/resources/available", summary: "available = true", screen: SCREENS.resources, hook: "useGetAvailableResourcesQuery" },
      { method: "GET", path: "/resources/type/{type}", summary: "AVAILABLE resources of a type", screen: SCREENS.resources, hook: "useGetResourcesByTypeQuery" },
      { method: "GET", path: "/resources/region", summary: "Bounding-box query", screen: SCREENS.resources, hook: "useGetResourcesInRegionQuery" },
      { method: "PATCH", path: "/resources/{id}/status", summary: "Status + availability via ?status=", screen: SCREENS.resources, hook: "useUpdateResourceStatusMutation" },
      { method: "PATCH", path: "/resources/{id}/location", summary: "Reposition via ?latitude&longitude", screen: SCREENS.resources, hook: "useUpdateResourceLocationMutation" },
      { method: "PATCH", path: "/resources/{id}/load", summary: "Set load via ?currentLoad=", screen: SCREENS.resources, hook: "useUpdateResourceLoadMutation" },
      { method: "POST", path: "/resources/{id}/failure", summary: "Force OFFLINE", screen: SCREENS.resources, hook: "useReportResourceFailureMutation" },
      { method: "POST", path: "/resources/{id}/maintenance", summary: "Force MAINTENANCE", screen: SCREENS.resources, hook: "useReportResourceMaintenanceMutation" },
      { method: "POST", path: "/resources/{id}/restore", summary: "Back to AVAILABLE", screen: SCREENS.resources, hook: "useRestoreResourceMutation" },
      { method: "DELETE", path: "/resources/{id}", summary: "Delete resource (204)", screen: SCREENS.resources, hook: "useDeleteResourceMutation" },
    ],
  },
  {
    controller: "HospitalController",
    base: "/api/v1/hospitals",
    endpoints: [
      { method: "POST", path: "/hospitals", summary: "Register hospital", screen: SCREENS.hospitals, hook: "useRegisterHospitalMutation" },
      { method: "GET", path: "/hospitals", summary: "All hospitals", screen: SCREENS.hospitals, hook: "useGetAllHospitalsQuery" },
      { method: "GET", path: "/hospitals/{id}", summary: "Fetch by numeric primary key", screen: SCREENS.hospitals, hook: "useGetHospitalByIdQuery" },
      { method: "GET", path: "/hospitals/hospital-id/{hospitalId}", summary: "Fetch by business hospitalId", screen: SCREENS.hospitals, hook: "useGetHospitalByHospitalIdQuery" },
      { method: "GET", path: "/hospitals/available", summary: "OPERATIONAL with free beds", screen: SCREENS.hospitals, hook: "useGetAvailableHospitalsQuery" },
      { method: "GET", path: "/hospitals/region", summary: "Bounding-box query", screen: SCREENS.hospitals, hook: "useGetHospitalsInRegionQuery" },
      { method: "PATCH", path: "/hospitals/{id}/status", summary: "Status via ?status=", screen: SCREENS.hospitals, hook: "useUpdateHospitalStatusMutation" },
      { method: "PATCH", path: "/hospitals/{id}/beds", summary: "Partial bed / ICU / emergency counters", screen: SCREENS.hospitals, hook: "useUpdateHospitalBedsMutation" },
      { method: "DELETE", path: "/hospitals/{id}", summary: "Delete hospital (204)", screen: SCREENS.hospitals, hook: "useDeleteHospitalMutation" },
    ],
  },
  {
    controller: "AllocationController",
    base: "/api/v1/allocations",
    endpoints: [
      { method: "POST", path: "/allocations", summary: "Allocate resource (201 Created)", screen: SCREENS.allocations, hook: "useAllocateResourceMutation" },
      { method: "GET", path: "/allocations/{id}", summary: "Fetch allocation", screen: SCREENS.allocations, hook: "useGetAllocationByIdQuery" },
      { method: "GET", path: "/allocations/incident/{incidentId}", summary: "Allocations for one incident", screen: SCREENS.allocations, hook: "useGetAllocationsByIncidentQuery" },
      { method: "GET", path: "/allocations/active", summary: "PENDING allocations, oldest first", screen: SCREENS.allocations, hook: "useGetActiveAllocationsQuery" },
      { method: "PATCH", path: "/allocations/{id}/status", summary: "Lifecycle via ?status=", screen: SCREENS.allocations, hook: "useUpdateAllocationStatusMutation" },
      { method: "POST", path: "/allocations/{id}/cancel", summary: "Cancel + release capacity", screen: SCREENS.allocations, hook: "useCancelAllocationMutation" },
      { method: "GET", path: "/allocations/incident/{incidentId}/summary", summary: "Compact per-incident summary", screen: SCREENS.allocations, hook: "useGetAllocationSummaryByIncidentQuery" },
    ],
  },
  {
    controller: "RoadNetworkController",
    base: "/api/v1/road-network",
    endpoints: [
      { method: "POST", path: "/road-network", summary: "Create segment (201 Created)", screen: SCREENS.roads, hook: "useCreateRoadSegmentMutation" },
      { method: "GET", path: "/road-network", summary: "All segments", screen: SCREENS.roads, hook: "useGetAllRoadSegmentsQuery" },
      { method: "GET", path: "/road-network/{id}", summary: "Fetch segment", screen: SCREENS.roads, hook: "useGetRoadSegmentByIdQuery" },
      { method: "GET", path: "/road-network/status/{status}", summary: "OPEN / CLOSED / DELAYED / CONGESTED", screen: SCREENS.roads, hook: "useGetRoadSegmentsByStatusQuery" },
      { method: "GET", path: "/road-network/route", summary: "Segments between two locations", screen: SCREENS.roads, hook: "useGetRoadSegmentsBetweenLocationsQuery" },
      { method: "PATCH", path: "/road-network/{id}/status", summary: "Status via ?status=", screen: SCREENS.roads, hook: "useUpdateRoadStatusMutation" },
      { method: "PATCH", path: "/road-network/{id}", summary: "Travel info via ?distanceKm&travelTimeMinutes", screen: SCREENS.roads, hook: "useUpdateTravelInfoMutation" },
      { method: "DELETE", path: "/road-network/{id}", summary: "Delete segment (204)", screen: SCREENS.roads, hook: "useDeleteRoadSegmentMutation" },
    ],
  },
  {
    controller: "OptimizationController",
    base: "/api/v1/optimize",
    endpoints: [
      { method: "POST", path: "/optimize/reoptimize-all", summary: "Matches for every active incident", screen: SCREENS.optimize, hook: "useReoptimizeAllMutation" },
      { method: "GET", path: "/optimize/incident/{incidentId}", summary: "Single-incident recommendation", screen: SCREENS.optimize, hook: "useOptimizeForIncidentQuery" },
    ],
  },
  {
    // Read/operate surface of the event pipeline (outbox, timeline, replay).
    // `timeline` and `outbox` have RTK Query hooks; the mutating operator tools
    // (flush, replay) are deliberately hook-less — they are called by hand from
    // the API explorer, not from a console screen.
    controller: "PipelineController",
    base: "/api/v1/pipeline",
    endpoints: [
      { method: "GET", path: "/pipeline/timeline/{aggregateId}", summary: "Every event recorded for one incident (audit trail)", screen: SCREENS.incidents, hook: "useGetPipelineTimelineQuery" },
      { method: "GET", path: "/pipeline/events", summary: "Recorded events of one type, newest first", screen: SCREENS.optimize, hook: "useGetPipelineEventsQuery" },
      { method: "GET", path: "/pipeline/outbox", summary: "Undelivered events still owed to the broker", screen: SCREENS.incidents, hook: "useGetOutboxStatusQuery" },
      { method: "POST", path: "/pipeline/outbox/flush", summary: "Force one outbox relay pass", screen: SCREENS.optimize, hook: "useFlushOutboxMutation" },
      { method: "POST", path: "/pipeline/replay/{eventId}", summary: "Re-publish a stored event (idempotent for consumers)", screen: SCREENS.optimize, hook: "useReplayPipelineEventMutation" },
    ],
  },
];

/**
 * Health probe details. Lives in its own component so its `useGetHealthQuery`
 * hook only runs after hydration — see `ClientOnly` for why that matters.
 */
/**
 * A flattened endpoint, carrying its owning controller so a search result can
 * name where it comes from after the grouping is gone.
 */
interface FlatEndpoint extends EndpointEntry {
  controller: string;
  base: string;
}

/**
 * Copies text and reports success.
 *
 * `navigator.clipboard` is unavailable on insecure origins (plain http on a
 * non-localhost host), which is exactly how a self-hosted console is often
 * reached. The fallback keeps the affordance working there instead of failing
 * silently; returning a boolean lets the caller show an honest confirmation.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Health probe details. Lives in its own component so its `useGetHealthQuery`
 * hook only runs after hydration — see `ClientOnly` for why that matters.
 */
function RuntimeCard() {
  const health = useGetHealthQuery(undefined, { pollingInterval: 30000 });

  return (
    <Card>
      <CardHeader
        title="Runtime"
        description={`Axios base URL: ${API_BASE_URL}`}
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => health.refetch()}
            loading={health.isFetching}
          >
            Re-check health
          </Button>
        }
      />
      <CardBody>
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-slate-500 uppercase">Status</dt>
            <dd className="font-medium text-slate-800">
              {health.isLoading ? "Probing…" : (health.data?.status ?? "Unknown")}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 uppercase">Service</dt>
            <dd className="font-mono text-slate-800">
              {String(health.data?.details?.service ?? "—")}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 uppercase">Probe</dt>
            <dd className="font-mono text-slate-800">{`${API_BASE_URL}/health`}</dd>
          </div>
          <div>
            <dt className="text-slate-500 uppercase">Last checked</dt>
            <dd className="text-slate-800">
              {health.isSuccess && health.fulfilledTimeStamp !== undefined
                ? formatDateTime(new Date(health.fulfilledTimeStamp).toISOString())
                : "—"}
            </dd>
          </div>
        </dl>
        <p className="panel-inset mt-3 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          <strong>Auth:</strong> the API is a stateless JWT resource server. Exchange
          credentials at <code className="font-mono">POST /auth/login</code> for a
          short-lived access token plus a rotating refresh token, then send{" "}
          <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>. A{" "}
          <strong>401</strong> means the token is missing or expired (the client refreshes
          silently, then signs out); a <strong>403</strong> means the token is valid but the
          role is insufficient. Rate limiting returns 429 and is surfaced as a dedicated
          toast.
        </p>
      </CardBody>
    </Card>
  );
}

export default function ApiExplorerPage() {
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<string>("");
  const [controller, setController] = useState<string>("");
  const [copied, setCopied] = useState<string | null>(null);

  /**
   * Every endpoint, flattened and annotated with its controller.
   *
   * Memoised because it feeds the search index below; recomputing it on every
   * keystroke would re-map ~60 objects for no reason.
   */
  const flat = useMemo<FlatEndpoint[]>(
    () =>
      API_GROUPS.flatMap((group) =>
        group.endpoints.map((endpoint) => ({
          ...endpoint,
          controller: group.controller,
          base: group.base,
        })),
      ),
    [],
  );

  const byMethod = useMemo(
    () =>
      flat.reduce<Record<string, number>>((acc, endpoint) => {
        acc[endpoint.method] = (acc[endpoint.method] ?? 0) + 1;
        return acc;
      }, {}),
    [flat],
  );

  const methods = useMemo(
    () => [...new Set(flat.map((endpoint) => endpoint.method))].sort(),
    [flat],
  );

  /**
   * Filtered view.
   *
   * Searching covers path, summary, controller and hook name: an operator
   * debugging at speed knows one of those four and rarely the others. Matching is
   * case-insensitive substring rather than fuzzy — a reference page should
   * return exactly what was asked for, not a ranked guess.
   */
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return flat.filter((endpoint) => {
      if (method && endpoint.method !== method) return false;
      if (controller && endpoint.controller !== controller) return false;
      if (!term) return true;
      return [endpoint.path, endpoint.summary, endpoint.controller, endpoint.hook]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [flat, query, method, controller]);

  const isFiltered = query.trim() !== "" || method !== "" || controller !== "";

  const reset = () => {
    setQuery("");
    setMethod("");
    setController("");
  };

  const handleCopy = async (endpoint: FlatEndpoint) => {
    const ok = await copyText(`${API_BASE_URL}${endpoint.path}`);
    if (ok) {
      setCopied(`${endpoint.method}-${endpoint.path}`);
      // Clear the confirmation so a second copy of the same row re-announces.
      window.setTimeout(() => setCopied(null), 1600);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="API contract explorer"
        description="Every endpoint exposed by the Spring Boot v1 controllers, with the verb it uses and the screen that exercises it."
        actions={
          <ClientOnly fallback={<Badge label="Connecting…" tone="neutral" dot />}>
            <HealthIndicator showCheckedAt={false} />
          </ClientOnly>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Endpoints"
          value={formatNumber(flat.length)}
          hint={`Across ${API_GROUPS.length} controllers`}
          tone="teal"
        />
        <StatCard
          label="GET"
          value={formatNumber(byMethod.GET ?? 0)}
          hint="Read operations"
          tone="sky"
        />
        <StatCard
          label="POST"
          value={formatNumber(byMethod.POST ?? 0)}
          hint="Create + command actions"
          tone="violet"
        />
        <StatCard
          label="Mutations"
          value={formatNumber(
            (byMethod.PATCH ?? 0) + (byMethod.DELETE ?? 0) + (byMethod.PUT ?? 0),
          )}
          hint={`${byMethod.PATCH ?? 0} PATCH · ${byMethod.DELETE ?? 0} DELETE`}
          tone="rose"
        />
      </div>

      <ClientOnly
        fallback={
          <Card>
            <CardBody>
              <p className="text-xs text-slate-500">Probing the API…</p>
            </CardBody>
          </Card>
        }
      >
        <RuntimeCard />
      </ClientOnly>

      <Card>
        <CardHeader
          title="Endpoint index"
          description={
            isFiltered
              ? `${formatNumber(matches.length)} of ${formatNumber(flat.length)} endpoints match`
              : `${formatNumber(flat.length)} endpoints across ${API_GROUPS.length} controllers`
          }
          actions={
            isFiltered ? (
              <Button size="sm" variant="ghost" onClick={reset}>
                Clear filters
              </Button>
            ) : undefined
          }
        />

        {/*
          Filter bar. This page is a reference read *while* debugging, so finding
          one route among sixty is the primary task — it previously had no search
          at all and was organised only by controller.
        */}
        <Toolbar>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Search</span>
            <Input
              type="search"
              placeholder="Path, behaviour, controller or hook…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search endpoints"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Method</span>
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              aria-label="Filter by HTTP method"
              className="h-9 cursor-pointer rounded-lg border border-slate-300 bg-slate-100 px-2.5 pr-8 text-sm text-slate-950 outline-none transition-colors hover:border-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25"
            >
              <option value="">Any method</option>
              {methods.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Controller</span>
            <select
              value={controller}
              onChange={(event) => setController(event.target.value)}
              aria-label="Filter by controller"
              className="h-9 cursor-pointer rounded-lg border border-slate-300 bg-slate-100 px-2.5 pr-8 text-sm text-slate-950 outline-none transition-colors hover:border-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25"
            >
              <option value="">Any controller</option>
              {API_GROUPS.map((group) => (
                <option key={group.controller} value={group.controller}>
                  {group.controller}
                </option>
              ))}
            </select>
          </label>
        </Toolbar>

        {matches.length === 0 ? (
          <EmptyState
            title="No endpoints match"
            description="The search covers the path, the behaviour description, the controller and the hook name."
            action={
              <Button size="sm" variant="secondary" onClick={reset}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="min-w-full divide-y divide-border-subtle text-sm">
              <thead className="bg-slate-100/70">
                <tr>
                  {["Method", "Path", "Behaviour", "Controller", "Screen"].map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="px-3 py-2 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {matches.map((endpoint) => {
                  const key = `${endpoint.method}-${endpoint.path}`;
                  const justCopied = copied === key;
                  return (
                    <tr key={key} className="align-middle transition-colors hover:bg-white/[0.035]">
                      <td className="px-3 py-2">
                        <MethodChip method={endpoint.method} />
                      </td>
                      <td className="px-3 py-2">
                        {/*
                          The path is a copy target. A reference page exists to get
                          a route *into* a curl/Postman session, and until now the
                          only way was selecting text out of a table cell by hand.
                        */}
                        <div className="group flex items-center gap-1.5">
                          <code className="font-mono text-xs whitespace-nowrap text-slate-700">
                            {endpoint.path}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopy(endpoint)}
                            title={`Copy ${API_BASE_URL}${endpoint.path}`}
                            aria-label={`Copy full URL for ${endpoint.method} ${endpoint.path}`}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400 ${
                              justCopied
                                ? "text-emerald-300"
                                : "text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-white/5 hover:text-teal-300 focus:opacity-100"
                            }`}
                          >
                            {justCopied ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{endpoint.summary}</td>
                      <td className="px-3 py-2">
                        <p className="font-mono text-[11px] whitespace-nowrap text-slate-600">
                          {endpoint.controller}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] whitespace-nowrap text-slate-500">
                          {endpoint.base}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={endpoint.screen.href}
                          className="text-xs font-medium whitespace-nowrap text-teal-300 transition-colors hover:text-teal-200 hover:underline"
                        >
                          {endpoint.screen.label}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Contract notes"
          description="Behaviours that surprise a client, verified against the backend sources"
        />
        <CardBody>
          <ul className="space-y-2 text-xs leading-relaxed text-slate-600">
            <li>
              <strong>Updates are PATCH with query parameters.</strong> There are no PUT routes: a
              partial update passes its values as <code className="mx-1 font-mono">@RequestParam</code>
              (e.g. <code className="font-mono">?status=BUSY</code>), not as a JSON body. The
              no-body form is why a setter can look like it "succeeded" while changing nothing —
              send only the fields you mean to change.
            </li>
            <li>
              <strong>Nullable fields are omitted, not null.</strong> Jackson runs with{" "}
              <code className="mx-1 font-mono">default-property-inclusion=non_null</code>, so a
              field can be absent entirely. Every response field in{" "}
              <code className="font-mono">lib/types.ts</code> is therefore optional, and a client
              must treat "missing" and "null" identically.
            </li>
            <li>
              <strong>Two identifier spaces.</strong> Incidents and resources expose both a JPA
              primary key (<code className="font-mono">id</code>) and a business key (
              <code className="font-mono">incidentId</code> /{" "}
              <code className="font-mono">resourceId</code>). Mutating paths are addressed by the{" "}
              <em>numeric</em> key, so the console resolves it through{" "}
              <code className="mx-1 font-mono">GET /incidents/incident-id/&#123;id&#125;</code> when
              only the business id is at hand. Hospitals and allocations already expose the numeric
              id, so those screens wire mutations directly.
            </li>
            <li>
              <strong>One error envelope.</strong>{" "}
              <code className="font-mono">GlobalExceptionHandler</code> answers 404, 409 (lifecycle
              conflict, naming both states), 400 (with a field
              <code className="mx-1 font-mono">errors</code> map) and 429 (rate limited, with{" "}
              <code className="font-mono">Retry-After</code>). A 500 carries a correlation id
              instead of a stack trace. All are normalised into toasts and inline error states.
            </li>
            <li>
              <strong>Auth is a bearer token.</strong> <code className="font-mono">401</code> means
              the token is missing or expired — the client refreshes silently, then signs out.{" "}
              <code className="font-mono">403</code> means the token is valid but the role is
              insufficient, and must <em>not</em> sign the user out.
            </li>
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
