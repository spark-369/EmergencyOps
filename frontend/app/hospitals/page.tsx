"use client";

import { useMemo, useState } from "react";
import type { Hospital, HospitalStatus } from "@/lib/types";
import { HOSPITAL_STATUSES } from "@/lib/types";
import {
  useDeleteHospitalMutation,
  useGetAllHospitalsQuery,
  useGetAvailableHospitalsQuery,
  useGetHospitalByHospitalIdQuery,
  useGetHospitalByIdQuery,
  useGetHospitalsInRegionQuery,
  useRegisterHospitalMutation,
  useUpdateHospitalBedsMutation,
  useUpdateHospitalStatusMutation,
} from "@/lib/store/api";
import { getErrorMessage, useMutationToast } from "@/lib/use-api-notify";
import { useRegistry } from "@/lib/use-registry";
import type { RegistryFilter } from "@/lib/use-registry";
import { ClientOnly } from "@/components/providers/client-only";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
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
import {
  RegistryFilterSelect,
  RegistryPager,
  RegistrySearch,
  RegistryTable,
  RegistryToolbar,
} from "@/components/ui/registry";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import {
  formatCoord,
  formatDateTime,
  formatNumber,
  formatRelative,
  humanize,
  percent,
} from "@/lib/format";
import { shortId } from "@/components/incidents/incident-detail";
import { Can } from "@/components/auth/can";

type HospitalMode = "all" | "available" | "region";

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
 * seeded hospitals, which sit around Dhaka — so the endpoint looked broken.
 */
const REGION_DEFAULT: RegionState = {
  minLat: "20",
  maxLat: "27",
  minLon: "88",
  maxLon: "93",
};

interface HospitalFormState {
  hospitalId: string;
  name: string;
  latitude: string;
  longitude: string;
  totalBeds: string;
  icuCapacity: string;
  emergencyCapacity: string;
  status: HospitalStatus;
}

const FORM_EMPTY: HospitalFormState = {
  hospitalId: "",
  name: "",
  latitude: "",
  longitude: "",
  totalBeds: "100",
  icuCapacity: "10",
  emergencyCapacity: "20",
  status: "OPERATIONAL",
};

function validateHospital(values: HospitalFormState) {
  const errors: Record<string, string> = {};
  if (!values.hospitalId.trim()) errors.hospitalId = "Hospital ID is required";
  else if (values.hospitalId.length > 100) errors.hospitalId = "Max 100 characters";
  if (!values.name.trim()) errors.name = "Name is required";
  else if (values.name.length > 200) errors.name = "Max 200 characters";

  const lat = Number(values.latitude);
  const lon = Number(values.longitude);
  if (values.latitude === "" || Number.isNaN(lat)) errors.latitude = "Latitude is required";
  else if (lat < -90 || lat > 90) errors.latitude = "Must be between -90 and 90";
  if (values.longitude === "" || Number.isNaN(lon)) errors.longitude = "Longitude is required";
  else if (lon < -180 || lon > 180) errors.longitude = "Must be between -180 and 180";

  if (Number(values.totalBeds) < 1) errors.totalBeds = "Total beds must be at least 1";
  if (Number(values.icuCapacity) < 0) errors.icuCapacity = "ICU capacity cannot be negative";
  if (Number(values.emergencyCapacity) < 0)
    errors.emergencyCapacity = "Emergency capacity cannot be negative";
  return errors;
}

function HospitalForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [values, setValues] = useState<HospitalFormState>(FORM_EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [registerHospital, { isLoading }] = useRegisterHospitalMutation();
  const run = useMutationToast();

  const set =
    (key: keyof HospitalFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async () => {
    const validationErrors = validateHospital(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const result = await run(
      registerHospital,
      {
        hospitalId: values.hospitalId.trim(),
        name: values.name.trim(),
        latitude: Number(values.latitude),
        longitude: Number(values.longitude),
        totalBeds: Number(values.totalBeds),
        icuCapacity: Number(values.icuCapacity),
        emergencyCapacity: Number(values.emergencyCapacity),
        status: values.status,
      },
      {
        method: "POST",
        successTitle: "Hospital registered",
        successDescription: "Bed, ICU and emergency capacity initialised.",
      },
    );

    if (result.ok) {
      setValues(FORM_EMPTY);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Register hospital"
      description="Add a receiving site. All beds start free and equal to capacity."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={isLoading}>
            Register hospital
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Hospital ID" required error={errors.hospitalId} hint="Unique business key">
          <Input value={values.hospitalId} onChange={set("hospitalId")} placeholder="HOSP-001" />
        </Field>
        <Field label="Name" required error={errors.name}>
          <Input value={values.name} onChange={set("name")} placeholder="City General Hospital" />
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
        <Field label="Total beds" required error={errors.totalBeds}>
          <Input type="number" min={1} value={values.totalBeds} onChange={set("totalBeds")} />
        </Field>
        <Field label="ICU capacity" required error={errors.icuCapacity}>
          <Input type="number" min={0} value={values.icuCapacity} onChange={set("icuCapacity")} />
        </Field>
        <Field label="Emergency capacity" required error={errors.emergencyCapacity}>
          <Input
            type="number"
            min={0}
            value={values.emergencyCapacity}
            onChange={set("emergencyCapacity")}
          />
        </Field>
        <Field label="Status" hint="Defaults to OPERATIONAL">
          <Select value={values.status} onChange={set("status")}>
            {HOSPITAL_STATUSES.map((status) => (
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



/**
 * Live hospital capacity view. Rendered only after hydration via `ClientOnly`,
 * because its RTK Query hooks read `Date.now()` on first render.
 */
function HospitalsView() {
  const [mode, setMode] = useState<HospitalMode>("all");
  const [regionDraft, setRegionDraft] = useState<RegionState>(REGION_DEFAULT);
  const [region, setRegion] = useState<RegionState>(REGION_DEFAULT);

  const [formOpen, setFormOpen] = useState(false);
  const [lookupId, setLookupId] = useState("");
  const [lookupTarget, setLookupTarget] = useState("");
  const [detailId, setDetailId] = useState("");
  const [selected, setSelected] = useState<Hospital | null>(null);
  const [statusValue, setStatusValue] = useState<HospitalStatus>("OPERATIONAL");
  const [beds, setBeds] = useState({
    availableBeds: "",
    icuAvailable: "",
    emergencyAvailable: "",
  });
  const [deleteTarget, setDeleteTarget] = useState<Hospital | null>(null);

  const run = useMutationToast();
  const [updateStatus, statusState] = useUpdateHospitalStatusMutation();
  const [updateBeds, bedsState] = useUpdateHospitalBedsMutation();
  const [removeHospital, deleteState] = useDeleteHospitalMutation();

  const all = useGetAllHospitalsQuery(undefined, { skip: mode !== "all" });
  const available = useGetAvailableHospitalsQuery(undefined, {
    skip: mode !== "available",
  });
  const inRegion = useGetHospitalsInRegionQuery(
    {
      minLat: Number(region.minLat),
      maxLat: Number(region.maxLat),
      minLon: Number(region.minLon),
      maxLon: Number(region.maxLon),
    },
    { skip: mode !== "region" },
  );
  const byHospitalId = useGetHospitalByHospitalIdQuery(lookupTarget, {
    skip: lookupTarget === "",
  });
  const byNumericId = useGetHospitalByIdQuery(Number(detailId), {
    skip: detailId === "" || Number.isNaN(Number(detailId)),
  });

  const rows: Hospital[] = useMemo(() => {
    if (mode === "available") return available.data ?? [];
    if (mode === "region") return inRegion.data ?? [];
    return all.data ?? [];
  }, [mode, available.data, inRegion.data, all.data]);

  const registryFilters: RegistryFilter[] = [
    {
      key: "status",
      label: "Any status",
      options: HOSPITAL_STATUSES.map((status) => ({
        value: status,
        label: humanize(status),
      })),
      match: (row, value) => (row as Hospital).status === value,
    },
    {
      key: "capacity",
      label: "Any capacity",
      options: [
        { value: "free", label: "Has free beds" },
        { value: "full", label: "No free beds" },
      ],
      match: (row, value) => {
        const hospital = row as Hospital;
        const free = (hospital.availableBeds ?? 0) > 0;
        return value === "free" ? free : !free;
      },
    },
  ];

  const registry = useRegistry<Hospital>({
    rows,
    searchFields: (row) => [
      row.name,
      row.hospitalId,
      row.status,
      humanize(row.status),
      formatCoord(row.latitude, row.longitude),
    ],
    filters: registryFilters,
    sortValues: {
      name: (row) => row.name ?? "",
      status: (row) => row.status ?? "",
      beds: (row) => row.availableBeds ?? 0,
      icu: (row) => row.icuAvailable ?? 0,
    },
    initialSort: { key: "name", direction: "asc" },
  });

  const activeQuery =
    mode === "available" ? available : mode === "region" ? inRegion : all;

  const totals = useMemo(() => {
    const source = all.data ?? [];
    return source.reduce(
      (acc, hospital) => ({
        beds: acc.beds + (hospital.totalBeds ?? 0),
        bedsFree: acc.bedsFree + (hospital.availableBeds ?? 0),
        icuCapacity: acc.icuCapacity + (hospital.icuCapacity ?? 0),
        icuFree: acc.icuFree + (hospital.icuAvailable ?? 0),
        emergencyCapacity: acc.emergencyCapacity + (hospital.emergencyCapacity ?? 0),
        emergencyFree: acc.emergencyFree + (hospital.emergencyAvailable ?? 0),
      }),
      {
        beds: 0,
        bedsFree: 0,
        icuCapacity: 0,
        icuFree: 0,
        emergencyCapacity: 0,
        emergencyFree: 0,
      },
    );
  }, [all.data]);

  const hospitalCount = (all.data ?? []).length;

  /**
   * Pressure band per capacity type.
   *
   * "Free" beds are inverted from every other meter in this app: a *low* free
   * count is the alarming case. Thresholds are on remaining head-room, so
   * <10 % reads critical and <30 % tight — the point at which a single
   * mass-casualty incident would exhaust it.
   */
  const pressureOf = (free: number, capacity: number): "ok" | "tight" | "critical" => {
    if (capacity <= 0) return "ok";
    const remaining = percent(free, capacity);
    if (remaining < 10) return "critical";
    if (remaining < 30) return "tight";
    return "ok";
  };

  const bedPressure = pressureOf(totals.bedsFree, totals.beds);
  const icuPressure = pressureOf(totals.icuFree, totals.icuCapacity);
  const emergencyPressure = pressureOf(totals.emergencyFree, totals.emergencyCapacity);

  /**
   * Sites that can actually receive casualties.
   *
   * `OPERATIONAL` alone is not enough: a site marked operational with no free
   * beds is not a destination, and treating it as one is how an incident gets
   * routed to a hospital that immediately diverts it. This mirrors what
   * `/hospitals/available` returns.
   */
  const acceptingCount = (all.data ?? []).filter(
    (hospital) => hospital.status === "OPERATIONAL" && (hospital.availableBeds ?? 0) > 0,
  ).length;
  const divertingCount = hospitalCount - acceptingCount;

  const openManage = (hospital: Hospital) => {
    setSelected(hospital);
    setStatusValue((hospital.status ?? "OPERATIONAL") as HospitalStatus);
    setBeds({
      availableBeds:
        hospital.availableBeds !== undefined ? String(hospital.availableBeds) : "",
      icuAvailable:
        hospital.icuAvailable !== undefined ? String(hospital.icuAvailable) : "",
      emergencyAvailable:
        hospital.emergencyAvailable !== undefined
          ? String(hospital.emergencyAvailable)
          : "",
    });
  };

  const submitStatus = async () => {
    if (selected?.id === undefined) return;
    const result = await run(
      updateStatus,
      { id: selected.id, status: statusValue },
      {
        method: "PATCH",
        successTitle: `Status → ${statusValue}`,
        successDescription: `${selected.name ?? "Hospital"} updated.`,
      },
    );
    if (result.ok) setSelected(null);
  };

  const submitBeds = async () => {
    if (selected?.id === undefined) return;
    const result = await run(
      updateBeds,
      {
        id: selected.id,
        beds: {
          availableBeds:
            beds.availableBeds === "" ? undefined : Number(beds.availableBeds),
          icuAvailable:
            beds.icuAvailable === "" ? undefined : Number(beds.icuAvailable),
          emergencyAvailable:
            beds.emergencyAvailable === ""
              ? undefined
              : Number(beds.emergencyAvailable),
        },
      },
      {
        method: "PATCH",
        successTitle: "Capacity updated",
        successDescription: "Only the supplied counters were changed.",
      },
    );
    if (result.ok) setSelected(null);
  };

  /**
   * Tone for a free-capacity ratio, inverted from `Meter`'s default.
   *
   * `Meter tone="auto"` treats *high* as alarming (≥70 % amber, ≥100 % red) —
   * correct for load, exactly backwards for head-room. A hospital with 95 % of
   * its beds free would render red. The tone is therefore derived from the
   * remaining head-room instead.
   */
  const headroomTone = (free?: number, capacity?: number) => {
    const pressure = pressureOf(free ?? 0, capacity ?? 0);
    return pressure === "critical" ? "rose" : pressure === "tight" ? "amber" : "teal";
  };

  const columns: Column<Hospital>[] = [
    {
      key: "name",
      header: "Hospital",
      render: (row) => {
        const accepting = row.status === "OPERATIONAL" && (row.availableBeds ?? 0) > 0;
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            {/*
              Acceptance rail. This is the only question a dispatcher asks of a
              receiving site — "can it take this casualty?" — so it leads the row
              rather than being inferred from two separate columns.
            */}
            <span
              aria-hidden="true"
              title={accepting ? "Accepting patients" : "Not accepting patients"}
              className={`h-8 w-1 shrink-0 rounded-full ${
                row.status === "OVER_CAPACITY"
                  ? "bg-rose-500"
                  : row.status === "AT_CAPACITY"
                    ? "bg-amber-400"
                    : accepting
                      ? "bg-emerald-400"
                      : "bg-slate-400"
              }`}
            />
            <div className="min-w-0">
              <p className="max-w-[220px] truncate text-sm font-medium text-slate-950">
                {row.name ?? "—"}
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                {shortId(row.hospitalId)}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "beds",
      header: "Beds free",
      render: (row) => (
        <div className="w-28">
          <Meter
            value={row.availableBeds}
            max={row.totalBeds}
            // See headroomTone: free capacity is inverted from load.
            tone={headroomTone(row.availableBeds, row.totalBeds)}
            showValue
            label={`${row.name ?? "Hospital"} bed availability`}
          />
        </div>
      ),
    },
    {
      key: "icu",
      header: "ICU free",
      hideBelow: "md",
      render: (row) => {
        const pressure = pressureOf(row.icuAvailable ?? 0, row.icuCapacity ?? 0);
        return (
          <span
            className={`text-xs tabular-nums ${
              pressure === "critical" && (row.icuCapacity ?? 0) > 0
                ? "font-semibold text-rose-300"
                : "text-slate-600"
            }`}
            title={
              (row.icuCapacity ?? 0) > 0
                ? `${percent(row.icuAvailable, row.icuCapacity)}% of ICU capacity free`
                : "No ICU capacity recorded"
            }
          >
            {formatNumber(row.icuAvailable)} / {formatNumber(row.icuCapacity)}
          </span>
        );
      },
    },
    {
      key: "emergency",
      header: "Emergency free",
      hideBelow: "lg",
      render: (row) => {
        const pressure = pressureOf(row.emergencyAvailable ?? 0, row.emergencyCapacity ?? 0);
        return (
          <span
            className={`text-xs tabular-nums ${
              pressure === "critical" && (row.emergencyCapacity ?? 0) > 0
                ? "font-semibold text-rose-300"
                : "text-slate-600"
            }`}
            title={
              (row.emergencyCapacity ?? 0) > 0
                ? `${percent(row.emergencyAvailable, row.emergencyCapacity)}% of emergency capacity free`
                : "No emergency capacity recorded"
            }
          >
            {formatNumber(row.emergencyAvailable)} / {formatNumber(row.emergencyCapacity)}
          </span>
        );
      },
    },
    {
      key: "location",
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
          {/* Bed/status edits are allowed for field operators; registration and
              deletion are dispatcher-level, so the row mirrors the API rules. */}
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

  return (
    <>
      <PageHeader
        eyebrow="Assets"
        title="Hospital capacity"
        description="Bed, ICU and emergency availability across the receiving network."
        actions={
          <Can roles={["ADMIN", "DISPATCHER"]}>
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              Register hospital
            </Button>
          </Can>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Beds free"
          value={formatNumber(totals.bedsFree)}
          hint={
            totals.beds === 0
              ? "No capacity recorded"
              : `${percent(totals.bedsFree, totals.beds)}% of ${formatNumber(
                  totals.beds,
                )} across ${hospitalCount} site${hospitalCount === 1 ? "" : "s"}`
          }
          tone={bedPressure === "critical" ? "rose" : bedPressure === "tight" ? "amber" : "sky"}
        />
        <StatCard
          label="ICU free"
          value={formatNumber(totals.icuFree)}
          hint={
            totals.icuCapacity === 0
              ? "No ICU capacity recorded"
              : `${percent(totals.icuFree, totals.icuCapacity)}% of ${formatNumber(
                  totals.icuCapacity,
                )}`
          }
          tone={
            icuPressure === "critical" ? "rose" : icuPressure === "tight" ? "amber" : "violet"
          }
        />
        <StatCard
          label="Emergency free"
          value={formatNumber(totals.emergencyFree)}
          hint={
            totals.emergencyCapacity === 0
              ? "No emergency capacity recorded"
              : `${percent(totals.emergencyFree, totals.emergencyCapacity)}% of ${formatNumber(
                  totals.emergencyCapacity,
                )}`
          }
          tone={
            emergencyPressure === "critical"
              ? "rose"
              : emergencyPressure === "tight"
                ? "amber"
                : "teal"
          }
        />
        <StatCard
          label="Accepting patients"
          value={`${formatNumber(acceptingCount)}/${formatNumber(hospitalCount)}`}
          hint={divertingCount === 0 ? "No site diverting" : `${divertingCount} not accepting`}
          tone={divertingCount === 0 ? "teal" : "amber"}
        />
      </div>

      <Card>
        <CardHeader
          title="Receiving network"
          description={
            mode === "all"
              ? `All ${formatNumber(hospitalCount)} sites`
              : mode === "available"
                ? `${formatNumber(acceptingCount)} sites accepting patients`
                : "Sites within the selected bounding box"
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
              onChange={(event) => setMode(event.target.value as HospitalMode)}
              className="w-56"
            >
              <option value="all">All hospitals</option>
              <option value="available">Available</option>
              <option value="region">Bounding box</option>
            </Select>
          </Field>

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
            <Field label="Open by hospital ID" hint="e.g. HOSP-001">
              <Input
                className="w-44"
                placeholder="HOSP-001"
                value={lookupId}
                onChange={(event) => setLookupId(event.target.value.trim())}
              />
            </Field>
            <Button
              variant="secondary"
              onClick={() => setLookupTarget(lookupId)}
              disabled={lookupId === ""}
            >
              Look up
            </Button>
            <Field label="Open by record number" hint="Fast path when you know the id">
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
            placeholder="Search name, status or location"
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
              message={getErrorMessage(activeQuery.error, "Unable to load hospitals")}
              onRetry={() => activeQuery.refetch()}
            />
          </CardBody>
        ) : (
          <>
            <RegistryTable
              columns={columns}
              rows={registry.pageRows}
              loading={activeQuery.isLoading}
              rowKey={(row, index) => row.id ?? row.hospitalId ?? `row-${index}`}
              sort={registry.sort}
              onToggleSort={registry.toggleSort}
              sortableKeys={["name", "status", "beds", "icu"]}
              emptyTitle={
                registry.isFiltered
                  ? "No hospitals match those filters"
                  : "No hospitals found"
              }
              emptyDescription={
                registry.isFiltered
                  ? "Clear the search or filters to see the whole network."
                  : "Register a receiving site or widen the data source."
              }
              emptyAction={
                <Can roles={["ADMIN", "DISPATCHER"]}>
                  <Button size="sm" variant="primary" onClick={() => setFormOpen(true)}>
                    Register hospital
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
              noun="hospital"
            />
          </>
        )}
      </Card>

      {lookupTarget !== "" && (
        <Card>
          <CardHeader
            title={`Hospital ${lookupTarget}`}
            description="Opened by hospital ID"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setLookupTarget("")}>
                Close
              </Button>
            }
          />
          <CardBody>
            {byHospitalId.isLoading ? (
              <SkeletonTable rows={3} />
            ) : byHospitalId.isError ? (
              <ErrorState
                message={getErrorMessage(byHospitalId.error, "Hospital not found")}
                onRetry={() => byHospitalId.refetch()}
              />
            ) : byHospitalId.data ? (
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] tracking-wide text-slate-500 uppercase">Name</dt>
                  <dd className="text-slate-800">{byHospitalId.data.name}</dd>
                </div>
                <div>
                  <dt className="text-[11px] tracking-wide text-slate-500 uppercase">Status</dt>
                  <dd>
                    <StatusBadge value={byHospitalId.data.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] tracking-wide text-slate-500 uppercase">Beds</dt>
                  <dd className="tabular-nums">
                    {formatNumber(byHospitalId.data.availableBeds)}/
                    {formatNumber(byHospitalId.data.totalBeds)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] tracking-wide text-slate-500 uppercase">Updated</dt>
                  <dd className="text-xs">{formatDateTime(byHospitalId.data.updatedAt)}</dd>
                </div>
              </dl>
            ) : null}
          </CardBody>
        </Card>
      )}

      {(byNumericId.isError || (byNumericId.data && detailId !== "")) && (
        <Card>
          <CardHeader
            title={`Hospital #${detailId}`}
            description="Opened by record number"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setDetailId("")}>
                Close
              </Button>
            }
          />
          <CardBody>
            {byNumericId.isLoading ? (
              <SkeletonTable rows={2} />
            ) : byNumericId.isError ? (
              <ErrorState
                message={getErrorMessage(byNumericId.error, "Hospital not found")}
                onRetry={() => byNumericId.refetch()}
              />
            ) : byNumericId.data ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                <span className="font-medium">{byNumericId.data.name}</span>
                <StatusBadge value={byNumericId.data.status} />
                <Badge label={shortId(byNumericId.data.hospitalId)} tone="info" />
                <span className="text-xs tabular-nums">
                  Beds {formatNumber(byNumericId.data.availableBeds)}/
                  {formatNumber(byNumericId.data.totalBeds)}
                </span>
                <span className="text-xs tabular-nums">
                  ICU {formatNumber(byNumericId.data.icuAvailable)}/
                  {formatNumber(byNumericId.data.icuCapacity)}
                </span>
                <span className="text-xs tabular-nums">
                  Emergency {formatNumber(byNumericId.data.emergencyAvailable)}/
                  {formatNumber(byNumericId.data.emergencyCapacity)}
                </span>
              </div>
            ) : null}
          </CardBody>
        </Card>
      )}

      <HospitalForm open={formOpen} onClose={() => setFormOpen(false)} />

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        size="lg"
        title={selected?.name ?? "Hospital"}
        description={`${selected?.hospitalId ?? ""} · ${formatCoord(selected?.latitude, selected?.longitude)}`}
      >
        <div className="space-y-4">
          {/*
            Current capacity before editing. The bed counters are set absolutely,
            not incrementally, so an operator needs the present values in view to
            avoid typing a number that silently zeroes a ward.
          */}
          <div className="panel-inset px-3 py-2">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              Current capacity
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <StatusBadge value={selected?.status} />
              <span className="tabular-nums">
                Beds {formatNumber(selected?.availableBeds)}/{formatNumber(selected?.totalBeds)}
              </span>
              <span className="tabular-nums">
                ICU {formatNumber(selected?.icuAvailable)}/{formatNumber(selected?.icuCapacity)}
              </span>
              <span className="tabular-nums">
                Emergency {formatNumber(selected?.emergencyAvailable)}/
                {formatNumber(selected?.emergencyCapacity)}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Status" hint="Operating state used by the router and the optimiser">
              <Select
                value={statusValue}
                onChange={(event) => setStatusValue(event.target.value as HospitalStatus)}
              >
                {HOSPITAL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {humanize(status)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button variant="primary" loading={statusState.isLoading} onClick={submitStatus}>
                Update status
              </Button>
            </div>
          </div>

          <div className="panel-inset p-3">
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              Capacity counters
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Set the number of <strong>free</strong> beds in each category. Blank fields are left
              untouched; a value above capacity is rejected by the server.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Available beds">
                <Input
                  type="number"
                  min={0}
                  value={beds.availableBeds}
                  onChange={(event) =>
                    setBeds((prev) => ({ ...prev, availableBeds: event.target.value }))
                  }
                />
              </Field>
              <Field label="ICU available">
                <Input
                  type="number"
                  min={0}
                  value={beds.icuAvailable}
                  onChange={(event) =>
                    setBeds((prev) => ({ ...prev, icuAvailable: event.target.value }))
                  }
                />
              </Field>
              <Field label="Emergency available">
                <Input
                  type="number"
                  min={0}
                  value={beds.emergencyAvailable}
                  onChange={(event) =>
                    setBeds((prev) => ({ ...prev, emergencyAvailable: event.target.value }))
                  }
                />
              </Field>
            </div>
            <div className="mt-3 flex justify-end">
              <Button variant="primary" loading={bedsState.isLoading} onClick={submitBeds}>
                Save capacity
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete hospital"
        message={
          <>
            Delete <span className="font-medium">{deleteTarget?.name}</span> (
            <span className="font-mono">{deleteTarget?.hospitalId}</span>)? This removes it from
            the receiving network and cannot be undone.
          </>
        }
        confirmLabel="Delete hospital"
        loading={deleteState.isLoading}
        onConfirm={async () => {
          if (deleteTarget?.id === undefined) return;
          const result = await run(removeHospital, deleteTarget.id, {
            method: "DELETE",
            successTitle: "Hospital deleted",
            successDescription: `${deleteTarget.name ?? deleteTarget.hospitalId} removed.`,
          });
          if (result.ok) setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export default function HospitalsPage() {
  return (
    <ClientOnly
      fallback={
        <div aria-busy="true" aria-live="polite">
          <PageHeader
            eyebrow="Assets"
            title="Hospital capacity"
            description="Bed, ICU and emergency availability across the receiving network."
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
      <HospitalsView />
    </ClientOnly>
  );
}
