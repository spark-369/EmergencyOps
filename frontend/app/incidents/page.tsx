"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Incident, IncidentStatus } from "@/lib/types";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@/lib/types";
import {
  useDeleteIncidentByIncidentIdMutation,
  useGetAllIncidentsQuery,
  useGetAllowedIncidentTransitionsQuery,
  useGetActiveIncidentsQuery,
  useGetIncidentByIdQuery,
  useGetIncidentByIncidentIdQuery,
  useGetIncidentsBySeverityQuery,
  useGetIncidentsInRegionQuery,
  useReassignIncidentPriorityByIncidentIdMutation,
  useGetOutboxStatusQuery,
  useUpdateIncidentStatusByIncidentIdMutation,
} from "@/lib/store/api";
import { getErrorMessage, useMutationToast } from "@/lib/use-api-notify";
import { useRegistry } from "@/lib/use-registry";
import type { RegistryFilter } from "@/lib/use-registry";
import { ClientOnly } from "@/components/providers/client-only";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import {
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SkeletonTable,
  Toolbar,
} from "@/components/ui/layout";
import type { Column } from "@/components/ui/table";
import { Mono } from "@/components/ui/table";
import {
  RegistryFilterSelect,
  RegistryPager,
  RegistrySearch,
  RegistryTable,
  RegistryToolbar,
} from "@/components/ui/registry";
import { SeverityBadge, StatusBadge } from "@/components/ui/badge";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { IncidentForm } from "@/components/incidents/incident-form";
import { IncidentDetail, shortId } from "@/components/incidents/incident-detail";
import { Can } from "@/components/auth/can";
import { formatDateTime, formatNumber, formatRelative, humanize, SEVERITY_RANK } from "@/lib/format";


type FilterMode = "page" | "severity" | "region";

interface RegionForm {
  minLat: string;
  maxLat: string;
  minLon: string;
  maxLon: string;
}

/**
 * Default bounding box for the "region" data source.
 *
 * Deliberately not `0..100`: the seeded incidents/resources sit around Dhaka
 * (≈23.81 N, 90.41 E — the same values the incident form hints at), and latitude
 * never exceeds ±90, so a `0..100` box excluded every seeded record and looked
 * like "this endpoint returns nothing". A box wider than the city still matches
 * the demo data and is easy to narrow.
 */
const DEFAULT_REGION: RegionForm = {
  minLat: "20",
  maxLat: "27",
  minLon: "88",
  maxLon: "93",
};

/**
 * Stable empty list for `allowedOptions`.
 *
 * `allowed.data ?? EMPTY_STATUSES` runs on every render; allocating a new `[]` each
 * time would change the identity of `allowedOptions`, which is a dependency of the
 * selection-sync effect below — re-running it on every render for no reason.
 */
const EMPTY_STATUSES: IncidentStatus[] = [];

/**
 * One figure in the operational summary strip.
 *
 * Deliberately not a `StatCard`: the strip is a single row of context above the
 * register, and four bordered cards there would push the table below the fold on
 * a laptop — the opposite of what an operator needs.
 */
function SummaryMetric({
  label,
  value,
  tone = "default",
  title,
}: {
  label: string;
  value: string;
  tone?: "default" | "rose" | "amber" | "sky" | "muted";
  title?: string;
}) {
  const valueTone: Record<string, string> = {
    default: "text-slate-950",
    rose: "text-rose-300",
    amber: "text-amber-300",
    sky: "text-sky-300",
    muted: "text-slate-600",
  };
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
        {label}
      </span>
      <span className={`text-lg font-semibold tabular-nums ${valueTone[tone]}`}>{value}</span>
    </div>
  );
}

/**
 * Live incident workspace. Rendered only after hydration via `ClientOnly`,
 * because its RTK Query hooks read `Date.now()` on first render.
 */
