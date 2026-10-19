"use client";

import { useMemo, useState } from "react";
import type { Resource, ResourceStatus, ResourceType } from "@/lib/types";
import { RESOURCE_STATUSES, RESOURCE_TYPES } from "@/lib/types";
import {
  useCreateResourceMutation,
  useDeleteResourceMutation,
  useGetAllResourcesQuery,
  useGetAvailableResourcesQuery,
  useGetResourceByIdQuery,
  useGetResourceByResourceIdQuery,
  useGetResourcesByTypeQuery,
  useGetResourcesInRegionQuery,
  useReportResourceFailureMutation,
  useReportResourceMaintenanceMutation,
  useRestoreResourceMutation,
  useUpdateResourceLoadMutation,
  useUpdateResourceLocationMutation,
  useUpdateResourceStatusMutation,
} from "@/lib/store/api";
import { getErrorMessage, useMutationToast } from "@/lib/use-api-notify";
import { useRegistry } from "@/lib/use-registry";
import type { RegistryFilter } from "@/lib/use-registry";
import { ClientOnly } from "@/components/providers/client-only";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, StatCard } from "@/components/ui/card";
import {
  ErrorState,
  Field,
  Input,
  Meter,
  PageHeader,
  Select,
  Skeleton,
  SkeletonStats,
  SkeletonTable,
  Toolbar,
} from "@/components/ui/layout";
import type { Column } from "@/components/ui/table";
import { CoordField } from "@/components/ui/coord-field";
import { KeyValueEditor, type JsonEntries } from "@/components/ui/key-value-editor";
import {
  RegistryFilterSelect,
  RegistryPager,
  RegistrySearch,
  RegistryTable,
  RegistryToolbar,
} from "@/components/ui/registry";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { formatCoord, formatDateTime, formatNumber, formatRelative, humanize, percent } from "@/lib/format";
import { shortId } from "@/components/incidents/incident-detail";
import { Can } from "@/components/auth/can";

/* ------------------------------------------------------------ Create form */

interface ResourceFormState {
  type: ResourceType;
  latitude: string;
  longitude: string;
  capacity: string;
  travelSpeedKmh: string;
  /** Structured object; the editor guarantees a valid shape. */
  operationalConstraints?: JsonEntries;
}

const RESOURCE_FORM_EMPTY: ResourceFormState = {
  type: "AMBULANCE",
  latitude: "",
  longitude: "",
  capacity: "4",
  travelSpeedKmh: "60",
  operationalConstraints: undefined,
};

function validateResourceForm(values: ResourceFormState) {
  const errors: Record<string, string> = {};
  const lat = Number(values.latitude);
  const lon = Number(values.longitude);
  const capacity = Number(values.capacity);
  const speed = Number(values.travelSpeedKmh);

  if (values.latitude === "" || Number.isNaN(lat))
    errors.latitude = "Latitude is required";
  else if (lat < -90 || lat > 90) errors.latitude = "Must be between -90 and 90";

  if (values.longitude === "" || Number.isNaN(lon))
    errors.longitude = "Longitude is required";
  else if (lon < -180 || lon > 180) errors.longitude = "Must be between -180 and 180";

  if (Number.isNaN(capacity) || capacity < 1) errors.capacity = "Capacity must be at least 1";
  if (Number.isNaN(speed) || speed < 1) errors.travelSpeedKmh = "Speed must be at least 1 km/h";

  return errors;
}

