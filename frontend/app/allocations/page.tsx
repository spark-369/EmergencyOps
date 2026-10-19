"use client";

import { useMemo, useState } from "react";
import type { Allocation, AllocationStatus, Incident } from "@/lib/types";
import { ALLOCATION_STATUSES } from "@/lib/types";

import {
  useAllocateResourceMutation,
  useCancelAllocationMutation,
  useGetActiveAllocationsQuery,
  useGetActiveIncidentsQuery,
  useGetAllIncidentsQuery,
  useGetAllocationByIdQuery,
  useGetAllocationsByIncidentQuery,
  useGetAllocationSummaryByIncidentQuery,
  useGetAvailableResourcesQuery,
  useGetIncidentByIncidentIdQuery,
  useUpdateAllocationStatusMutation,
} from "@/lib/store/api";
import { getErrorMessage, useMutationToast } from "@/lib/use-api-notify";
import { useRegistry } from "@/lib/use-registry";
import type { RegistryFilter } from "@/lib/use-registry";
import { ClientOnly } from "@/components/providers/client-only";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, StatCard } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SkeletonStats,
  SkeletonTable,
  Textarea,
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
import { StatusBadge } from "@/components/ui/badge";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { formatDateTime, formatNumber, formatRelative, humanize } from "@/lib/format";
import { shortId } from "@/components/incidents/incident-detail";
import { Can } from "@/components/auth/can";


/* ------------------------------------------------------------ Allocation form */

/**
 * Forward lifecycle stages, in order, for the progress rail.
 *
 * `CANCELLED` and `FAILED` are deliberately absent: they are off-graph exits, not
 * a later stage, so drawing them on a progress track would imply a deployment
 * "reached" cancellation after arriving.
 */
const LIFECYCLE_STAGES = ["PENDING", "ASSIGNED", "EN_ROUTE", "ARRIVED", "COMPLETED"] as const;

/** Colour of the rail once a stage has been reached. */
const LIFECYCLE_TONE: Record<string, string> = {
  PENDING: "bg-sky-400",
  ASSIGNED: "bg-violet-400",
  EN_ROUTE: "bg-sky-400",
  ARRIVED: "bg-amber-400",
  COMPLETED: "bg-emerald-400",
  CANCELLED: "bg-slate-400",
  FAILED: "bg-rose-400",
};

/**
 * Statuses from which nothing further can happen.
 *
 * The backend rejects a transition out of these, so the row's buttons are
 * disabled rather than left to fail with a 409. `CANCELLED` and `FAILED` are
 * terminal too — cancelling an already-cancelled allocation would decrement
 * resource load a second time, which is exactly the kind of double-release the
 * confirmation dialog is meant to prevent, not cause.
 */
const TERMINAL_STATUSES: string[] = ["COMPLETED", "CANCELLED", "FAILED"];

interface AllocateFormState {
  incidentId: string;
  resourceId: string;
  estimatedTravelTimeMinutes: string;
  estimatedResolutionTimeMinutes: string;
  decisionRationale: string;
}

function AllocateForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [values, setValues] = useState<AllocateFormState>({
    incidentId: "",
    resourceId: "",
    estimatedTravelTimeMinutes: "15",
    estimatedResolutionTimeMinutes: "45",
    decisionRationale: "Closest suitable unit with spare capacity",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [allocate, { isLoading }] = useAllocateResourceMutation();
  const run = useMutationToast();
  /*
   * Both sides of an allocation are chosen from a list, never typed.
   *
   * The API wants the incident's business `incidentId` and the resource's UUID
   * `resourceId`; making an operator copy either by hand from another screen was
   * the single easiest way to produce a 404 — and an unreadable one, since the
   * toast could only echo back a string they had no way to verify.
   */
  const activeIncidents = useGetActiveIncidentsQuery(undefined, { skip: !open });
  const availableResources = useGetAvailableResourcesQuery(undefined, {
    skip: !open,
  });

  const set =
    (key: keyof AllocateFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!values.incidentId) next.incidentId = "Choose the incident to allocate for";
    if (!values.resourceId) next.resourceId = "Choose the unit to dispatch";
    if (Number(values.estimatedTravelTimeMinutes) < 0)
      next.estimatedTravelTimeMinutes = "Cannot be negative";
    if (
      !values.estimatedResolutionTimeMinutes ||
      Number(values.estimatedResolutionTimeMinutes) < 1
    )
      next.estimatedResolutionTimeMinutes = "Must be at least 1 minute";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const result = await run(
      allocate,
      {
        incidentId: values.incidentId,
        resourceId: values.resourceId,
        estimatedTravelTimeMinutes: Number(values.estimatedTravelTimeMinutes),
        estimatedResolutionTimeMinutes: Number(values.estimatedResolutionTimeMinutes),
        decisionRationale: values.decisionRationale.trim() || undefined,
      },
      {
        method: "POST",
        successTitle: "Resource allocated",
        successDescription: "The incident moved to ALLOCATING and resource load increased.",
      },
    );

    if (result.ok) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Allocate resource"
      description="Commits the allocation and moves the incident to ALLOCATING."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={isLoading}>
            Create allocation
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Incident"
          required
          error={errors.incidentId}
          hint="Active incidents, highest priority first"
        >
          <Select value={values.incidentId} onChange={set("incidentId")}>
            <option value="">
              {activeIncidents.isLoading ? "Loading incidents…" : "Select an incident…"}
            </option>
            {(activeIncidents.data ?? []).map((incident) => (
              <option key={incident.incidentId} value={incident.incidentId}>
                {incident.locationDescription ?? shortId(incident.incidentId)} ·{" "}
                {humanize(incident.severity)} · {incident.status} · P
                {formatNumber(incident.priorityScore)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Resource"
          required
          error={errors.resourceId}
          hint="Only units currently available"
        >
          <Select value={values.resourceId} onChange={set("resourceId")}>
            <option value="">
              {availableResources.isLoading ? "Loading units…" : "Select a unit…"}
            </option>
            {(availableResources.data ?? []).map((resource) => (
              <option key={resource.resourceId} value={resource.resourceId}>
                {humanize(resource.type)} · load {formatNumber(resource.currentLoad)}/
                {formatNumber(resource.capacity)} · {shortId(resource.resourceId)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Estimated travel (min)"
          required
          error={errors.estimatedTravelTimeMinutes}
        >
          <Input
            type="number"
            min={0}
            value={values.estimatedTravelTimeMinutes}
            onChange={set("estimatedTravelTimeMinutes")}
          />
        </Field>
        <Field
          label="Estimated resolution (min)"
          required
          error={errors.estimatedResolutionTimeMinutes}
        >
          <Input
            type="number"
            min={1}
            value={values.estimatedResolutionTimeMinutes}
            onChange={set("estimatedResolutionTimeMinutes")}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="Decision rationale"
            hint="Optional audit note stored with the allocation"
          >
            <Textarea
              value={values.decisionRationale}
              onChange={set("decisionRationale")}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Live allocation ledger. Rendered only after hydration via `ClientOnly`,
 * because its RTK Query hooks read `Date.now()` on first render.
 */
function AllocationsView() {
  const [formOpen, setFormOpen] = useState(false);
  const [incidentFilter, setIncidentFilter] = useState("");
  const [incidentTarget, setIncidentTarget] = useState("");
  const [view, setView] = useState<"active" | "incident">("active");
  const [lookupAllocationId, setLookupAllocationId] = useState("");
  const [manageTarget, setManageTarget] = useState<Allocation | null>(null);
  const [pendingStatus, setPendingStatus] = useState<AllocationStatus>("EN_ROUTE");
  const [cancelTarget, setCancelTarget] = useState<Allocation | null>(null);

  const run = useMutationToast();
  const [updateStatus, statusState] = useUpdateAllocationStatusMutation();
  const [cancelAllocation, cancelState] = useCancelAllocationMutation();

  /**
   * Whether the pending selection is an earlier lifecycle stage than the current
   * one. Used only to warn in the dialog — the backend remains the authority on
   * what is legal, and a legal-but-backwards move is still worth flagging.
   */
  const movesBackwards =
    manageTarget?.status !== undefined &&
    LIFECYCLE_STAGES.indexOf(pendingStatus as (typeof LIFECYCLE_STAGES)[number]) !== -1 &&
    LIFECYCLE_STAGES.indexOf(manageTarget.status as (typeof LIFECYCLE_STAGES)[number]) !== -1 &&
    LIFECYCLE_STAGES.indexOf(pendingStatus as (typeof LIFECYCLE_STAGES)[number]) <
      LIFECYCLE_STAGES.indexOf(manageTarget.status as (typeof LIFECYCLE_STAGES)[number]);

  const isTerminalTarget = TERMINAL_STATUSES.includes(pendingStatus);

  /**
   * First lifecycle status other than `current`.
   *
   * The dialog used to open with the allocation's own status selected, so the
   * default "Apply status" click re-sent a no-op: `updateAllocationStatus`
   * returns early for a same-status value, so the request "succeeded" without
   * changing anything and the operator saw a misleading toast. Defaulting to the
   * next value in the enum means the first click always does something.
   */
  const nextStatusFor = (current: AllocationStatus | undefined): AllocationStatus =>
    ALLOCATION_STATUSES.find((status) => status !== current) ?? "EN_ROUTE";

  const activeAllocations = useGetActiveAllocationsQuery(undefined, {
    skip: view !== "active",
  });
  const byIncident = useGetAllocationsByIncidentQuery(incidentTarget, {
    skip: view !== "incident" || incidentTarget === "",
  });
  const summary = useGetAllocationSummaryByIncidentQuery(incidentTarget, {
    skip: incidentTarget === "",
  });
  const allocationById = useGetAllocationByIdQuery(Number(lookupAllocationId), {
    skip: lookupAllocationId === "" || Number.isNaN(Number(lookupAllocationId)),
  });
  const incident = useGetIncidentByIncidentIdQuery(incidentTarget, {
    skip: incidentTarget === "",
  });

  /*
   * The scoping dropdown lists the incidents an operator may act on — active ones
   * first, since those are what allocations are created for — so scoping the
   * ledger never requires pasting a UUID. The one page of results is also merged
   * with the active list so an incident that has just moved past a page boundary
   * still appears.
   *
   * This is the view's own query. `AllocateForm` has a same-named hook, but that
   * one is local to the dialog; an earlier revision referenced it from here and
   * threw `ReferenceError: activeIncidents is not defined` at render time, because
   * the two components share no scope.
   */
  const activeIncidents = useGetActiveIncidentsQuery();
  const incidentOptions = useGetAllIncidentsQuery({ page: 0, size: 100 });
  const incidentChoices = useMemo(() => {
    const byId = new Map<string, Incident>();
    for (const incident of [
      ...(activeIncidents.data ?? []),
      ...(incidentOptions.data?.content ?? []),
    ]) {
      if (incident.incidentId) byId.set(incident.incidentId, incident);
    }
    const rank = (status?: string) =>
      status && ["RECEIVED", "PRIORITIZED", "ALLOCATING", "IN_PROGRESS"].includes(status)
        ? 0
        : 1;
    return [...byId.values()].sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        (b.priorityScore ?? 0) - (a.priorityScore ?? 0) ||
        (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
    );
  }, [activeIncidents.data, incidentOptions.data]);

  const rows: Allocation[] = view === "incident" ? (byIncident.data ?? []) : (activeAllocations.data ?? []);
  const activeQuery = view === "incident" ? byIncident : activeAllocations;

  const registryFilters: RegistryFilter[] = [
    {
      key: "status",
      label: "Any status",
      options: ALLOCATION_STATUSES.map((status) => ({
        value: status,
        label: humanize(status),
      })),
      match: (row, value) => (row as Allocation).status === value,
    },
  ];

  const registry = useRegistry<Allocation>({
    rows,
    searchFields: (row) => [
      row.id,
      row.incidentId,
      row.resourceId,
      row.status,
      humanize(row.status),
      row.decisionRationale,
    ],
    filters: registryFilters,
    sortValues: {
      id: (row) => row.id ?? 0,
      status: (row) => row.status ?? "",
      travel: (row) => row.estimatedTravelTimeMinutes ?? 0,
      resolution: (row) => row.estimatedResolutionTimeMinutes ?? 0,
      allocatedAt: (row) => row.allocatedAt ?? "",
    },
    initialSort: { key: "allocatedAt", direction: "desc" },
  });

  /*
   * Headline figures.
   *
   * Read from `registry.rows` — the filtered set — so the numbers describe what
   * the table is actually showing rather than an unrelated endpoint. The pending
   * count is the one exception: it always reports the live PENDING queue (the
   * actionable backlog), whether or not the operator has scoped to an incident.
   */
  const visibleRows = registry.rows;
  const pendingCount = (activeAllocations.data ?? []).length;
  const inFlightCount = useMemo(
    () =>
      visibleRows.filter(
        (row) => row.status === "ASSIGNED" || row.status === "EN_ROUTE" || row.status === "ARRIVED",
      ).length,
    [visibleRows],
  );
  const completedCount = useMemo(
    () => visibleRows.filter((row) => row.status === "COMPLETED").length,
    [visibleRows],
  );
  /**
   * Mean estimated travel time across the visible rows.
   *
   * `null` rather than 0 when nothing has an estimate: a zero would render as
   * "0 min" and read as "units arrive instantly", which is the opposite of the
   * truth.
   */
  const avgTravel = useMemo(() => {
    const estimated = visibleRows
      .map((row) => row.estimatedTravelTimeMinutes)
      .filter((value): value is number => typeof value === "number");
    if (estimated.length === 0) return null;
    return Math.round(estimated.reduce((sum, value) => sum + value, 0) / estimated.length);
  }, [visibleRows]);

  const submitStatus = async () => {
    if (manageTarget?.id === undefined) return;
    // A same-status value is an idempotent no-op server-side, so sending it
    // would only produce a "success" toast for a request that changed nothing.
    if (pendingStatus === manageTarget.status) return;
    const result = await run(
      updateStatus,
      { id: manageTarget.id, status: pendingStatus },
      {
        method: "PATCH",
        successTitle: `Allocation → ${pendingStatus}`,
        successDescription:
          pendingStatus === "COMPLETED"
            ? "Incident marked RESOLVED and resource freed."
            : pendingStatus === "ARRIVED"
              ? "Incident moved to IN_PROGRESS."
              : `Allocation #${manageTarget.id} updated.`,
      },
    );
    if (result.ok) setManageTarget(null);
  };

  const columns: Column<Allocation>[] = [
    {
      key: "id",
      header: "Allocation",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          {/*
            Lifecycle rail. The five forward stages are drawn as a progress
            track so an operator can see at a glance how far a deployment has
            travelled; PENDING is empty, COMPLETED is full.
          */}
          <span aria-hidden="true" className="flex shrink-0 gap-0.5" title={humanize(row.status)}>
            {LIFECYCLE_STAGES.map((stage, index) => {
              const currentIndex = LIFECYCLE_STAGES.indexOf(
                row.status as (typeof LIFECYCLE_STAGES)[number],
              );
              const reached = currentIndex >= index && currentIndex !== -1;
              return (
                <span
                  key={stage}
                  className={`h-3 w-1 rounded-full ${reached ? LIFECYCLE_TONE[row.status ?? ""] ?? "bg-teal-400" : "bg-slate-300"}`}
                />
              );
            })}
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums text-slate-800">
            #{row.id ?? "—"}
          </span>
        </div>
      ),
    },
    {
      key: "incident",
      header: "Incident",
      render: (row) => (
        <button
          type="button"
          className="text-left transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400"
          title="Scope the ledger to this incident"
          onClick={() => {
            if (!row.incidentId) return;
            setIncidentFilter(row.incidentId);
            setIncidentTarget(row.incidentId);
            setView("incident");
          }}
        >
          <Mono>{row.incidentId}</Mono>
        </button>
      ),
    },
    {
      key: "resource",
      header: "Unit",
      render: (row) => <Mono>{row.resourceId}</Mono>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "travel",
      header: "Travel",
      hideBelow: "md",
      render: (row) => (
        <span className="text-xs tabular-nums text-slate-600">
          {formatNumber(row.estimatedTravelTimeMinutes)} min
        </span>
      ),
    },
    {
      key: "resolution",
      header: "Resolution",
      hideBelow: "lg",
      render: (row) => (
        <span className="text-xs tabular-nums text-slate-600">
          {formatNumber(row.estimatedResolutionTimeMinutes)} min
        </span>
      ),
    },
    {
      key: "allocatedAt",
      header: "Allocated",
      hideBelow: "xl",
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-xs whitespace-nowrap text-slate-600">
            {formatDateTime(row.allocatedAt)}
          </span>
          {/*
            Age since allocation. The active queue is worked oldest-first, so how
            long a deployment has been outstanding is the ordering signal that
            matters — an absolute timestamp makes the reader do the subtraction.
          */}
          {row.allocatedAt && !row.completedAt && (
            <span className="mt-0.5 text-[10px] text-slate-500">
              {formatRelative(row.allocatedAt)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => {
        const terminal = TERMINAL_STATUSES.includes(row.status ?? "");
        return (
          <div className="flex items-center justify-end gap-1">
            {/* Advancing and cancelling an allocation is field work; creating one
                is a dispatch decision (dispatcher/admin only). */}
            <Can roles={["ADMIN", "DISPATCHER", "FIELD_OPERATOR"]}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setManageTarget(row);
                  setPendingStatus(nextStatusFor(row.status));
                }}
                disabled={row.id === undefined || terminal}
                title={
                  terminal
                    ? `A ${humanize(row.status)} allocation is terminal and cannot advance`
                    : undefined
                }
              >
                Advance
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                onClick={() => setCancelTarget(row)}
                disabled={row.id === undefined || terminal}
                title={
                  terminal ? `A ${humanize(row.status)} allocation cannot be cancelled` : undefined
                }
              >
                Cancel
              </Button>
            </Can>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Dispatch & allocation"
        description="Assign units to open incidents and drive each deployment through its lifecycle."
        actions={
          <Can roles={["ADMIN", "DISPATCHER"]}>
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              New allocation
            </Button>
          </Can>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Awaiting dispatch"
          value={formatNumber(pendingCount)}
          hint={pendingCount === 0 ? "Queue clear" : "Oldest first — assign a unit"}
          tone={pendingCount === 0 ? "slate" : "amber"}
        />
        <StatCard
          label="In flight"
          value={formatNumber(inFlightCount)}
          hint="Assigned, en route or on scene"
          tone="sky"
        />
        <StatCard
          label="Est. response time"
          value={avgTravel === null ? "—" : `${formatNumber(avgTravel)} min`}
          hint={
            avgTravel === null
              ? "No estimates in view"
              : "Mean travel time across the rows shown"
          }
          tone="violet"
        />
        <StatCard
          label="Resolved here"
          value={formatNumber(completedCount)}
          hint="Completed deployments in this view"
          tone="teal"
        />
      </div>

      {/*
        Incident context.
        Scoping the ledger to one incident is the page's most useful mode, so the
        incident's own state is surfaced beside it instead of being hidden in a
        stat card. Rendered only when an incident is actually selected.
      */}
      {incidentTarget !== "" && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-xs">
          <span className="flex items-center gap-2 font-medium text-slate-700">
            Incident <Mono>{shortId(incidentTarget)}</Mono>
          </span>
          {incident.isLoading ? (
            <span className="text-slate-500">Loading context…</span>
          ) : incident.isError ? (
            <span className="text-amber-300">
              Incident details unavailable — the allocation list is still valid.
            </span>
          ) : incident.data ? (
            <>
              <span className="flex items-center gap-1.5">
                <StatusBadge value={incident.data.status} />
                <span className="text-slate-500">
                  {humanize(incident.data.severity)} · priority{" "}
                  {formatNumber(incident.data.priorityScore)}
                </span>
              </span>
              <span className="text-slate-500">
                {formatNumber((summary.data ?? []).length)} allocation
                {(summary.data ?? []).length === 1 ? "" : "s"} attached
              </span>
              {incident.data.locationDescription && (
                <span className="truncate text-slate-500">{incident.data.locationDescription}</span>
              )}
            </>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              setIncidentTarget("");
              setView("active");
            }}
          >
            Clear
          </Button>
        </div>
      )}

      <Card>
        <CardHeader
          title="Allocation ledger"
          description={
            view === "active"
              ? `${formatNumber(pendingCount)} awaiting dispatch · oldest first`
              : `Allocations attached to ${incidentTarget ? shortId(incidentTarget) : "the selected incident"}`
          }
          actions={
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={view === "active" ? "subtle" : "secondary"}
                onClick={() => setView("active")}
              >
                Active queue
              </Button>
              <Button
                size="sm"
                variant={view === "incident" ? "subtle" : "secondary"}
                onClick={() => setView("incident")}
                disabled={incidentTarget === ""}
              >
                By incident
              </Button>
            </div>
          }
        />
        <Toolbar>
          <Field label="Incident" hint="Choose an incident to scope the ledger">
            <Select
              className="w-72"
              value={incidentFilter}
              onChange={(event) => setIncidentFilter(event.target.value)}
            >
              <option value="">All incidents…</option>
              {incidentChoices.map((incident) => (
                <option key={incident.incidentId} value={incident.incidentId}>
                  {incident.locationDescription ?? shortId(incident.incidentId)} ·{" "}
                  {humanize(incident.severity)} · {incident.status}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="primary"
            onClick={() => {
              if (incidentFilter === "") return;
              setIncidentTarget(incidentFilter);
              setView("incident");
            }}
            disabled={incidentFilter === ""}
          >
            Load allocations
          </Button>
          <div className="ml-auto flex items-end gap-2">
            <Field label="Look up allocation" hint="Enter an allocation number">
              <Input
                className="w-28"
                type="number"
                placeholder="1"
                value={lookupAllocationId}
                onChange={(event) => setLookupAllocationId(event.target.value)}
              />
            </Field>
            <Button
              variant="secondary"
              onClick={() => activeQuery.refetch()}
              loading={activeQuery.isFetching}
            >
              Refresh
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
            placeholder="Search incident, resource or rationale"
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
              message={getErrorMessage(activeQuery.error, "Unable to load allocations")}
              onRetry={() => activeQuery.refetch()}
            />
          </CardBody>
        ) : (
          <>
            <RegistryTable
              columns={columns}
              rows={registry.pageRows}
              loading={activeQuery.isLoading}
              rowKey={(row, index) => row.id ?? `row-${index}`}
              sort={registry.sort}
              onToggleSort={registry.toggleSort}
              sortableKeys={["id", "status", "travel", "resolution"]}
              emptyTitle={
                registry.isFiltered
                  ? "No allocations match those filters"
                  : view === "active"
                    ? "Nothing pending"
                    : "No allocations"
              }
              emptyDescription={
                registry.isFiltered
                  ? "Clear the search or filters to see the full ledger."
                  : view === "active"
                    ? "Every allocation has moved past PENDING."
                    : "Create an allocation or load another incident."
              }
            />
            <RegistryPager
              page={registry.page}
              pageCount={registry.pageCount}
              total={registry.total}
              size={registry.size}
              onPage={registry.setPage}
              onSize={registry.setSize}
              noun="allocation"
            />
          </>
        )}

        {allocationById.data && (
          <CardFooter>
            <span className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-mono font-semibold text-slate-800">
                #{allocationById.data.id}
              </span>
              <StatusBadge value={allocationById.data.status} />
              <span className="text-slate-500">
                Unit {shortId(allocationById.data.resourceId)} · travel{" "}
                {formatNumber(allocationById.data.estimatedTravelTimeMinutes)} min · resolution{" "}
                {formatNumber(allocationById.data.estimatedResolutionTimeMinutes)} min
              </span>
            </span>
          </CardFooter>
        )}
      </Card>

      {incidentTarget !== "" && (
        <Card>
          <CardHeader
            title="Allocation summary"
            description="Every deployment recorded against this incident"
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIncidentTarget("");
                  setView("active");
                }}
              >
                Clear
              </Button>
            }
          />
          <CardBody>
            {summary.isLoading ? (
              <SkeletonTable rows={3} />
            ) : summary.isError ? (
              <ErrorState
                message={getErrorMessage(summary.error, "Summary unavailable")}
                onRetry={() => summary.refetch()}
              />
            ) : (summary.data ?? []).length === 0 ? (
              <EmptyState
                title="No allocations yet"
                description="Dispatch a unit to this incident and its deployment appears here."
                action={
                  <Can roles={["ADMIN", "DISPATCHER"]}>
                    <Button size="sm" variant="primary" onClick={() => setFormOpen(true)}>
                      New allocation
                    </Button>
                  </Can>
                }
              />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {(summary.data ?? []).map((item, index) => (
                  <li
                    key={`${item.id ?? "s"}-${index}`}
                    className="rounded-lg border border-border-subtle bg-slate-100/50 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-700">
                        #{item.id ?? "—"}
                      </span>
                      <StatusBadge value={item.status} />
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-slate-500">
                      {shortId(item.resourceId)} · {humanize(item.resourceType)}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Travel {formatNumber(item.estimatedTravelTimeMinutes)} min ·
                      Resolution {formatNumber(item.estimatedResolutionTimeMinutes)} min
                    </p>
                    {item.decisionRationale && (
                      <p
                        className="mt-1 line-clamp-2 text-[11px] text-slate-500"
                        title={item.decisionRationale}
                      >
                        {item.decisionRationale}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <AllocateForm open={formOpen} onClose={() => setFormOpen(false)} />

      <Modal
        open={manageTarget !== null}
        onClose={() => setManageTarget(null)}
        title={`Advance allocation #${manageTarget?.id ?? ""}`}
        description="Choose the next lifecycle state for this deployment."
        footer={
          <>
            <Button variant="secondary" onClick={() => setManageTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitStatus}
              loading={statusState.isLoading}
              // Re-sending the current status is a no-op on the backend; require
              // an actual change so the success toast means something.
              disabled={manageTarget !== null && pendingStatus === manageTarget.status}
            >
              Apply status
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            Unit <span className="font-mono">{shortId(manageTarget?.resourceId)}</span> for incident{" "}
            <span className="font-mono">{shortId(manageTarget?.incidentId)}</span> is currently{" "}
            <StatusBadge value={manageTarget?.status} />.
          </p>
          <Field
            label="New status"
            required
            hint="The backend rejects a move the lifecycle does not allow"
          >
            <Select
              value={pendingStatus}
              onChange={(event) => setPendingStatus(event.target.value as AllocationStatus)}
            >
              {ALLOCATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humanize(status)}
                </option>
              ))}
            </Select>
          </Field>

          {/*
            Backwards-move warning. The select offers every status, including
            ones earlier in the lifecycle; choosing one is legal to *request* but
            almost never intended, and silently accepting it would rewrite the
            deployment history. Stating it lets the operator catch a mis-click
            before it becomes audit data.
          */}
          {movesBackwards && (
            <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              <strong className="font-semibold">This moves the deployment backwards.</strong> It is
              currently {humanize(manageTarget?.status)}; {humanize(pendingStatus)} is an earlier
              stage. Timestamps already recorded are not cleared.
            </p>
          )}

          {isTerminalTarget && (
            <p className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
              <strong className="font-semibold">This ends the deployment.</strong>{" "}
              {humanize(pendingStatus)} cannot be undone, and the unit is released for reassignment.
            </p>
          )}

          <ul className="panel-inset space-y-1 px-3 py-2 text-[11px] text-slate-500">
            <li>
              <strong>ARRIVED</strong> records the arrival time and sets the incident to
              IN_PROGRESS.
            </li>
            <li>
              <strong>COMPLETED</strong> records completion, resolves the incident and frees
              capacity.
            </li>
            <li>
              <strong>CANCELLED / FAILED</strong> release the reserved resource slot.
            </li>
          </ul>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancel allocation"
        message={
          <>
            Cancel allocation <span className="font-mono">#{cancelTarget?.id}</span>
            {cancelTarget?.incidentId ? ` for incident ${shortId(cancelTarget.incidentId)}` : ""}?
            The resource load is decremented.
          </>
        }
        confirmLabel="Cancel allocation"
        loading={cancelState.isLoading}
        onConfirm={async () => {
          if (cancelTarget?.id === undefined) return;
          const result = await run(cancelAllocation, cancelTarget.id, {
            method: "POST",
            successTitle: "Allocation cancelled",
            successDescription: `Allocation #${cancelTarget.id} → CANCELLED.`,
          });
          if (result.ok) setCancelTarget(null);
        }}
        onCancel={() => setCancelTarget(null)}
      />
    </>
  );
}

export default function AllocationsPage() {
  return (
    <ClientOnly
      fallback={
        <div aria-busy="true" aria-live="polite">
          <PageHeader
            eyebrow="Operations"
            title="Dispatch & allocation"
            description="Assign units to open incidents and drive each deployment through its lifecycle."
          />
          <SkeletonStats count={4} />
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
            <div className="border-b border-border-subtle px-4 py-3">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="mt-2 h-2.5 w-60" />
            </div>
            <SkeletonTable rows={8} />
          </div>
        </div>
      }
    >
      <AllocationsView />
    </ClientOnly>
  );
}