function IncidentsView() {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [mode, setMode] = useState<FilterMode>("page");
  const [severity, setSeverity] =
    useState<(typeof INCIDENT_SEVERITIES)[number]>("CRITICAL");
  const [regionDraft, setRegionDraft] = useState<RegionForm>(DEFAULT_REGION);
  const [region, setRegion] = useState<RegionForm>(DEFAULT_REGION);

  const [formOpen, setFormOpen] = useState(false);
  const [lookupId, setLookupId] = useState("");
  const [lookupTarget, setLookupTarget] = useState("");
  // Primary-key lookup (`GET /incidents/{id}`), separate from the business-id one.
  const [pkId, setPkId] = useState("");
  const [pkTarget, setPkTarget] = useState("");
  const [selected, setSelected] = useState<Incident | null>(null);
  const [statusTarget, setStatusTarget] = useState<Incident | null>(null);
  const [pendingStatus, setPendingStatus] = useState<IncidentStatus>("PRIORITIZED");
  const [deleteTarget, setDeleteTarget] = useState<Incident | null>(null);

  const run = useMutationToast();
  const [updateStatus, statusState] = useUpdateIncidentStatusByIncidentIdMutation();
  const [reassignPriority, reassignState] =
    useReassignIncidentPriorityByIncidentIdMutation();
  const [removeIncident, deleteState] = useDeleteIncidentByIncidentIdMutation();

  const paged = useGetAllIncidentsQuery(
    { page, size },
    { skip: mode !== "page" },
  );
  const bySeverity = useGetIncidentsBySeverityQuery(severity, {
    skip: mode !== "severity",
  });
  const inRegion = useGetIncidentsInRegionQuery(
    {
      minLat: Number(region.minLat),
      maxLat: Number(region.maxLat),
      minLon: Number(region.minLon),
      maxLon: Number(region.maxLon),
    },
    { skip: mode !== "region" },
  );
  const lookup = useGetIncidentByIncidentIdQuery(lookupTarget, {
    skip: lookupTarget === "",
  });
  /*
   * Feeds the "open by incident" dropdown. Tagged the same way as the register, so
   * it refreshes whenever an incident is created or moves.
   */
  const activeIncidents = useGetActiveIncidentsQuery();
  const byPrimaryKey = useGetIncidentByIdQuery(Number(pkTarget), {
    skip: pkTarget === "" || Number.isNaN(Number(pkTarget)),
  });

  /*
   * Options for the "open by incident" dropdown. The active list is merged with the
   * page currently on screen so an operator can open exactly what they can see,
   * and so a resolved incident that has since fallen off the active list is still
   * reachable without typing its UUID.
   */
  const incidentChoices = useMemo(() => {
    const byId = new Map<string, Incident>();
    for (const incident of [...activeIncidents.data ?? [], ...(paged.data?.content ?? [])]) {
      if (incident.incidentId) byId.set(incident.incidentId, incident);
    }
    return [...byId.values()].sort(
      (a, b) =>
        (b.priorityScore ?? 0) - (a.priorityScore ?? 0) ||
        (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
    );
  }, [activeIncidents.data, paged.data]);

  /*
   * Legal next statuses for the incident being edited. Skipped when the dialog is
   * closed so hovering the list does not fetch; refreshed by the `Incident` tag
   * after every successful transition.
   */
  const allowed = useGetAllowedIncidentTransitionsQuery(statusTarget?.incidentId ?? "", {
    skip: statusTarget?.incidentId === undefined,
  });
  const allowedOptions = allowed.data ?? EMPTY_STATUSES;
  const allowedLoading = allowed.isLoading || allowed.isFetching;

  /*
   * Pipeline health, used to qualify success toasts. Polled slowly: the outbox
   * backlog changes when something is written or when the relay runs, so a
   * half-minute cadence is enough to catch a broker outage without adding traffic.
   */
  const outbox = useGetOutboxStatusQuery(undefined, { pollingInterval: 30000 });
  const outboxPending = outbox.data?.pending ?? 0;
  const outboxGaveUp = outbox.data?.gaveUp ?? 0;
  const outboxNote =
    outboxGaveUp > 0
      ? `Recorded, but ${outboxGaveUp} event(s) failed to reach the broker — check the pipeline outbox.`
      : outboxPending > 0
        ? `Recorded; ${outboxPending} event(s) still queued for the broker, so downstream systems may lag.`
        : undefined;

  /*
   * Keep the selection valid. `pendingStatus` is seeded from the incident's current
   * status when the dialog opens, which is deliberately NOT one of the legal
   * targets — so once the list arrives the selection snaps to the first permitted
   * transition. Without this the `<select>` would render with no matching option
   * and the operator would have to change it twice.
   *
   * Deliberately keyed on the incident id rather than on the `statusTarget` object:
   * a list refetch hands back a new object for the same incident, and keying on the
   * object would reset a choice the operator had already made.
   */
  const statusTargetId = statusTarget?.incidentId;
  useEffect(() => {
    if (statusTargetId === undefined) return;
    if (allowedOptions.length === 0) return;
    setPendingStatus((current) =>
      allowedOptions.includes(current) ? current : allowedOptions[0],
    );
  }, [statusTargetId, allowedOptions]);

  const rows: Incident[] = useMemo(() => {
    if (mode === "severity") return bySeverity.data ?? [];
    if (mode === "region") return inRegion.data ?? [];
    return paged.data?.content ?? [];
  }, [mode, bySeverity.data, inRegion.data, paged.data]);

  const activeQuery = mode === "severity" ? bySeverity : mode === "region" ? inRegion : paged;
  const totalPages = paged.data?.totalPages ?? 0;
  const totalElements = paged.data?.totalElements ?? 0;

  /*
   * Search/filter/sort apply to whatever the current data source returned. In
   * "page" mode that is one server page, so the count is reported by the server
   * footer below rather than by this hook.
   */
  const registryFilters: RegistryFilter[] = [
    {
      key: "severity",
      label: "Any severity",
      options: INCIDENT_SEVERITIES.map((severity) => ({
        value: severity,
        label: humanize(severity),
      })),
      match: (row, value) => (row as Incident).severity === value,
    },
    {
      key: "status",
      label: "Any status",
      options: INCIDENT_STATUSES.map((status) => ({
        value: status,
        label: humanize(status),
      })),
      match: (row, value) => (row as Incident).status === value,
    },
  ];

  const registry = useRegistry<Incident>({
    rows,
    searchFields: (row) => [
      row.incidentId,
      row.locationDescription,
      row.severity,
      row.status,
      humanize(row.severity),
      humanize(row.status),
    ],
    filters: registryFilters,
    sortValues: {
      severity: (row) => SEVERITY_RANK[row.severity ?? "LOW"] ?? 0,
      status: (row) => row.status ?? "",
      priority: (row) => row.priorityScore ?? 0,
      people: (row) => row.affectedPeople ?? 0,
      created: (row) => row.createdAt ?? "",
    },
    initialSort: { key: "priority", direction: "desc" },
    // `rows` is at most one server page; paging again would hide records.
    pageSize: 1000,
  });

  /**
   * Headline figures for the summary strip.
   *
   * Derived from `registry.rows` — the *filtered* set — rather than from the raw
   * server page, so every number describes exactly what the table below is
   * showing. `registry.total` is used for "in view" for the same reason.
   */
  const viewRows = registry.rows;
  const viewCritical = useMemo(
    () =>
      viewRows.filter(
        (row) => row.severity === "CRITICAL" || row.severity === "CATASTROPHIC",
      ).length,
    [viewRows],
  );
  /**
   * SLA breach: the estimated response time exceeds the time-sensitivity window.
   *
   * The table previously printed `"15 / 12 min"` and left the reader to work out
   * whether that was a breach. It is: the incident needed a unit within 12
   * minutes and the estimate is 15. Both fields are optional, so the comparison
   * only fires when both are present.
   */
  const slaBreached = useMemo(
    () =>
      viewRows.filter(
        (row) =>
          row.estimatedResponseTimeMinutes !== undefined &&
          row.timeSensitivityMinutes !== undefined &&
          row.estimatedResponseTimeMinutes > row.timeSensitivityMinutes,
      ).length,
    [viewRows],
  );
  const viewPeople = useMemo(
    () => viewRows.reduce((sum, row) => sum + (row.affectedPeople ?? 0), 0),
    [viewRows],
  );
  /** Open incidents with no allocation attached yet — the actionable backlog. */
  const viewUndispatched = useMemo(
    () =>
      viewRows.filter(
        (row) => (row.allocations ?? []).length === 0 && row.status !== "RESOLVED" &&
          row.status !== "CANCELLED",
      ).length,
    [viewRows],
  );

  const submitStatus = async () => {
    if (!statusTarget?.incidentId) return;
    /*
     * Both guards mirror the disabled state of the Apply button, and exist so a
     * stale closure (a click landing between renders) cannot send an illegal
     * request. Neither can fire while the button is disabled, so returning without
     * a toast is acceptable — but they must not silently *succeed* either.
     *
     * The backend rejects a same-status transition (it treats one as the duplicate
     * a redelivered Kafka command would produce) and anything outside the lifecycle
     * graph, both with 409.
     */
    if (pendingStatus === statusTarget.status) return;
    if (!allowedOptions.includes(pendingStatus)) return;
    const result = await run(
      updateStatus,
      { incidentId: statusTarget.incidentId, status: pendingStatus },
      {
        method: "PATCH",
        successTitle: "Incident status updated",
        successDescription: `${statusTarget.incidentId} → ${pendingStatus}`,
        /*
         * A committed status change is not the same as a delivered one. The write
         * commits first and the event is published after; if the broker is down the
         * row waits in the outbox. Calling out that distinction stops an operator
         * assuming other systems have already seen the transition.
         */
        successNote: outboxNote,
      },
    );
    if (result.ok) {
      setStatusTarget(null);
      void outbox.refetch();
    }
  };

  const submitReassign = async (incident: Incident) => {
    if (!incident.incidentId) return;
    await run(reassignPriority, incident.incidentId, {
      method: "POST",
      successTitle: "Priority recalculated",
      successDescription: `Scores refreshed for ${incident.incidentId}.`,
    });
  };

  const submitDelete = async () => {
    if (!deleteTarget?.incidentId) return;
    const result = await run(removeIncident, deleteTarget.incidentId, {
      method: "DELETE",
      successTitle: "Incident deleted",
      successDescription: `${deleteTarget.incidentId} was removed.`,
    });
    if (result.ok) setDeleteTarget(null);
  };

  const columns: Column<Incident>[] = [
    {
      key: "incidentId",
      header: "Incident",
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          {/*
            Severity rail, matching the dashboard. The register is where triage
            decisions are made, so the same visual language applies: a colour
            column down the left edge reads faster than parsing each badge.
          */}
          <span
            aria-hidden="true"
            className={`h-9 w-1 shrink-0 rounded-full ${
              row.severity === "CATASTROPHIC"
                ? "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.7)]"
                : row.severity === "CRITICAL"
                  ? "bg-rose-400"
                  : row.severity === "HIGH"
                    ? "bg-amber-400"
                    : row.severity === "MEDIUM"
                      ? "bg-sky-400"
                      : "bg-slate-400"
            }`}
          />
          <div className="min-w-0">
            <Mono>{row.incidentId}</Mono>
            <p className="mt-0.5 max-w-[240px] truncate text-[11px] text-slate-500">
              {row.locationDescription}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (row) => <SeverityBadge value={row.severity} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "priority",
      header: "Priority",
      hideBelow: "md",
      render: (row) => (
        <span className="font-semibold tabular-nums text-slate-800">
          {formatNumber(row.priorityScore)}
        </span>
      ),
    },
    {
      key: "people",
      header: "People",
      hideBelow: "lg",
      render: (row) => (
        <span className="tabular-nums">{formatNumber(row.affectedPeople)}</span>
      ),
    },
    {
      key: "eta",
      header: "ETA / window",
      hideBelow: "lg",
      render: (row) => {
        /*
         * The estimate is measured against the window the incident demanded.
         * Printing "15 / 12 min" left the operator to spot the breach; a breach
         * is now stated, with the overrun in minutes.
         */
        const estimate = row.estimatedResponseTimeMinutes;
        const window = row.timeSensitivityMinutes;
        const breach = estimate !== undefined && window !== undefined && estimate > window;
        const overrun = breach ? (estimate as number) - (window as number) : 0;

        return (
          <div className="flex flex-col">
            <span
              className={`text-xs tabular-nums ${breach ? "font-semibold text-rose-300" : "text-slate-600"}`}
              title={
                breach
                  ? `Estimated response exceeds the ${window} min window by ${overrun} min`
                  : "Estimated response time within the time-sensitivity window"
              }
            >
              {formatNumber(estimate)} / {formatNumber(window)} min
            </span>
            {breach && (
              <span className="mt-0.5 text-[10px] font-medium whitespace-nowrap text-rose-400">
                +{overrun} min over
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "created",
      header: "Created",
      hideBelow: "xl",
      render: (row) => (
        <span className="text-xs whitespace-nowrap text-slate-600">
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>
            View
          </Button>
          <Can roles={["ADMIN", "DISPATCHER", "FIELD_OPERATOR"]}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setStatusTarget(row);
                setPendingStatus((row.status ?? "RECEIVED") as IncidentStatus);
              }}
            >
              Status
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={reassignState.isLoading}
              onClick={() => submitReassign(row)}
            >
              Reprioritise
            </Button>
          </Can>
          <Can roles={["ADMIN", "DISPATCHER"]}>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
              onClick={() => setDeleteTarget(row)}
            >
              Delete
            </Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Incidents"
        title="Incident operations"
        description="Intake, triage and lifecycle management across the whole response area."
        actions={
          <Can roles={["ADMIN", "DISPATCHER", "FIELD_OPERATOR"]}>
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              Report incident
            </Button>
          </Can>
        }
      />

      {/*
        Operational summary.
        Sits above the register because it answers "what is open right now"
        without the operator having to read the table. Counts are derived from
        the loaded rows, so they describe *this view*; the total comes from the
        server page so the figure never understates a filtered list.
      */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-xl border border-border-subtle bg-surface px-4 py-3">
        <SummaryMetric label="In view" value={formatNumber(registry.total)} />
        <SummaryMetric
          label="Critical"
          value={formatNumber(viewCritical)}
          tone={viewCritical > 0 ? "rose" : "muted"}
        />
        <SummaryMetric
          label="SLA breached"
          value={formatNumber(slaBreached)}
          tone={slaBreached > 0 ? "amber" : "muted"}
          title="Incidents whose estimated response time exceeds their time-sensitivity window"
        />
        <SummaryMetric
          label="People affected"
          value={formatNumber(viewPeople)}
        />
        <SummaryMetric
          label="Awaiting dispatch"
          value={formatNumber(viewUndispatched)}
          tone={viewUndispatched > 0 ? "sky" : "muted"}
          title="Open incidents with no allocation attached"
        />

        <span className="ml-auto hidden items-center gap-2 text-[11px] text-slate-500 sm:flex">
          {activeQuery.isFetching && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" />
          )}
          {/*
            Deliberately NOT `activeQuery.fulfilledTimeStamp`. `activeQuery` is a
            union of three differently-parameterised hook results, and reading a
            member off that union is exactly what produced the earlier
            "Property does not exist" error. The refresh timestamp is a
            presentation detail, so it reads from a concrete hook instead.
          */}
          {activeQuery.isFetching
            ? "Refreshing…"
            : paged.isSuccess && paged.fulfilledTimeStamp !== undefined
              ? `Updated ${formatRelative(new Date(paged.fulfilledTimeStamp).toISOString())}`
              : "Not loaded"}
        </span>
      </div>

      {/*
        Pipeline degradation banner.

        The outbox was already polled, but its state only reached the operator
        inside a success toast *after* a write — so a broker outage that had been
        running for an hour was invisible until someone happened to change a
        status. Surfacing it up-front means an operator knows a transition will
        commit locally but may not reach downstream systems, before they act on it.
      */}
      {(outboxGaveUp > 0 || outboxPending > 0) && (
        <div
          role="status"
          className={`flex flex-wrap items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${
            outboxGaveUp > 0
              ? "border-rose-400/25 bg-rose-500/10 text-rose-200"
              : "border-amber-400/25 bg-amber-400/10 text-amber-200"
          }`}
        >
          <span
            aria-hidden="true"
            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
              outboxGaveUp > 0 ? "bg-rose-400" : "bg-amber-400"
            }`}
          />
          <span>
            <strong className="font-semibold">Event pipeline degraded.</strong>{" "}
            {outboxGaveUp > 0 ? (
              <>
                {outboxGaveUp} event{outboxGaveUp === 1 ? "" : "s"} exhausted the retry budget and
                need replaying; {outboxPending} still queued.
              </>
            ) : (
              <>
                {outboxPending} event{outboxPending === 1 ? "" : "s"} not yet acknowledged by the
                broker. Changes still commit — downstream systems may lag.
              </>
            )}{" "}
            <Link
              href="/api-explorer"
              className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
            >
              Inspect in API explorer
            </Link>
          </span>
        </div>
      )}

      <Card>
        <CardHeader
          title="Incident register"
          description={
            mode === "page"
              ? `${formatNumber(totalElements)} records · page ${page + 1} of ${Math.max(totalPages, 1)}`
              : mode === "severity"
                ? `All incidents at ${humanize(severity)} severity`
                : "Within the selected bounding box"
          }
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => activeQuery.refetch()}
              loading={activeQuery.isFetching}
            >
              Refresh
            </Button>
          }
        />
        <Toolbar>
          <Field label="Data source">
            <Select
              value={mode}
              onChange={(event) => setMode(event.target.value as FilterMode)}
              className="w-52"
            >
              <option value="page">Paged list (default)</option>
              <option value="severity">Filter by severity</option>
              <option value="region">Bounding box</option>
            </Select>
          </Field>

          {mode === "severity" && (
            <Field label="Severity">
              <Select
                value={severity}
                onChange={(event) =>
                  setSeverity(event.target.value as typeof severity)
                }
                className="w-44"
              >
                {INCIDENT_SEVERITIES.map((item) => (
                  <option key={item} value={item}>
                    {humanize(item)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {mode === "region" && (
            <>
              {(
                [
                  ["minLat", "Min lat"],
                  ["maxLat", "Max lat"],
                  ["minLon", "Min lon"],
                  ["maxLon", "Max lon"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input
                    type="number"
                    step="any"
                    className="w-24"
                    value={regionDraft[key]}
                    onChange={(event) =>
                      setRegionDraft((prev) => ({
                        ...prev,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </Field>
              ))}
              <Button variant="primary" onClick={() => setRegion({ ...regionDraft })}>
                Apply region
              </Button>
            </>
          )}

          {mode === "page" && (
            <Field label="Page size">
              <Select
                value={size}
                onChange={(event) => {
                  setSize(Number(event.target.value));
                  setPage(0);
                }}
                className="w-24"
              >
                {[10, 20, 50, 100].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="ml-auto flex items-end gap-2">
            <Field label="Open by record number" hint="Fast path when you know the id">
              <Input
                className="w-24"
                type="number"
                placeholder="1"
                value={pkId}
                onChange={(event) => setPkId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setPkTarget(pkId.trim());
                }}
              />
            </Field>
            <Button
              variant="secondary"
              onClick={() => setPkTarget(pkId.trim())}
              disabled={pkId === "" || Number.isNaN(Number(pkId))}
            >
              Open
            </Button>
            <Field label="Open by incident" hint="Search the active and visible incidents">
              <Select
                className="w-72"
                value={lookupId}
                onChange={(event) => setLookupId(event.target.value)}
              >
                <option value="">Select an incident…</option>
                {incidentChoices.map((incident) => (
                  <option key={incident.incidentId} value={incident.incidentId}>
                    {incident.locationDescription ?? shortId(incident.incidentId)} ·{" "}
                    {humanize(incident.severity)} · {incident.status}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="secondary"
              onClick={() => setLookupTarget(lookupId)}
              disabled={lookupId === ""}
            >
              Look up
            </Button>
          </div>
        </Toolbar>

        <RegistryToolbar
          trailing={
            registry.isFiltered ? (
              <Button size="sm" variant="ghost" onClick={registry.clearFilters}>
                Clear
              </Button>
            ) : undefined
          }
        >
          <RegistrySearch
            value={registry.query}
            onChange={registry.setQuery}
            placeholder="Search incident ID, location or severity"
          />
          {registryFilters.map((filter) => (
            <RegistryFilterSelect
              key={filter.key}
              filter={filter}
              value={registry.values[filter.key] ?? ""}
              onChange={(value) => registry.setFilter(filter.key, value)}
            />
          ))}
        </RegistryToolbar>

        {activeQuery.isError ? (
          <CardBody>
            <ErrorState
              message={getErrorMessage(activeQuery.error, "Unable to load incidents")}
              onRetry={() => activeQuery.refetch()}
            />
          </CardBody>
        ) : (
          <>
            <RegistryTable
              columns={columns}
              rows={registry.pageRows}
              loading={activeQuery.isLoading}
              rowKey={(row, index) => row.incidentId ?? `row-${index}`}
              sort={registry.sort}
              onToggleSort={registry.toggleSort}
              sortableKeys={["severity", "status", "priority", "people"]}
              // Clicking a row opens the detail drawer; the explicit "View"
              // button stays for keyboards and for the mobile card layout.
              onOpenRow={(row) => setSelected(row)}
              emptyTitle={
                registry.isFiltered
                  ? "No incidents match those filters"
                  : "No incidents for this query"
              }
              emptyDescription={
                registry.isFiltered
                  ? "Clear the search or filters, or widen the data source."
                  : "Report an incident or widen the filter to see results."
              }
              emptyAction={
                <Can roles={["ADMIN", "DISPATCHER", "FIELD_OPERATOR"]}>
                  <Button size="sm" variant="primary" onClick={() => setFormOpen(true)}>
                    Report incident
                  </Button>
                </Can>
              }
            />
            {/*
              Server-side paging stays authoritative in "page" mode. The registry
              pages the rows it was given (one server page), so its own pager is
              hidden here to avoid two competing pagers.
            */}
            {mode !== "page" && (
              <RegistryPager
                page={registry.page}
                pageCount={registry.pageCount}
                total={registry.total}
                size={registry.size}
                onPage={registry.setPage}
                onSize={registry.setSize}
                noun="incident"
              />
            )}
          </>
        )}

        {mode === "page" && totalPages > 0 && (
          <CardFooter>
            <span>
              Showing page {page + 1} of {totalPages} · {totalElements} total
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                disabled={page === 0 || paged.isFetching}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage((prev) => prev + 1)}
                disabled={page + 1 >= totalPages || paged.isFetching}
              >
                Next
              </Button>
            </div>
          </CardFooter>
        )}
      </Card>

      {lookupTarget !== "" && (
        <Card>
          <CardHeader
            title={`Incident ${lookupTarget}`}
            description="Opened by incident ID"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setLookupTarget("")}>
                Close
              </Button>
            }
          />
          <CardBody>
            {lookup.isLoading ? (
              <SkeletonTable rows={4} />
            ) : lookup.isError ? (
              <ErrorState
                message={getErrorMessage(lookup.error, "Incident not found")}
                onRetry={() => lookup.refetch()}
              />
            ) : lookup.data ? (
              <IncidentDetail incident={lookup.data} />
            ) : null}
          </CardBody>
        </Card>
      )}

      {pkTarget !== "" && (
        <Card>
          <CardHeader
            title={`Incident #${pkTarget}`}
            description="Opened by record number"
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPkTarget("");
                  setPkId("");
                }}
              >
                Close
              </Button>
            }
          />
          <CardBody>
            {byPrimaryKey.isLoading ? (
              <SkeletonTable rows={4} />
            ) : byPrimaryKey.isError ? (
              <ErrorState
                message={getErrorMessage(byPrimaryKey.error, "Incident not found")}
                onRetry={() => byPrimaryKey.refetch()}
              />
            ) : byPrimaryKey.data ? (
              <IncidentDetail incident={byPrimaryKey.data} />
            ) : null}
          </CardBody>
        </Card>
      )}

      <IncidentForm open={formOpen} onClose={() => setFormOpen(false)} />
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        size="lg"
        title={selected?.incidentId ?? "Incident"}
        description="Record from the list payload"
      >
        {selected && <IncidentDetail incident={selected} />}
      </Modal>

      <Modal
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        title="Update incident status"
        description="PATCH /incidents/{id}/status?status= — resolved from the business incidentId"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitStatus}
              loading={statusState.isLoading}
              // Nothing legal to apply while the list loads, or when the incident
              // is terminal: submitting then would send the current status back and
              // be rejected with 409. The same applies when the selection still
              // equals the current status, which is why it also disables the button.
              disabled={
                allowedLoading ||
                allowedOptions.length === 0 ||
                pendingStatus === statusTarget?.status
              }
            >
              Apply status
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            Incident <span className="font-mono">{statusTarget?.incidentId}</span> is
            currently <StatusBadge value={statusTarget?.status} />.
          </p>
          <Field label="New status" required>
            <Select
              value={pendingStatus}
              onChange={(event) =>
                setPendingStatus(event.target.value as IncidentStatus)
              }
              disabled={allowedLoading || allowedOptions.length === 0}
            >
              {allowedOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </Field>
          {allowedLoading ? (
            <p className="text-[11px] text-slate-500">
              Loading the permitted transitions…
            </p>
          ) : allowedOptions.length === 0 ? (
            <p className="rounded-lg border border-slate-400/25 bg-slate-400/10 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
              This incident is in a terminal state — the lifecycle allows no further
              transition, so there is nothing to apply.
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-500">
              Only the transitions the lifecycle permits are listed. The server
              answers <code className="font-mono">409 Conflict</code> for anything
              else, naming both states.
            </p>
          )}
          <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            The path variable is the numeric primary key. When only the business{" "}
            <code className="font-mono">incidentId</code> is at hand, it is resolved
            first through{" "}
            <code className="font-mono">
              GET /incidents/incident-id/&#123;incidentId&#125;
            </code>
            ; if that response carries no <code className="font-mono">id</code>, a
            descriptive error is shown instead of a request against a guessed key.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete incident"
        message={
          <>
            Permanently delete{" "}
            <span className="font-mono">{deleteTarget?.incidentId}</span>? Related
            allocations are affected. This cannot be undone.
          </>
        }
        confirmLabel="Delete incident"
        loading={deleteState.isLoading}
        onConfirm={submitDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}



export default function IncidentsPage() {
  return (
    <ClientOnly
      fallback={
        /*
         * Shaped like the real screen (header, summary strip, register panel) so
         * the first paint matches the loaded layout instead of collapsing a
         * one-line header into a full table once hydration completes.
         */
        <div aria-busy="true" aria-live="polite">
          <PageHeader
            eyebrow="Incidents"
            title="Incident operations"
            description="Intake, triage and lifecycle management across the whole response area."
          />
          <div className="flex flex-wrap items-center gap-x-6 rounded-xl border border-border-subtle bg-surface px-4 py-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <Skeleton className="h-2 w-16" />
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
            <div className="border-b border-border-subtle px-4 py-3">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-2 h-2.5 w-56" />
            </div>
            <SkeletonTable rows={8} />
          </div>
        </div>
      }
    >
      <IncidentsView />
    </ClientOnly>
  );
}