function ResourceForm({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [values, setValues] = useState<ResourceFormState>(RESOURCE_FORM_EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createResource, { isLoading }] = useCreateResourceMutation();
  const run = useMutationToast();

  /*
   * Scalar keys only — `operationalConstraints` is an object written by the
   * `KeyValueEditor`. Narrowing the key (rather than casting the result) keeps
   * the "no object field can be set from a change event" rule enforced by the
   * compiler instead of by a comment.
   */
  type ScalarKey = {
    [K in keyof ResourceFormState]-?: ResourceFormState[K] extends string ? K : never;
  }[keyof ResourceFormState];

  const set =
    (key: ScalarKey) =>
    (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const value = event.target.value;
      setValues((prev) => ({ ...prev, [key]: value }));
    };

  const submit = async () => {
    const validationErrors = validateResourceForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const result = await run(
      createResource,
      {
        type: values.type,
        latitude: Number(values.latitude),
        longitude: Number(values.longitude),
        capacity: Number(values.capacity),
        travelSpeedKmh: Number(values.travelSpeedKmh),
        operationalConstraints: values.operationalConstraints,
      },
      {
        method: "POST",
        successTitle: "Resource registered",
        successDescription: "The backend assigned a UUID resource identifier.",
      },
    );

    if (result.ok) {
      setValues(RESOURCE_FORM_EMPTY);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Register resource"
      description="Add a unit to the fleet. An identifier is assigned automatically."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={isLoading}>
            Register resource
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" required>
          <Select value={values.type} onChange={set("type")}>
            {RESOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanize(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Travel speed (km/h)" required error={errors.travelSpeedKmh}>
          <Input type="number" min={1} value={values.travelSpeedKmh} onChange={set("travelSpeedKmh")} />
        </Field>
        <div className="sm:col-span-2">
          <CoordField
            latitude={values.latitude}
            longitude={values.longitude}
            latitudeError={errors.latitude}
            longitudeError={errors.longitude}
            onChange={(latitude, longitude) =>
              setValues((prev) => ({ ...prev, latitude, longitude }))
            }
          />
        </div>
        <Field label="Capacity" required error={errors.capacity} hint="Maximum concurrent assignments">
          <Input type="number" min={1} value={values.capacity} onChange={set("capacity")} />
        </Field>
        <KeyValueEditor
          field="operationalConstraints"
          label="Operational constraints"
          hint="Optional — fuel, crew status, restrictions."
          value={values.operationalConstraints}
          onChange={(next) =>
            setValues((prev) => ({ ...prev, operationalConstraints: next }))
          }
        />
      </div>
      <p className="panel-inset mt-3 px-3 py-2 text-[11px] text-slate-500">
        Units are registered as available with no load. Move them to a location on the map, then
        adjust load from the Manage panel as deployments are assigned.
      </p>
    </Modal>
  );
}

type ResourceMode = "all" | "available" | "type" | "region";

interface RegionState {
  minLat: string;
  maxLat: string;
  minLon: string;
  maxLon: string;
}

/**
 * Default bounding box for the "region" data source.
 *
 * `0..100` (the previous default) is not a valid latitude range and excluded the
 * seeded fleet, which sits around Dhaka — so the endpoint looked broken. The box
 * below covers the demo area and can be narrowed with Apply region.
 */
const REGION_DEFAULT: RegionState = {
  minLat: "20",
  maxLat: "27",
  minLon: "88",
  maxLon: "93",
};

/**
 * Live resource registry. Rendered only after hydration via `ClientOnly`,
 * because its RTK Query hooks read `Date.now()` on first render.
 */
function ResourcesView() {
  const [mode, setMode] = useState<ResourceMode>("all");
  const [type, setType] = useState<ResourceType>("AMBULANCE");
  const [regionDraft, setRegionDraft] = useState<RegionState>(REGION_DEFAULT);
  const [region, setRegion] = useState<RegionState>(REGION_DEFAULT);

  const [formOpen, setFormOpen] = useState(false);

  /*
   * Numeric PK used by every mutating resource path variable.
   *
   * Set from the row the operator clicked (see the Manage button), never typed:
   * the write endpoints address a resource by its numeric key, and a hand-typed
   * id could silently belong to a different unit.
   */
  const [targetId, setTargetId] = useState("");
  const [active, setActive] = useState<Resource | null>(null);

  const [statusValue, setStatusValue] = useState<ResourceStatus>("AVAILABLE");
  const [latValue, setLatValue] = useState("");
  const [lonValue, setLonValue] = useState("");
  const [loadValue, setLoadValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Resource | null>(null);
  const [lookupResourceId, setLookupResourceId] = useState("");

  const run = useMutationToast();
  const [updateStatus, statusState] = useUpdateResourceStatusMutation();
  const [updateLocation, locationState] = useUpdateResourceLocationMutation();
  const [updateLoad, loadState] = useUpdateResourceLoadMutation();
  const [reportFailure, failureState] = useReportResourceFailureMutation();
  const [reportMaintenance, maintenanceState] = useReportResourceMaintenanceMutation();
  const [restore, restoreState] = useRestoreResourceMutation();
  const [removeResource, deleteState] = useDeleteResourceMutation();

  const all = useGetAllResourcesQuery(undefined, { skip: mode !== "all" });
  const available = useGetAvailableResourcesQuery(undefined, {
    skip: mode !== "available",
  });
  const byType = useGetResourcesByTypeQuery(type, { skip: mode !== "type" });
  const inRegion = useGetResourcesInRegionQuery(
    {
      minLat: Number(region.minLat),
      maxLat: Number(region.maxLat),
      minLon: Number(region.minLon),
      maxLon: Number(region.maxLon),
    },
    { skip: mode !== "region" },
  );
  const byNumericId = useGetResourceByIdQuery(Number(targetId), {
    skip: targetId === "" || Number.isNaN(Number(targetId)),
  });
  const byResourceId = useGetResourceByResourceIdQuery(lookupResourceId, {
    skip: lookupResourceId === "",
  });

  const rows: Resource[] = useMemo(() => {
    if (mode === "available") return available.data ?? [];
    if (mode === "type") return byType.data ?? [];
    if (mode === "region") return inRegion.data ?? [];
    return all.data ?? [];
  }, [mode, available.data, byType.data, inRegion.data, all.data]);

  /*
   * Client-side search/filter/sort over the current data source. The API
   * endpoints return full collections, so this never hides records the server
   * would have returned — it only narrows what is already in memory.
   */
  const registryFilters: RegistryFilter[] = [
    {
      key: "status",
      label: "Any status",
      options: RESOURCE_STATUSES.map((status) => ({
        value: status,
        label: humanize(status),
      })),
      match: (row, value) => (row as Resource).status === value,
    },
    {
      key: "availability",
      label: "Any availability",
      options: [
        { value: "available", label: "Available" },
        { value: "unavailable", label: "Unavailable" },
      ],
      match: (row, value) =>
        value === "available" ? Boolean((row as Resource).available) : !(row as Resource).available,
    },
  ];

  const registry = useRegistry<Resource>({
    rows,
    searchFields: (row) => [
      row.type,
      humanize(row.type),
      row.status,
      row.resourceId,
      formatCoord(row.latitude, row.longitude),
    ],
    filters: registryFilters,
    sortValues: {
      type: (row) => humanize(row.type),
      status: (row) => row.status ?? "",
      load: (row) => percent(row.currentLoad, row.capacity),
      speed: (row) => row.travelSpeedKmh ?? 0,
      updated: (row) => row.updatedAt ?? "",
    },
    initialSort: { key: "type", direction: "asc" },
  });

  const activeQuery =
    mode === "available" ? available : mode === "type" ? byType : mode === "region" ? inRegion : all;

  /*
   * Fleet figures.
   *
   * Computed from `all.data` rather than the filtered view: "how much of my
   * fleet is deployable" is a whole-fleet question, and answering it from a
   * bounding-box or type-filtered subset would make the headline shift every
   * time the operator changed the data source.
   */
  const fleet = useMemo(() => all.data ?? [], [all.data]);
  const fleetTotal = fleet.length;
  const deployableCount = fleet.filter((resource) => resource.available).length;
  const deployablePercent = percent(deployableCount, fleetTotal);
  const underLoadCount = fleet.filter((resource) => (resource.currentLoad ?? 0) > 0).length;
  const outOfServiceCount = fleet.filter(
    (resource) => resource.status === "MAINTENANCE" || resource.status === "OFFLINE",
  ).length;
  /**
   * Total load as a share of total capacity.
   *
   * `null` when the fleet has no capacity recorded: a 0 % reading would suggest
   * an idle fleet, when the truth is that there is nothing to measure.
   */
  const fleetUtilisation = useMemo(() => {
    const totalCapacity = fleet.reduce((sum, resource) => sum + (resource.capacity ?? 0), 0);
    if (totalCapacity <= 0) return null;
    const totalLoad = fleet.reduce((sum, resource) => sum + (resource.currentLoad ?? 0), 0);
    return percent(totalLoad, totalCapacity);
  }, [fleet]);

  /**
   * Statuses a unit may move to from its current state.
   *
   * `OFFLINE` and `MAINTENANCE` are recovery states: a unit in either must go
   * through "Restore to service" rather than being flipped to AVAILABLE by the
   * plain status select, which would skip the restore endpoint and leave the
   * failure bookkeeping inconsistent. Offering only the legal targets is the
   * difference between a dropdown and a guardrail.
   */
  const statusOptionsFor = (resource: Resource | null): ResourceStatus[] => {
    /*
     * Out-of-service units get exactly one legal target. The select is disabled
     * in that case (see the modal), so this list is a guardrail for the submit
     * button rather than a menu.
     */
    if (resource?.status === "OFFLINE" || resource?.status === "MAINTENANCE") {
      return ["AVAILABLE"];
    }
    return RESOURCE_STATUSES.filter(
      (status) => status !== "OFFLINE" && status !== "MAINTENANCE",
    );
  };

  const numericId = Number(targetId);
  const hasId = targetId !== "" && !Number.isNaN(numericId);

  const runStatus = async (resource: Resource, status: ResourceStatus) => {
    if (!hasId) return;
    await run(
      updateStatus,
      { id: numericId, status },
      {
        method: "PATCH",
        successTitle: `Status → ${status}`,
        successDescription: `${shortId(resource.resourceId)} updated.`,
      },
    );
  };

  const runAction = async (
    trigger: (id: number) => { unwrap: () => Promise<void> },
    resource: Resource,
    title: string,
  ) => {
    if (!hasId) return;
    await run(trigger, numericId, {
      method: "POST",
      successTitle: title,
      successDescription: `${shortId(resource.resourceId)} updated.`,
    });
  };




  const columns: Column<Resource>[] = [
    {
      key: "resourceId",
      header: "Unit",
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          {/*
            Service-state rail. `available` is a boolean the backend derives from
            status and load, so it is the single most useful thing to see first;
            a colour column reads faster than a badge on every row.
          */}
          <span
            aria-hidden="true"
            title={row.available ? "Deployable" : "Not deployable"}
            className={`h-8 w-1 shrink-0 rounded-full ${
              row.status === "OFFLINE"
                ? "bg-rose-500"
                : row.status === "MAINTENANCE"
                  ? "bg-amber-400"
                  : row.available
                    ? "bg-emerald-400"
                    : "bg-slate-400"
            }`}
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-950">{humanize(row.type)}</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
              {shortId(row.resourceId)}
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
      key: "available",
      header: "Deployable",
      hideBelow: "sm",
      render: (row) =>
        row.available ? (
          <Badge label="Ready" tone="success" dot />
        ) : (
          <Badge
            label="Unavailable"
            tone="danger"
            dot
            title={
              row.status === "MAINTENANCE" || row.status === "OFFLINE"
                ? `Marked ${row.status} — use Restore to service`
                : "At capacity or otherwise unavailable"
            }
          />
        ),
    },
    {
      key: "load",
      header: "Load",
      hideBelow: "md",
      render: (row) => (
        <div className="w-28">
          <Meter
            value={row.currentLoad}
            max={row.capacity}
            showValue
            label={`${humanize(row.type)} load`}
          />
        </div>
      ),
    },
    {
      key: "speed",
      header: "Speed",
      hideBelow: "lg",
      render: (row) => (
        <span className="text-xs tabular-nums text-slate-600">
          {formatNumber(row.travelSpeedKmh)} km/h
        </span>
      ),
    },
    {
      key: "coords",
      header: "Location",
      hideBelow: "xl",
      render: (row) => (
        <span className="font-mono text-[11px] whitespace-nowrap text-slate-600">
          {formatCoord(row.latitude, row.longitude)}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      hideBelow: "xl",
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-xs whitespace-nowrap text-slate-600">
            {formatDateTime(row.updatedAt)}
          </span>
          {row.updatedAt && (
            <span className="mt-0.5 text-[10px] text-slate-500">
              {formatRelative(row.updatedAt)}
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
          {/* Status / location / load and the failure-maintenance-restore loop are
              field-operator tasks; registration and deletion are dispatcher-level. */}
          <Can roles={["ADMIN", "DISPATCHER", "FIELD_OPERATOR"]}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setActive(row);
                /*
                 * Seed the numeric id from the row. The write endpoints address a
                 * resource by its numeric primary key, and the modal's fieldset is
                 * gated on `hasId`. Without this the panel opened fully disabled
                 * ("Enter a Numeric ID in the toolbar") even though the operator had
                 * just clicked the row — and any id they then typed by hand could
                 * belong to a different unit.
                 */
                setTargetId(row.id !== undefined ? String(row.id) : "");
                setStatusValue((row.status ?? "AVAILABLE") as ResourceStatus);
                /*
                 * The relocation map starts *unpinned*, centred on the unit. Seeding
                 * the inputs with the current position made the "new location" the
                 * old one, so clicking the map looked like it did nothing.
                 */
                setLatValue("");
                setLonValue("");
                setLoadValue(row.currentLoad !== undefined ? String(row.currentLoad) : "");
              }}
            >
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

  return (
    <>
      <PageHeader
        eyebrow="Assets"
        title="Resource registry"
        description="Ambulances, rescue teams, aircraft and support units — availability, load and service state."
        actions={
          <Can roles={["ADMIN", "DISPATCHER"]}>
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              Register resource
            </Button>
          </Can>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Deployable now"
          value={`${formatNumber(deployableCount)}/${formatNumber(fleetTotal)}`}
          hint={
            fleetTotal === 0
              ? "No units registered"
              : `${deployablePercent}% of the fleet can be dispatched`
          }
          tone={
            fleetTotal === 0
              ? "slate"
              : deployablePercent >= 50
                ? "teal"
                : deployablePercent > 0
                  ? "amber"
                  : "rose"
          }
        />
        <StatCard
          label="Under load"
          value={formatNumber(underLoadCount)}
          hint="Units carrying an active deployment"
          tone={underLoadCount > 0 ? "sky" : "slate"}
        />
        <StatCard
          label="Out of service"
          value={formatNumber(outOfServiceCount)}
          hint={outOfServiceCount === 0 ? "Nothing down" : "Maintenance or offline"}
          tone={outOfServiceCount > 0 ? "amber" : "slate"}
        />
        <StatCard
          label="Fleet utilisation"
          value={fleetUtilisation === null ? "—" : `${fleetUtilisation}%`}
          hint={
            fleetUtilisation === null
              ? "No capacity recorded"
              : "Total load as a share of total capacity"
          }
          tone={
            fleetUtilisation === null
              ? "slate"
              : fleetUtilisation >= 85
                ? "rose"
                : fleetUtilisation >= 60
                  ? "amber"
                  : "violet"
          }
        />
      </div>

      <Card>
        <CardHeader
          title="Fleet"
          description={
            mode === "all"
              ? `All ${formatNumber(fleetTotal)} units`
              : mode === "available"
                ? `${formatNumber(deployableCount)} units available for dispatch`
                : mode === "type"
                  ? `All ${humanize(type).toLowerCase()} units`
                  : "Units within the selected bounding box"
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
              onChange={(event) => setMode(event.target.value as ResourceMode)}
              className="w-52"
            >
              <option value="all">All resources</option>
              <option value="available">Available only</option>
              <option value="type">By type</option>
              <option value="region">Bounding box</option>
            </Select>
          </Field>

          {mode === "type" && (
            <Field label="Type">
              <Select
                value={type}
                onChange={(event) => setType(event.target.value as ResourceType)}
                className="w-52"
              >
                {RESOURCE_TYPES.map((item) => (
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
                      setRegionDraft((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                  />
                </Field>
              ))}
              <Button variant="primary" onClick={() => setRegion({ ...regionDraft })}>
                Apply region
              </Button>
            </>
          )}

          <div className="ml-auto flex items-end gap-2">
            <Field label="Look up unit" hint="Choose a registered unit to inspect">
              <Select
                className="w-72"
                value={lookupResourceId}
                onChange={(event) => setLookupResourceId(event.target.value)}
              >
                <option value="">Select a unit…</option>
                {(all.data ?? []).map((resource) => (
                  <option key={resource.resourceId} value={resource.resourceId}>
                    {humanize(resource.type)} · {humanize(resource.status)} ·{" "}
                    {shortId(resource.resourceId)}
                  </option>
                ))}
              </Select>
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
            placeholder="Search type, status or location"
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
              message={getErrorMessage(activeQuery.error, "Unable to load resources")}
              onRetry={() => activeQuery.refetch()}
            />
          </CardBody>
        ) : (
          <>
            <RegistryTable
              columns={columns}
              rows={registry.pageRows}
              loading={activeQuery.isLoading}
              rowKey={(row, index) => row.resourceId ?? `row-${index}`}
              sort={registry.sort}
              onToggleSort={registry.toggleSort}
              sortableKeys={["type", "status", "load"]}
              emptyTitle={
                registry.isFiltered
                  ? "No resources match those filters"
                  : "No resources found"
              }
              emptyDescription={
                registry.isFiltered
                  ? "Clear the search or filters to see the whole fleet."
                  : "Register a unit or widen the data source."
              }
              emptyAction={
                <Can roles={["ADMIN", "DISPATCHER"]}>
                  <Button size="sm" variant="primary" onClick={() => setFormOpen(true)}>
                    Register resource
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
              noun="resource"
            />
          </>
        )}

        {hasId && byNumericId.data && (
          <CardFooter>
            <span className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-mono font-semibold text-slate-800">
                {shortId(byNumericId.data.resourceId)}
              </span>
              <StatusBadge value={byNumericId.data.status} />
              <span className="text-slate-500">
                {humanize(byNumericId.data.type)} · load{" "}
                {formatNumber(byNumericId.data.currentLoad)}/
                {formatNumber(byNumericId.data.capacity)}
              </span>
            </span>
          </CardFooter>
        )}
      </Card>

      {lookupResourceId !== "" && (
        <Card>
          <CardHeader
            title="Unit detail"
            description={`${humanize(byResourceId.data?.type)} · ${shortId(lookupResourceId)}`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setLookupResourceId("")}>
                Close
              </Button>
            }
          />
          <CardBody>
            {byResourceId.isLoading ? (
              <SkeletonTable rows={2} />
            ) : byResourceId.isError ? (
              <ErrorState
                message={getErrorMessage(byResourceId.error, "Resource not found")}
                onRetry={() => byResourceId.refetch()}
              />
            ) : byResourceId.data ? (
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    Type
                  </dt>
                  <dd className="mt-0.5 text-slate-800">{humanize(byResourceId.data.type)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    Status
                  </dt>
                  <dd className="mt-0.5">
                    <StatusBadge value={byResourceId.data.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    Load
                  </dt>
                  <dd className="mt-0.5 tabular-nums text-slate-800">
                    {formatNumber(byResourceId.data.currentLoad)}/
                    {formatNumber(byResourceId.data.capacity)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    Location
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs text-slate-800">
                    {formatCoord(byResourceId.data.latitude, byResourceId.data.longitude)}
                  </dd>
                </div>
              </dl>
            ) : null}
          </CardBody>
        </Card>
      )}

      <ResourceForm open={formOpen} onClose={() => setFormOpen(false)} />

      <Modal
        open={active !== null}
        onClose={() => setActive(null)}
        size="lg"
        title={`Manage ${shortId(active?.resourceId)}`}
        description={
          hasId
            ? `Operating on ${humanize(active?.type)} · ${formatCoord(active?.latitude, active?.longitude)}`
            : "Select a unit from the registry to enable changes."
        }
      >
        <div className="space-y-4">
          <div className="panel-inset px-3 py-2">
            <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Current state
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <StatusBadge value={active?.status} />
              <span>{humanize(active?.type)}</span>
              <span className="tabular-nums">
                Load {formatNumber(active?.currentLoad)}/{formatNumber(active?.capacity)}
              </span>
              <span className="font-mono">
                {formatCoord(active?.latitude, active?.longitude)}
              </span>
            </div>
          </div>

          <fieldset disabled={!hasId} className="space-y-4 disabled:opacity-60">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field
                label="Status"
                hint={
                  active?.status === "OFFLINE" || active?.status === "MAINTENANCE"
                    ? "This unit is out of service — use Restore to service below"
                    : "Choose the unit's current operating state"
                }
              >
                <Select
                  value={statusValue}
                  onChange={(event) => setStatusValue(event.target.value as ResourceStatus)}
                  disabled={
                    active?.status === "OFFLINE" || active?.status === "MAINTENANCE"
                  }
                >
                  {statusOptionsFor(active).map((item) => (
                    <option key={item} value={item}>
                      {humanize(item)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button
                  variant="primary"
                  loading={statusState.isLoading}
                  onClick={() => active && runStatus(active, statusValue)}
                  disabled={
                    (active?.status === "OFFLINE" || active?.status === "MAINTENANCE") &&
                    statusValue !== "AVAILABLE"
                  }
                >
                  Update status
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <CoordField
                label="New location"
                latitude={latValue}
                longitude={lonValue}
                center={
                  active?.latitude !== undefined && active?.longitude !== undefined
                    ? [active.latitude, active.longitude]
                    : undefined
                }
                onChange={(latitude, longitude) => {
                  setLatValue(latitude);
                  setLonValue(longitude);
                }}
              />
              <div className="flex items-center gap-2">
                <p className="text-[11px] text-slate-500">
                  Click the map or type coordinates to reposition this unit. Current position is{" "}
                  <span className="font-mono">
                    {formatCoord(active?.latitude, active?.longitude)}
                  </span>
                  .
                </p>
                <Button
                  variant="secondary"
                  className="ml-auto"
                  loading={locationState.isLoading}
                  onClick={() =>
                    run(
                      updateLocation,
                      {
                        id: numericId,
                        latitude: Number(latValue),
                        longitude: Number(lonValue),
                      },
                      {
                        method: "PATCH",
                        successTitle: "Location updated",
                        successDescription: "Coordinates replaced.",
                      },
                    )
                  }
                  disabled={
                    latValue === "" ||
                    lonValue === "" ||
                    Number.isNaN(Number(latValue)) ||
                    Number.isNaN(Number(lonValue))
                  }
                >
                  Move
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field
                label="Current load"
                hint="Units currently assigned · availability is recalculated automatically"
              >
                <Input
                  type="number"
                  min={0}
                  value={loadValue}
                  onChange={(event) => setLoadValue(event.target.value)}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  loading={loadState.isLoading}
                  onClick={() =>
                    run(
                      updateLoad,
                      { id: numericId, currentLoad: Number(loadValue) },
                      {
                        method: "PATCH",
                        successTitle: "Load updated",
                        successDescription: "Availability recalculated by the backend.",
                      },
                    )
                  }
                  disabled={loadValue === "" || Number.isNaN(Number(loadValue))}
                >
                  Set load
                </Button>
              </div>
            </div>

            <div className="panel-inset p-3">
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Lifecycle actions
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  loading={failureState.isLoading}
                  onClick={() => active && runAction(reportFailure, active, "Failure reported")}
                  className="text-rose-400"
                >
                  Report failure (OFFLINE)
                </Button>
                <Button
                  variant="secondary"
                  loading={maintenanceState.isLoading}
                  onClick={() =>
                    active && runAction(reportMaintenance, active, "Maintenance scheduled")
                  }
                  className="text-amber-300"
                >
                  Send to maintenance
                </Button>
                <Button
                  variant="secondary"
                  loading={restoreState.isLoading}
                  onClick={() => active && runAction(restore, active, "Resource restored")}
                  className="text-emerald-300"
                >
                  Restore to service
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Each action changes the unit's service state and updates availability for the
                optimiser. Restore is the only way back from maintenance or offline.
              </p>
            </div>
          </fieldset>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete resource"
        message={
          hasId ? (
            <>
              Delete resource{" "}
              <span className="font-mono">{shortId(deleteTarget?.resourceId)}</span>? Any
              allocation referencing it will break, and this cannot be undone.
            </>
          ) : (
            "Open the unit from the registry before deleting it."
          )
        }
        confirmLabel="Delete resource"
        loading={deleteState.isLoading}
        onConfirm={async () => {
          if (!hasId || !deleteTarget) return;
          const result = await run(removeResource, numericId, {
            method: "DELETE",
            successTitle: "Resource deleted",
            successDescription: `${shortId(deleteTarget.resourceId)} removed.`,
          });
          if (result.ok) setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export default function ResourcesPage() {
  return (
    <ClientOnly
      fallback={
        <div aria-busy="true" aria-live="polite">
          <PageHeader
            eyebrow="Assets"
            title="Resource registry"
            description="Ambulances, rescue teams, aircraft and support units — availability, load and service state."
          />
          <SkeletonStats count={4} />
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
            <div className="border-b border-border-subtle px-4 py-3">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="mt-2 h-2.5 w-52" />
            </div>
            <SkeletonTable rows={8} />
          </div>
        </div>
      }
    >
      <ResourcesView />
    </ClientOnly>
  );
}
