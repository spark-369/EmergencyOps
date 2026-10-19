"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import {
  useGetActiveAllocationsQuery,
  useGetActiveIncidentsQuery,
  useGetAllHospitalsQuery,
  useGetAllResourcesQuery,
  useGetHealthQuery,
  useReoptimizeAllMutation,
} from "@/lib/store/api";
import { useMutationToast } from "@/lib/use-api-notify";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, StatCard } from "@/components/ui/card";
import {
  EmptyState,
  Meter,
  PageHeader,
  Skeleton,
  SkeletonStats,
  SkeletonTable,
} from "@/components/ui/layout";
import { Badge, SeverityBadge, StatusBadge } from "@/components/ui/badge";
import {
  SEVERITY_RANK,
  formatNumber,
  formatRelative,
  humanize,
  percent,
} from "@/lib/format";
import { ClientOnly } from "@/components/providers/client-only";
import { shortId } from "@/components/incidents/incident-detail";
import type { ReoptimizeResult } from "@/lib/types";

/** Rows shown per board before deferring to the full registry. */
const BOARD_ROWS = 6;

/**
 * Severity rank with a safe fallback.
 *
 * `SEVERITY_RANK` is keyed by the enum strings the API returns; an unknown or
 * absent severity (the backend omits nulls) would otherwise compare as
 * `undefined` and silently sort to an arbitrary position in the triage list.
 */
function severityRank(value?: string): number {
  return (value && SEVERITY_RANK[value]) || 0;
}


/**
 * The live dashboard.
 *
 * Must never render on the server: every hook below subscribes through RTK
 * Query, which seeds `dataUpdatedAt: Date.now()` on first render and therefore
 * trips Next.js' prerender check. `CommandCenterPage` mounts it inside
 * `ClientOnly`.
 */
