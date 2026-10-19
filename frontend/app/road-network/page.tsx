"use client";

import { useMemo, useState } from "react";
import type { RoadSegment, RoadStatus } from "@/lib/types";
import { ROAD_STATUSES } from "@/lib/types";
import {
  useCreateRoadSegmentMutation,
  useDeleteRoadSegmentMutation,
  useGetAllRoadSegmentsQuery,
  useGetRoadSegmentByIdQuery,
  useGetRoadSegmentsBetweenLocationsQuery,
  useGetRoadSegmentsByStatusQuery,
  useUpdateRoadStatusMutation,
  useUpdateTravelInfoMutation,
} from "@/lib/store/api";
import { getErrorMessage, useMutationToast } from "@/lib/use-api-notify";
import { useRegistry } from "@/lib/use-registry";
import type { RegistryFilter } from "@/lib/use-registry";
import { ClientOnly } from "@/components/providers/client-only";
import { Button } from "@/components/ui/button";
import { CoordField } from "@/components/ui/coord-field";
import { DEFAULT_PRESETS } from "@/components/ui/leaflet-map";
import { Card, CardBody, CardFooter, CardHeader, StatCard } from "@/components/ui/card";
import {
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SkeletonStats,
  SkeletonTable,
  Toolbar,
} from "@/components/ui/layout";
import type { Column } from "@/components/ui/table";
import {
  RegistryFilterSelect,
  RegistryPager,
  RegistrySearch,
  RegistryTable,
  RegistryToolbar,
} from "@/components/ui/registry";
import { StatusBadge } from "@/components/ui/badge";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import {
  formatCoord,
  formatDateTime,
  formatNumber,
  formatRelative,
  humanize,
  percent,
} from "@/lib/format";
import { Can } from "@/components/auth/can";


/* --------------------------------------------------------- Create segment form */

interface SegmentFormState {
  fromLocation: string;
  toLocation: string;
  fromLatitude: string;
  fromLongitude: string;
  toLatitude: string;
  toLongitude: string;
  distanceKm: string;
  travelTimeMinutes: string;
  status: RoadStatus;
}

const SEGMENT_EMPTY: SegmentFormState = {
  fromLocation: "",
  toLocation: "",
  fromLatitude: "",
  fromLongitude: "",
  toLatitude: "",
  toLongitude: "",
  distanceKm: "",
  travelTimeMinutes: "",
  status: "OPEN",
};

/**
 * Places offered by the from/to selects.
 *
 * Segments already in the ledger are unioned with the map's sector shortcuts so
 * an operator can extend the graph along a location that exists but has no
 * preset, without ever typing a free-form name that would never match it on the
 * `/road-network/route` endpoint.
 */