function CommandCenterDashboard() {
  const [optimization, setOptimization] = useState<ReoptimizeResult | null>(null);
  const run = useMutationToast();

  const health = useGetHealthQuery(undefined, { pollingInterval: 30000 });
  const incidents = useGetActiveIncidentsQuery(undefined, { pollingInterval: 15000 });
  const resources = useGetAllResourcesQuery(undefined, { pollingInterval: 30000 });
  const hospitals = useGetAllHospitalsQuery(undefined, { pollingInterval: 60000 });
  const allocations = useGetActiveAllocationsQuery(undefined, { pollingInterval: 15000 });
  const [reoptimizeAll, { isLoading: isReoptimizing }] = useReoptimizeAllMutation();

  const activeIncidents = incidents.data ?? [];
  const fleet = resources.data ?? [];
  const hospitalRows = hospitals.data ?? [];
  const waiting = allocations.data ?? [];

  /*
   * The dashboard is the screen an operator leaves open, so one failed domain
   * must not blank the whole board: each card reports its own state, and the
   * status strip names the domains that are unavailable. Anything else would
   * render an empty board as "all clear", which is the most dangerous possible
   * misreading of this screen.
   */
  const degraded = [
    incidents.error && "incidents",
    resources.error && "resources",
    hospitals.error && "hospitals",
    allocations.error && "allocations",
  ].filter(Boolean) as string[];

  const availableFleet = fleet.filter((resource) => resource.available);
  const criticalIncidents = activeIncidents.filter(
    (incident) => incident.severity === "CRITICAL" || incident.severity === "CATASTROPHIC",
  );
  const totalBeds = hospitalRows.reduce((sum, h) => sum + (h.totalBeds ?? 0), 0);
  const freeBeds = hospitalRows.reduce((sum, h) => sum + (h.availableBeds ?? 0), 0);

  /**
   * Triage order: severity first, then priority score.
   *
   * The previous version sorted on `priorityScore` alone. Score already blends
   * severity, but two incidents a point apart then interleave a CATASTROPHIC with
   * a HIGH — and the top of this list is the one place an operator looks first.
   * Severity leads; score breaks the tie; newest wins a full tie.
   */
  const triagedIncidents = useMemo(
    () =>
      [...activeIncidents]
        .sort(
          (a, b) =>
            severityRank(b.severity) - severityRank(a.severity) ||
            (b.priorityScore ?? 0) - (a.priorityScore ?? 0) ||
            (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
        )
        .slice(0, BOARD_ROWS),
    [activeIncidents],
  );

  /** Allocations oldest first — the queue is worked from the top. */
  const oldestAllocations = useMemo(
    () =>
      [...waiting]
        .sort((a, b) => (a.allocatedAt ?? "").localeCompare(b.allocatedAt ?? ""))
        .slice(0, BOARD_ROWS),
    [waiting],
  );

  /** Hospitals with the least head-room first: those are the ones to watch. */
  const strainedHospitals = useMemo(
    () =>
      [...hospitalRows]
        .sort(
          (a, b) => percent(a.availableBeds, a.totalBeds) - percent(b.availableBeds, b.totalBeds),
        )
        .slice(0, BOARD_ROWS),
    [hospitalRows],
  );

  /** Vehicles at or near capacity first. */
  const busiestResources = useMemo(
    () =>
      [...fleet]
        .sort((a, b) => percent(b.currentLoad, b.capacity) - percent(a.currentLoad, a.capacity))
        .slice(0, BOARD_ROWS),
    [fleet],
  );

  const availabilityPercent = percent(availableFleet.length, fleet.length);
  const bedPercent = percent(freeBeds, totalBeds);

  const apiOnline = !health.error && health.data?.status === "UP";

  const runOptimization = async () => {
    const outcome = await run(reoptimizeAll, undefined, {
      method: "POST",
      successTitle: "Fleet re-optimised",
      successDescription: "Recommendations generated for all active incidents.",
    });
    if (outcome.ok && outcome.data) setOptimization(outcome.data);
  };

  const matched = (optimization?.decisions ?? []).filter((d) => d.allocatedResourceId).length;
  const unmatched = (optimization?.decisions ?? []).length - matched;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Command center"
        description="Live posture across every domain. Press / to search a registry, or ⌘K to jump to any screen."
        actions={
          <>
            <Badge
              label={health.error ? "API offline" : `API ${health.data?.status ?? "unknown"}`}
              tone={health.error ? "danger" : apiOnline ? "success" : "info"}
              dot
            />
            <Button variant="primary" loading={isReoptimizing} onClick={runOptimization}>
              Re-optimise fleet
            </Button>
          </>
        }
      />

      {/*
        Status strip.
        Answers the two questions an operator asks before reading any number:
        "is the picture complete?" and "is anything on fire?" It sits above the
        stats so a degraded feed cannot be mistaken for an all-clear board.
      */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-slate-700">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              apiOnline ? "bg-emerald-400" : health.error ? "bg-rose-400" : "bg-amber-400"
            }`}
          />
          {apiOnline ? "All systems nominal" : health.error ? "API unreachable" : "Connecting…"}
        </span>

        {degraded.length > 0 && (
          <span className="flex items-center gap-1.5 font-medium text-amber-300">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-400" />
            Partial data — {degraded.join(", ")} unavailable
          </span>
        )}

        {criticalIncidents.length > 0 && (
          <span className="flex items-center gap-1.5 font-semibold text-rose-300">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-rose-400" />
            {criticalIncidents.length} critical or catastrophic
          </span>
        )}

        <span className="ml-auto hidden font-mono text-[11px] text-slate-500 sm:inline">
          {/*
            `fulfilledTimeStamp` rather than `dataUpdatedAt`.

            `dataUpdatedAt` is not part of the public `UseQueryResult` type, so
            reading it is a compile error: RTK Query's result is a discriminated
            union, and the `isUninitialized` member does not declare the field at
            all. `fulfilledTimeStamp` is the typed, documented equivalent — epoch
            milliseconds of the last successful fetch — and it is what
            `health-indicator.tsx` and `api-explorer` already use.

            Guarded on `isSuccess` too, since the field is `undefined` until the
            first response lands; passing the number straight to `Date` also
            avoids the needless `toISOString()` round-trip.
          */}
          {incidents.isSuccess && incidents.fulfilledTimeStamp !== undefined
            ? `incidents refreshed ${formatRelative(
                new Date(incidents.fulfilledTimeStamp).toISOString(),
              )}`
            : "incidents not yet loaded"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/incidents" className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400 rounded-xl">
          <StatCard
            label="Active incidents"
            value={formatNumber(activeIncidents.length)}
            hint={
              criticalIncidents.length > 0
                ? `${criticalIncidents.length} critical or catastrophic`
                : "Nothing critical"
            }
            tone={criticalIncidents.length > 0 ? "rose" : "slate"}
          />
        </Link>
        <Link href="/resources" className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400 rounded-xl">
          <StatCard
            label="Fleet available"
            value={`${formatNumber(availableFleet.length)}/${formatNumber(fleet.length)}`}
            hint={`${availabilityPercent}% deployable`}
            tone={availabilityPercent >= 50 ? "teal" : availabilityPercent > 0 ? "amber" : "rose"}
          />
        </Link>
        <Link href="/hospitals" className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400 rounded-xl">
          <StatCard
            label="Free hospital beds"
            value={formatNumber(freeBeds)}
            hint={`${bedPercent}% of ${formatNumber(totalBeds)}`}
            tone={bedPercent >= 30 ? "sky" : bedPercent > 10 ? "amber" : "rose"}
          />
        </Link>
        <Link href="/allocations" className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400 rounded-xl">
          <StatCard
            label="Pending dispatch"
            value={formatNumber(waiting.length)}
            hint={waiting.length === 0 ? "Nothing waiting" : "Awaiting an operator"}
            tone={waiting.length === 0 ? "slate" : "amber"}
          />
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Priority incidents"
            description="Severity, then priority score — the top of this list is what to act on first"
            actions={
              <LinkButton href="/incidents" variant="ghost" size="sm">
                Manage
              </LinkButton>
            }
          />
          {incidents.isLoading ? (
            <SkeletonTable rows={BOARD_ROWS} />
          ) : incidents.error ? (
            <CardBody>
              <p className="text-xs text-rose-300">
                Incidents could not be loaded. Retrying automatically…
              </p>
            </CardBody>
          ) : activeIncidents.length === 0 ? (
            <EmptyState
              title="No active incidents"
              description="Nothing is open right now. New reports appear here as soon as they are received."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {triagedIncidents.map((incident, index) => (
                <li
                  key={`${incident.incidentId ?? "i"}-${index}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {/*
                      Severity rail: a 4px colour bar per row. At a glance the
                      list reads as a heat column, which is faster to scan than
                      parsing a badge on every line.
                    */}
                    <span
                      aria-hidden="true"
                      className={`h-8 w-1 shrink-0 rounded-full ${
                        incident.severity === "CATASTROPHIC"
                          ? "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.7)]"
                          : incident.severity === "CRITICAL"
                            ? "bg-rose-400"
                            : incident.severity === "HIGH"
                              ? "bg-amber-400"
                              : incident.severity === "MEDIUM"
                                ? "bg-sky-400"
                                : "bg-slate-400"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-950">
                        {incident.locationDescription ?? shortId(incident.incidentId)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {formatNumber(incident.affectedPeople)} affected · ETA{" "}
                        {formatNumber(incident.estimatedResponseTimeMinutes)} min ·{" "}
                        {formatRelative(incident.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <SeverityBadge value={incident.severity} />
                    <StatusBadge value={incident.status} />
                    <span
                      className="w-9 text-right text-xs font-semibold tabular-nums text-slate-700"
                      title="Priority score"
                    >
                      {formatNumber(incident.priorityScore)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {activeIncidents.length > BOARD_ROWS && (
            <CardFooter>
              <span>
                Showing the {BOARD_ROWS} most urgent of {activeIncidents.length}
              </span>
              <Link
                href="/incidents"
                className="font-medium text-teal-300 transition-colors hover:text-teal-200 hover:underline"
              >
                View all
              </Link>
            </CardFooter>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Dispatch queue"
            description="Oldest first — the oldest pending allocation is the one ageing out"
            actions={
              <LinkButton href="/allocations" variant="ghost" size="sm">
                Dispatch
              </LinkButton>
            }
          />
          {allocations.isLoading ? (
            <SkeletonTable rows={BOARD_ROWS} />
          ) : allocations.error ? (
            <CardBody>
              <p className="text-xs text-rose-300">
                The dispatch queue could not be loaded. Retrying automatically…
              </p>
            </CardBody>
          ) : waiting.length === 0 ? (
            <EmptyState
              title="Queue empty"
              description="Every allocation has been picked up. New dispatches will wait here."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {oldestAllocations.map((allocation) => (
                <li
                  key={allocation.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025]"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-900">#{allocation.id}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {shortId(allocation.incidentId)} → {shortId(allocation.resourceId)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge value={allocation.status} />
                    <span
                      className="text-[11px] whitespace-nowrap tabular-nums text-slate-500"
                      title={allocation.allocatedAt}
                    >
                      {formatRelative(allocation.allocatedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {waiting.length > BOARD_ROWS && (
            <CardFooter>
              <span>
                Showing the {BOARD_ROWS} oldest of {waiting.length}
              </span>
              <Link
                href="/allocations"
                className="font-medium text-teal-300 transition-colors hover:text-teal-200 hover:underline"
              >
                View all
              </Link>
            </CardFooter>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Fleet readiness"
            description="Highest load first — the units closest to capacity"
            actions={
              <LinkButton href="/resources" variant="ghost" size="sm">
                Assets
              </LinkButton>
            }
          />
          {resources.isLoading ? (
            <SkeletonTable rows={BOARD_ROWS} />
          ) : resources.error ? (
            <CardBody>
              <p className="text-xs text-rose-300">
                Fleet data could not be loaded. Retrying automatically…
              </p>
            </CardBody>
          ) : fleet.length === 0 ? (
            <EmptyState
              title="No resources registered"
              description="Register ambulances, rescue teams and other units to start dispatching."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {busiestResources.map((resource, index) => (
                <li
                  key={`${resource.resourceId ?? "r"}-${index}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025]"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-xs font-medium text-slate-950">
                      {humanize(resource.type)}
                      {resource.available && (
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                          title="Available for dispatch"
                        />
                      )}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                      {shortId(resource.resourceId)}
                    </p>
                  </div>
                  <div className="flex w-36 shrink-0 items-center gap-2">
                    <Meter
                      value={resource.currentLoad}
                      max={resource.capacity}
                      label={`${humanize(resource.type)} load`}
                      className="flex-1"
                    />
                    <StatusBadge value={resource.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Hospital capacity"
            description="Least head-room first — the sites most likely to divert"
            actions={
              <LinkButton href="/hospitals" variant="ghost" size="sm">
                Capacity
              </LinkButton>
            }
          />
          {hospitals.isLoading ? (
            <SkeletonTable rows={BOARD_ROWS} />
          ) : hospitals.error ? (
            <CardBody>
              <p className="text-xs text-rose-300">
                Hospital capacity could not be loaded. Retrying automatically…
              </p>
            </CardBody>
          ) : hospitalRows.length === 0 ? (
            <EmptyState
              title="No hospitals registered"
              description="Add receiving facilities so the optimiser can route casualties."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {strainedHospitals.map((hospital, index) => (
                <li
                  key={hospital.id ?? `h-${index}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-950">{hospital.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {formatNumber(hospital.availableBeds)} of{" "}
                      {formatNumber(hospital.totalBeds)} beds free · ICU{" "}
                      {formatNumber(hospital.icuAvailable)}
                    </p>
                  </div>
                  <div className="flex w-36 shrink-0 items-center gap-2">
                    <Meter
                      value={hospital.availableBeds}
                      max={hospital.totalBeds}
                      // Head-room is the inverse of load, and Meter's "auto" tone
                      // reads *high* as alarming (≥70% amber, ≥100% red) — which
                      // would paint a well-staffed hospital red. The tone is
                      // therefore chosen from the availability instead.
                      tone={
                        percent(hospital.availableBeds, hospital.totalBeds) < 10
                          ? "rose"
                          : percent(hospital.availableBeds, hospital.totalBeds) < 30
                            ? "amber"
                            : "teal"
                      }
                      label={`${hospital.name} bed availability`}
                      className="flex-1"
                    />
                    <StatusBadge value={hospital.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Optimization snapshot"
          description="Read-only matching recommendations for every active incident"
          actions={
            <Button size="sm" variant="secondary" loading={isReoptimizing} onClick={runOptimization}>
              Run
            </Button>
          }
        />
        {optimization ? (
          <>
            <CardBody>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    Incidents
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">
                    {formatNumber(optimization.totalIncidents)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    Resources
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">
                    {formatNumber(optimization.totalResources)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    Matched
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-300">
                    {formatNumber(matched)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    Unmatched
                  </p>
                  <p
                    className={`mt-1 text-lg font-semibold tabular-nums ${
                      unmatched > 0 ? "text-rose-300" : "text-slate-950"
                    }`}
                  >
                    {formatNumber(unmatched)}
                  </p>
                </div>
              </div>

              {/*
                Coverage bar. The four numbers above answer "what happened";
                this answers "is the fleet actually sufficient", which is the
                decision the run exists to inform. An all-green 100% is the
                only genuinely reassuring reading.
              */}
              <Meter
                value={matched}
                max={Math.max(matched + unmatched, 1)}
                tone={unmatched === 0 ? "teal" : matched === 0 ? "rose" : "amber"}
                showValue
                label="Incidents matched to a resource"
                className="mt-4"
              />

              {unmatched > 0 && (
                <p className="mt-2 text-xs text-amber-300">
                  {unmatched} incident{unmatched === 1 ? "" : "s"} had no suitable unit. Consider
                  re-tasking standby resources or requesting mutual aid.
                </p>
              )}
            </CardBody>
            <CardFooter>
              <span className="font-mono text-[11px]">
                computed {formatRelative(optimization.optimizedAt)}
              </span>
              <LinkButton href="/optimization" variant="ghost" size="sm">
                Full report
              </LinkButton>
            </CardFooter>
          </>
        ) : (
          <CardBody>
            <div className="flex flex-col items-start gap-2 py-1">
              <p className="text-xs text-slate-500">
                Run the optimiser to see how many active incidents can be matched right now. This is
                a read-only recommendation — nothing is dispatched until an operator confirms.
              </p>
            </div>
          </CardBody>
        )}
      </Card>
    </>
  );
}

/**
 * Static markup shown while the dashboard is deferring to the client.
 *
 * Shaped like the real board (status strip, four stat cards, two panels) so the
 * first paint has the same geometry as the loaded screen. A generic spinner here
 * is what makes a fast app *feel* slow: the whole layout jumps once data lands.
 */
function DashboardFallback() {
  return (
    <div aria-busy="true" aria-live="polite">
      <PageHeader
        eyebrow="Operations"
        title="Command center"
        description="Live posture across every domain. Press / to search a registry, or ⌘K to jump to any screen."
      />
      <div className="flex flex-wrap items-center gap-x-5 rounded-xl border border-border-subtle bg-surface px-4 py-2.5">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-3 w-28" />
      </div>
      <SkeletonStats count={4} />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
          <div className="border-b border-border-subtle px-4 py-3">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="mt-2 h-2.5 w-56" />
          </div>
          <SkeletonTable rows={6} />
        </div>
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
          <div className="border-b border-border-subtle px-4 py-3">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-2 h-2.5 w-52" />
          </div>
          <SkeletonTable rows={6} />
        </div>
      </div>
    </div>
  );
}

/**
 * Route entry point.
 *
 * Deliberately free of RTK Query hooks: with `cacheComponents` enabled Next.js
 * prerenders Client Components, and `useQuery` reads `Date.now()` on first
 * render. The interactive dashboard therefore lives in `CommandCenterDashboard`
 * and is mounted only after hydration.
 */
export default function CommandCenterPage() {
  return (
    <ClientOnly fallback={<DashboardFallback />}>
      <CommandCenterDashboard />
    </ClientOnly>
  );
}