function buildPlaceOptions(segments: RoadSegment[]): string[] {
  const names = new Set<string>(DEFAULT_PRESETS.map((preset) => preset.label));
  for (const segment of segments) {
    if (segment.fromLocation) names.add(segment.fromLocation);
    if (segment.toLocation) names.add(segment.toLocation);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Preset coordinates for a place name, if it is one of the shortcuts. */
function presetFor(label: string) {
  return DEFAULT_PRESETS.find((preset) => preset.label === label);
}

function validateSegment(values: SegmentFormState) {
  const errors: Record<string, string> = {};
  if (!values.fromLocation.trim()) errors.fromLocation = "Required";
  else if (values.fromLocation.length > 200) errors.fromLocation = "Max 200 characters";
  if (!values.toLocation.trim()) errors.toLocation = "Required";
  else if (values.toLocation.length > 200) errors.toLocation = "Max 200 characters";

  const checkCoord = (raw: string, limit: number, field: string) => {
    const value = Number(raw);
    if (raw === "" || Number.isNaN(value)) errors[field] = "Required";
    else if (value < -limit || value > limit)
      errors[field] = `Between -${limit} and ${limit}`;
  };
  checkCoord(values.fromLatitude, 90, "fromLatitude");
  checkCoord(values.toLatitude, 90, "toLatitude");
  checkCoord(values.fromLongitude, 180, "fromLongitude");
  checkCoord(values.toLongitude, 180, "toLongitude");

  if (values.distanceKm === "" || Number(values.distanceKm) < 0)
    errors.distanceKm = "Must be at least 0";
  if (values.travelTimeMinutes === "" || Number(values.travelTimeMinutes) < 0)
    errors.travelTimeMinutes = "Must be at least 0";
  return errors;
}

function SegmentForm({
  open,
  onClose,
  placeOptions,
}: {
  open: boolean;
  onClose: () => void;
  /** Locations offered by the from/to selects (known segments + map presets). */
  placeOptions: string[];
}) {
  const [values, setValues] = useState<SegmentFormState>(SEGMENT_EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createSegment, { isLoading }] = useCreateRoadSegmentMutation();
  const run = useMutationToast();

  const set =
    (key: keyof SegmentFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((prev) => ({ ...prev, [key]: event.target.value }));

  /**
   * Choosing a preset sector also places that end's pin.
   *
   * Without this the select and the map were independent, so an operator had to
   * pick "Gulshan" *and* separately click Gulshan on the map for the same value.
   * A place that has no preset (an existing segment's street name) leaves the
   * pin alone for the operator to place.
   */
  const setLocation =
    (side: "from" | "to") =>
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const label = event.target.value;
      const preset = presetFor(label);
      setValues((prev) =>
        side === "from"
          ? {
              ...prev,
              fromLocation: label,
              ...(preset
                ? {
                    fromLatitude: String(preset.latitude),
                    fromLongitude: String(preset.longitude),
                  }
                : {}),
            }
          : {
              ...prev,
              toLocation: label,
              ...(preset
                ? {
                    toLatitude: String(preset.latitude),
                    toLongitude: String(preset.longitude),
                  }
                : {}),
            },
      );
    };

  const submit = async () => {
    const next = validateSegment(values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const result = await run(
      createSegment,
      {
        fromLocation: values.fromLocation.trim(),
        toLocation: values.toLocation.trim(),
        fromLatitude: Number(values.fromLatitude),
        fromLongitude: Number(values.fromLongitude),
        toLatitude: Number(values.toLatitude),
        toLongitude: Number(values.toLongitude),
        distanceKm: Number(values.distanceKm),
        travelTimeMinutes: Number(values.travelTimeMinutes),
        status: values.status,
      },
      {
        method: "POST",
        successTitle: "Road segment created",
        successDescription: `${values.fromLocation} → ${values.toLocation}`,
      },
    );

    if (result.ok) {
      setValues(SEGMENT_EMPTY);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Create road segment"
      description="Add a directed edge to the routing graph. Distances and travel times feed every ETA."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={isLoading}>
            Create segment
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From location" required error={errors.fromLocation}>
          <Select value={values.fromLocation} onChange={setLocation("from")}>
            <option value="">Select a place…</option>
            {placeOptions.map((place) => (
              <option key={place} value={place}>
                {place}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To location" required error={errors.toLocation}>
          <Select value={values.toLocation} onChange={setLocation("to")}>
            <option value="">Select a place…</option>
            {placeOptions.map((place) => (
              <option key={place} value={place}>
                {place}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          The two segment ends are picked on a map, not typed. Choosing a known
          sector in the selects above also drops that end's pin, so the common case
          needs no map interaction at all.
        */}
        <div className="sm:col-span-2 grid gap-3 lg:grid-cols-2">
          <div className="panel-inset p-3">
            <CoordField
              label="From point"
              latitude={values.fromLatitude}
              longitude={values.fromLongitude}
              latitudeError={errors.fromLatitude}
              longitudeError={errors.fromLongitude}
              height={190}
              onChange={(latitude, longitude) =>
                setValues((prev) => ({
                  ...prev,
                  fromLatitude: latitude,
                  fromLongitude: longitude,
                }))
              }
            />
          </div>
          <div className="panel-inset p-3">
            <CoordField
              label="To point"
              latitude={values.toLatitude}
              longitude={values.toLongitude}
              latitudeError={errors.toLatitude}
              longitudeError={errors.toLongitude}
              height={190}
              onChange={(latitude, longitude) =>
                setValues((prev) => ({
                  ...prev,
                  toLatitude: latitude,
                  toLongitude: longitude,
                }))
              }
            />
          </div>
        </div>

        <Field label="Distance (km)" required error={errors.distanceKm}>
          <Input type="number" step="any" min={0} value={values.distanceKm} onChange={set("distanceKm")} />
        </Field>
        <Field label="Travel time (min)" required error={errors.travelTimeMinutes}>
          <Input
            type="number"
            step="any"
            min={0}
            value={values.travelTimeMinutes}
            onChange={set("travelTimeMinutes")}
          />
        </Field>
        <Field label="Status" hint="Defaults to OPEN on the backend">
          <Select value={values.status} onChange={set("status")}>
            {ROAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

type RoadMode = "all" | "status" | "route";

/**
 * Live road-network view. Rendered only after hydration via `ClientOnly`,
 * because its RTK Query hooks read `Date.now()` on first render.
 */
function RoadNetworkView() {
  const [mode, setMode] = useState<RoadMode>("all");
  const [statusFilter, setStatusFilter] = useState<RoadStatus>("OPEN");
  const [routeDraft, setRouteDraft] = useState({ fromLocation: "", toLocation: "" });
  const [route, setRoute] = useState<{ fromLocation: string; toLocation: string } | null>(
    null,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState("");
  const [manageTarget, setManageTarget] = useState<RoadSegment | null>(null);
  const [statusValue, setStatusValue] = useState<RoadStatus>("OPEN");
  const [travel, setTravel] = useState({ distanceKm: "", travelTimeMinutes: "" });
  const [deleteTarget, setDeleteTarget] = useState<RoadSegment | null>(null);

  const run = useMutationToast();
  const [updateStatus, statusState] = useUpdateRoadStatusMutation();
  const [updateTravel, travelState] = useUpdateTravelInfoMutation();
  const [removeSegment, deleteState] = useDeleteRoadSegmentMutation();

  const all = useGetAllRoadSegmentsQuery(undefined, { skip: mode !== "all" });
  const byStatus = useGetRoadSegmentsByStatusQuery(statusFilter, {
    skip: mode !== "status",
  });
  const betweenLocations = useGetRoadSegmentsBetweenLocationsQuery(
    route ?? { fromLocation: "", toLocation: "" },
    { skip: mode !== "route" || route === null },
  );
  const byId = useGetRoadSegmentByIdQuery(Number(detailId), {
    skip: detailId === "" || Number.isNaN(Number(detailId)),
  });

  /*
   * Also fetched while creating a segment: the form's place dropdowns need the
   * names already in the ledger, not just the ones in this view. RTK Query keeps
   * a single cached request per argument, so this costs one call, not two.
   */
  const allSegments = useGetAllRoadSegmentsQuery(undefined, {
    skip: mode === "all" && !formOpen,
  });
  const placeOptions = buildPlaceOptions(allSegments.data ?? []);

  const rows: RoadSegment[] =
    mode === "status"
      ? (byStatus.data ?? [])
      : mode === "route"
        ? (betweenLocations.data ?? [])
        : (all.data ?? []);

  const activeQuery =
    mode === "status" ? byStatus : mode === "route" ? betweenLocations : all;

  const registryFilters: RegistryFilter[] = [
    {
      key: "status",
      label: "Any status",
      options: ROAD_STATUSES.map((status) => ({
        value: status,
        label: humanize(status),
      })),
      match: (row, value) => (row as RoadSegment).status === value,
    },
  ];

  const registry = useRegistry<RoadSegment>({
    rows,
    searchFields: (row) => [
      row.fromLocation,
      row.toLocation,
      `${row.fromLocation ?? ""} ${row.toLocation ?? ""}`,
      row.status,
      humanize(row.status),
      formatCoord(row.fromLatitude, row.fromLongitude),
      formatCoord(row.toLatitude, row.toLongitude),
    ],
    filters: registryFilters,
    sortValues: {
      route: (row) => `${row.fromLocation ?? ""} ${row.toLocation ?? ""}`,
      status: (row) => row.status ?? "",
      distance: (row) => row.distanceKm ?? 0,
      time: (row) => row.travelTimeMinutes ?? 0,
      updated: (row) => row.lastUpdated ?? "",
    },
    initialSort: { key: "route", direction: "asc" },
  });

  const openManage = (segment: RoadSegment) => {
    setManageTarget(segment);
    /*
     * Seed the next status rather than the current one: `updateRoadStatus` is a
     * plain setter, so re-sending the current value "succeeds" while changing
     * nothing — the first Apply click would produce a misleading toast.
     */
    setStatusValue(
      ROAD_STATUSES.find((status) => status !== segment.status) ?? "OPEN",
    );
    setTravel({
      distanceKm: segment.distanceKm !== undefined ? String(segment.distanceKm) : "",
      travelTimeMinutes:
        segment.travelTimeMinutes !== undefined ? String(segment.travelTimeMinutes) : "",
    });
  };

  const submitStatus = async () => {
    if (manageTarget?.id === undefined) return;
    if (statusValue === manageTarget.status) return;
    const result = await run(
      updateStatus,
      { id: manageTarget.id, status: statusValue },
      {
        method: "PATCH",
        successTitle: `Segment → ${statusValue}`,
        successDescription: `${manageTarget.fromLocation} → ${manageTarget.toLocation}`,
      },
    );
    if (result.ok) setManageTarget(null);
  };

  /*
   * True once the operator edits either travel figure. Drives the disabled state
   * of "Save travel info" so an untouched form cannot send an empty PATCH.
   */
  const travelChanged =
    manageTarget !== null &&
    ((travel.distanceKm !== "" && Number(travel.distanceKm) !== manageTarget.distanceKm) ||
      (travel.travelTimeMinutes !== "" &&
        Number(travel.travelTimeMinutes) !== manageTarget.travelTimeMinutes));

  const submitTravel = async () => {
    if (manageTarget?.id === undefined) return;
    /*
     * Blank fields are omitted, so an untouched form would send a PATCH with no
     * query parameters — a request that cannot change anything but still reports
     * success. Require at least one edited value.
     */
    if (!travelChanged) return;
    const result = await run(
      updateTravel,
      {
        id: manageTarget.id,
        travelInfo: {
          distanceKm: travel.distanceKm === "" ? undefined : Number(travel.distanceKm),
          travelTimeMinutes:
            travel.travelTimeMinutes === ""
              ? undefined
              : Number(travel.travelTimeMinutes),
        },
      },
      {
        method: "PATCH",
        successTitle: "Travel info updated",
        successDescription: "Distance / time recalculated for routing.",
      },
    );
    if (result.ok) setManageTarget(null);
  };

  const columns: Column<RoadSegment>[] = [
    {
      key: "route",
      header: "Segment",
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          {/*
            Traversability rail. `CLOSED` removes an edge from the routing graph
            outright, so it reads red; congestion/delay only raise the cost and
            read amber. This is the one property that changes how the optimiser
            behaves, so it leads the row.
          */}
          <span
            aria-hidden="true"
            title={humanize(row.status)}
            className={`h-8 w-1 shrink-0 rounded-full ${
              row.status === "CLOSED"
                ? "bg-rose-500"
                : row.status === "CONGESTED"
                  ? "bg-amber-400"
                  : row.status === "DELAYED"
                    ? "bg-amber-300"
                    : "bg-emerald-400"
            }`}
          />
          <div className="min-w-0">
            <p className="max-w-[240px] truncate text-sm font-medium text-slate-950">
              {row.fromLocation ?? "—"} <span className="text-slate-500">→</span>{" "}
              {row.toLocation ?? "—"}
            </p>
            <p className="truncate font-mono text-[10px] text-slate-500">
              {formatCoord(row.fromLatitude, row.fromLongitude)} →{" "}
              {formatCoord(row.toLatitude, row.toLongitude)}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "distance",
      header: "Distance",
      hideBelow: "md",
      render: (row) => (
        <span className="text-xs tabular-nums text-slate-600">
          {formatNumber(row.distanceKm)} km
        </span>
      ),
    },
    {
      key: "time",
      header: "Travel / implied speed",
      hideBelow: "md",
      render: (row) => {
        const speed = impliedSpeedKmh(row);
        /*
         * A segment implying more than 120 km/h is implausible for a road in
         * this network and will distort every ETA routed through it.
         */
        const implausible = speed !== null && speed > 120;
        return (
          <div className="flex flex-col">
            <span className="text-xs tabular-nums text-slate-600">
              {formatNumber(row.travelTimeMinutes)} min
            </span>
            {speed !== null && (
              <span
                className={`mt-0.5 text-[10px] tabular-nums ${
                  implausible ? "font-semibold text-amber-300" : "text-slate-500"
                }`}
                title={
                  implausible
                    ? "Implied speed is implausibly high — check distance and travel time"
                    : "Speed implied by distance ÷ travel time"
                }
              >
                ≈{formatNumber(Math.round(speed))} km/h
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "updated",
      header: "Updated",
      hideBelow: "xl",
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-xs whitespace-nowrap text-slate-600">
            {formatDateTime(row.lastUpdated)}
          </span>
          {row.lastUpdated && (
            <span className="mt-0.5 text-[10px] text-slate-500">
              {formatRelative(row.lastUpdated)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {/* Segment status/travel edits are field work; creating or deleting a
              segment changes the routing graph and stays dispatcher-level. */}
          <Can roles={["ADMIN", "DISPATCHER", "FIELD_OPERATOR"]}>
            <Button size="sm" variant="secondary" onClick={() => openManage(row)}>
              Manage
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

  const segmentTotal = (all.data ?? []).length;
  const counts = (all.data ?? []).reduce<Record<string, number>>((acc, segment) => {
    const key = segment.status ?? "UNKNOWN";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  /** Slow-moving segments — the ones that inflate every ETA that crosses them. */
  const impairedCount = (counts.CONGESTED ?? 0) + (counts.DELAYED ?? 0);

  /**
   * Total and mean segment length.
   *
   * The mean is what makes the total interpretable: "1 240 km" across 8 segments
   * and across 400 describe very different networks.
   */
  const { totalDistance, avgSegmentKm } = useMemo(() => {
    const segments = all.data ?? [];
    const distance = segments.reduce((sum, segment) => sum + (segment.distanceKm ?? 0), 0);
    return {
      totalDistance: Math.round(distance * 10) / 10,
      avgSegmentKm: segments.length === 0 ? 0 : Math.round((distance / segments.length) * 10) / 10,
    };
  }, [all.data]);

  /**
   * Whether a segment's implied speed is implausible.
   *
   * `distanceKm / travelTimeMinutes` is what actually feeds the router. A pair
   * that implies 400 km/h is a data-entry error that will silently produce
   * impossible ETAs on every incident that routes through it, so it is surfaced
   * rather than left for someone to notice in the numbers.
   */
  const impliedSpeedKmh = (segment: RoadSegment): number | null => {
    const km = segment.distanceKm;
    const minutes = segment.travelTimeMinutes;
    if (km === undefined || minutes === undefined || minutes <= 0) return null;
    return (km / minutes) * 60;
  };

  return (
    <>
      <PageHeader
        eyebrow="Assets"
        title="Road network"
        description="Segments, closures and travel-time corrections that drive the routing heuristics."
        actions={
          <Can roles={["ADMIN", "DISPATCHER"]}>
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              Create segment
            </Button>
          </Can>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open"
          value={formatNumber(counts.OPEN ?? 0)}
          hint={
            segmentTotal === 0
              ? "No segments registered"
              : `${percent(counts.OPEN ?? 0, segmentTotal)}% of ${formatNumber(
                  segmentTotal,
                )} segments`
          }
          tone="teal"
        />
        <StatCard
          label="Congested / delayed"
          value={formatNumber(impairedCount)}
          hint={
            impairedCount === 0
              ? "No slowdowns reported"
              : `${percent(impairedCount, segmentTotal)}% of the network degraded`
          }
          tone={impairedCount === 0 ? "slate" : "amber"}
        />
        <StatCard
          label="Closed"
          value={formatNumber(counts.CLOSED ?? 0)}
          hint={
            (counts.CLOSED ?? 0) === 0
              ? "No closures"
              : "Routing cannot traverse these"
          }
          tone={(counts.CLOSED ?? 0) === 0 ? "slate" : "rose"}
        />
        <StatCard
          label="Network length"
          value={`${formatNumber(totalDistance)} km`}
          hint={
            totalDistance === 0
              ? "No distances recorded"
              : `Mean ${formatNumber(avgSegmentKm)} km per segment`
          }
          tone="violet"
        />
      </div>

      <Card>
        <CardHeader
          title="Network segments"
          description={
            mode === "all"
              ? `All ${formatNumber(segmentTotal)} segments`
              : mode === "status"
                ? `Segments marked ${humanize(statusFilter).toLowerCase()}`
                : route
                  ? `${route.fromLocation} → ${route.toLocation}`
                  : "Choose two places to trace a route"
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
              onChange={(event) => setMode(event.target.value as RoadMode)}
              className="w-52"
            >
              <option value="all">All segments</option>
              <option value="status">By status</option>
              <option value="route">Between locations</option>
            </Select>
          </Field>

          {mode === "status" && (
            <Field label="Status">
              <Select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as RoadStatus)}
                className="w-40"
              >
                {ROAD_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {humanize(status)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {mode === "route" && (
            <>
              <Field label="From location">
                <Select
                  className="w-44"
                  value={routeDraft.fromLocation}
                  onChange={(event) =>
                    setRouteDraft((prev) => ({ ...prev, fromLocation: event.target.value }))
                  }
                >
                  <option value="">Select a place…</option>
                  {placeOptions.map((place) => (
                    <option key={place} value={place}>
                      {place}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To location">
                <Select
                  className="w-44"
                  value={routeDraft.toLocation}
                  onChange={(event) =>
                    setRouteDraft((prev) => ({ ...prev, toLocation: event.target.value }))
                  }
                >
                  <option value="">Select a place…</option>
                  {placeOptions.map((place) => (
                    <option key={place} value={place}>
                      {place}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="primary"
                onClick={() => setRoute({ ...routeDraft })}
                disabled={routeDraft.fromLocation === "" || routeDraft.toLocation === ""}
              >
                Find segments
              </Button>
            </>
          )}

          <div className="ml-auto flex items-end gap-2">
            <Field label="Open by segment id" hint="Fast path when you know the id">
              <Input
                className="w-24"
                type="number"
                placeholder="1"
                value={detailId}
                onChange={(event) => setDetailId(event.target.value)}
              />
            </Field>
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
            placeholder="Search route, status or coordinates"
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
              message={getErrorMessage(activeQuery.error, "Unable to load segments")}
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
              sortableKeys={["route", "status", "distance", "time"]}
              emptyTitle={
                registry.isFiltered
                  ? "No segments match those filters"
                  : "No segments found"
              }
              emptyDescription={
                registry.isFiltered
                  ? "Clear the search or filters to see the whole network."
                  : "Create a segment or widen the data source."
              }
              emptyAction={
                <Can roles={["ADMIN", "DISPATCHER"]}>
                  <Button size="sm" variant="primary" onClick={() => setFormOpen(true)}>
                    Create segment
                  </Button>
                </Can>
              }
            />
            <RegistryPager
              page={registry.page}
              pageCount={registry.pageCount}
              total={registry.total}
              size={registry.size}
              onPage={registry.setPage}
              onSize={registry.setSize}
              noun="segment"
            />
          </>
        )}

        {byId.data && (
          <CardFooter>
            <span className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-mono font-semibold text-slate-800">#{byId.data.id}</span>
              <StatusBadge value={byId.data.status} />
              <span className="text-slate-500">
                {byId.data.fromLocation} → {byId.data.toLocation} ·{" "}
                {formatNumber(byId.data.distanceKm)} km · {formatNumber(byId.data.travelTimeMinutes)}{" "}
                min
              </span>
              {impliedSpeedKmh(byId.data) !== null && (
                <span className="text-slate-500">
                  ≈{formatNumber(Math.round(impliedSpeedKmh(byId.data) ?? 0))} km/h
                </span>
              )}
            </span>
          </CardFooter>
        )}
      </Card>

      <SegmentForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        placeOptions={placeOptions}
      />

      <Modal
        open={manageTarget !== null}
        onClose={() => setManageTarget(null)}
        size="lg"
        title={`Segment #${manageTarget?.id ?? ""}`}
        description={`${manageTarget?.fromLocation ?? ""} → ${manageTarget?.toLocation ?? ""}`}
      >
        <div className="space-y-4">
          {/*
            Current travel figures. Distance and time are set absolutely, and they
            are what the router divides to get an ETA — so the present values must
            be visible while they are being replaced.
          */}
          <div className="panel-inset px-3 py-2">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              Current travel information
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <StatusBadge value={manageTarget?.status} />
              <span className="tabular-nums">
                {formatNumber(manageTarget?.distanceKm)} km ·{" "}
                {formatNumber(manageTarget?.travelTimeMinutes)} min
              </span>
              {manageTarget && impliedSpeedKmh(manageTarget) !== null && (
                <span className="tabular-nums text-slate-500">
                  ≈{formatNumber(Math.round(impliedSpeedKmh(manageTarget) ?? 0))} km/h implied
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Status" hint="Closures remove this segment from routing entirely">
              <Select
                value={statusValue}
                onChange={(event) => setStatusValue(event.target.value as RoadStatus)}
              >
                {ROAD_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {humanize(status)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button
                variant="primary"
                loading={statusState.isLoading}
                onClick={submitStatus}
                disabled={statusValue === manageTarget?.status}
              >
                Update status
              </Button>
            </div>
          </div>

          <div className="panel-inset p-3">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              Travel information
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Correct the distance and travel time after a closure or roadworks. Blank values are
              left unchanged.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Distance (km)">
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={travel.distanceKm}
                  onChange={(event) =>
                    setTravel((prev) => ({ ...prev, distanceKm: event.target.value }))
                  }
                />
              </Field>
              <Field label="Travel time (min)">
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={travel.travelTimeMinutes}
                  onChange={(event) =>
                    setTravel((prev) => ({ ...prev, travelTimeMinutes: event.target.value }))
                  }
                />
              </Field>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="primary"
                loading={travelState.isLoading}
                onClick={submitTravel}
                disabled={!travelChanged}
              >
                Save travel info
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete road segment"
        message={
          <>
            Delete segment <span className="font-mono">#{deleteTarget?.id}</span> (
            {deleteTarget?.fromLocation} → {deleteTarget?.toLocation})? Routing will no
            longer consider it.
          </>
        }
        confirmLabel="Delete segment"
        loading={deleteState.isLoading}
        onConfirm={async () => {
          if (deleteTarget?.id === undefined) return;
          const result = await run(removeSegment, deleteTarget.id, {
            method: "DELETE",
            successTitle: "Segment deleted",
            successDescription: `${deleteTarget.fromLocation} → ${deleteTarget.toLocation} removed.`,
          });
          if (result.ok) setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export default function RoadNetworkPage() {
  return (
    <ClientOnly
      fallback={
        <div aria-busy="true" aria-live="polite">
          <PageHeader
            eyebrow="Assets"
            title="Road network"
            description="Segments, closures and travel-time corrections that drive the routing heuristics."
          />
          <SkeletonStats count={4} />
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
      <RoadNetworkView />
    </ClientOnly>
  );
}

