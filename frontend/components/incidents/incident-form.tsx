"use client";

import { useState } from "react";
import { INCIDENT_SEVERITIES, type IncidentRequest, type IncidentSeverity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { CoordField } from "@/components/ui/coord-field";
import { KeyValueEditor, type JsonEntries } from "@/components/ui/key-value-editor";
import { humanize } from "@/lib/format";
import { useCreateIncidentMutation } from "@/lib/store/api";
import { useMutationToast } from "@/lib/use-api-notify";

interface FormState {
  latitude: string;
  longitude: string;
  locationDescription: string;
  severity: string;
  affectedPeople: string;
  timeSensitivityMinutes: string;
  /*
   * Structured objects rather than JSON strings: the editor guarantees a valid
   * shape, so there is no parse step to fail at submit time.
   */
  resourceRequirements?: JsonEntries;
  environmentalConditions?: JsonEntries;
}

const EMPTY: FormState = {
  latitude: "",
  longitude: "",
  locationDescription: "",
  severity: "HIGH",
  affectedPeople: "10",
  timeSensitivityMinutes: "30",
  resourceRequirements: undefined,
  environmentalConditions: undefined,
};

/**
 * Type guard for the severity select value. `FormState.severity` is a plain
 * string (form inputs are strings), so it has to be narrowed before it can be
 * used as `IncidentSeverity` — `.includes(x as never)` would bypass the check.
 */
function isIncidentSeverity(value: string): value is IncidentSeverity {
  return (INCIDENT_SEVERITIES as readonly string[]).includes(value);
}

/** Mirrors the Bean Validation rules declared on `IncidentRequest`. */
function validate(values: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  const lat = Number(values.latitude);
  const lon = Number(values.longitude);
  const people = Number(values.affectedPeople);
  const sensitivity = Number(values.timeSensitivityMinutes);

  if (values.latitude === "" || Number.isNaN(lat)) errors.latitude = "Latitude is required";
  else if (lat < -90 || lat > 90) errors.latitude = "Latitude must be between -90 and 90";

  if (values.longitude === "" || Number.isNaN(lon)) errors.longitude = "Longitude is required";
  else if (lon < -180 || lon > 180) errors.longitude = "Longitude must be between -180 and 180";

  if (!values.locationDescription.trim())
    errors.locationDescription = "Location description is required";
  else if (values.locationDescription.length > 500)
    errors.locationDescription = "Maximum 500 characters";

  if (!isIncidentSeverity(values.severity)) errors.severity = "Severity is required";

  if (Number.isNaN(people) || people < 1) errors.affectedPeople = "At least 1 person affected";

  if (Number.isNaN(sensitivity) || sensitivity < 1)
    errors.timeSensitivityMinutes = "Time sensitivity must be at least 1 minute";

  return errors;
}

function buildPayload(values: FormState): IncidentRequest {
  // `submit()` runs `validate()` first, which rejects any non-enum severity,
  // so this fallback is unreachable in practice.
  const severity: IncidentSeverity = isIncidentSeverity(values.severity)
    ? values.severity
    : "HIGH";

  return {
    latitude: Number(values.latitude),
    longitude: Number(values.longitude),
    locationDescription: values.locationDescription.trim(),
    severity,
    affectedPeople: Number(values.affectedPeople),
    timeSensitivityMinutes: Number(values.timeSensitivityMinutes),
    resourceRequirements: values.resourceRequirements,
    environmentalConditions: values.environmentalConditions,
  };
}

export function IncidentForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (incidentId?: string) => void;
}) {
  const [values, setValues] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createIncident, { isLoading }] = useCreateIncidentMutation();
  const run = useMutationToast();

  /*
   * Only the scalar fields are editable through a change event. The two object
   * fields (`resourceRequirements`, `environmentalConditions`) are written by the
   * `KeyValueEditor` through `setValues`, so they are excluded here — otherwise
   * `set("resourceRequirements")` would assign a string to an object and the
   * payload type would silently drift.
   */
  type ScalarKey = {
    [K in keyof FormState]-?: FormState[K] extends string ? K : never;
  }[keyof FormState];

  const set =
    (key: ScalarKey) =>
    (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setValues((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationErrors = validate(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const result = await run(createIncident, buildPayload(values), {
      method: "POST",
      successTitle: "Incident reported",
      successDescription: "A priority score and response estimate were calculated.",
    });

    if (result.ok) {
      setValues(EMPTY);
      onCreated?.(result.data?.incidentId);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Report incident"
      description="POST /api/v1/incidents — priority and response time are computed server-side."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={isLoading}>
            Submit incident
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Location description"
          required
          error={errors.locationDescription}
          hint="Street, landmark or sector"
        >
          <Textarea
            value={values.locationDescription}
            onChange={set("locationDescription")}
            maxLength={500}
            placeholder="Sector 12, near central bridge"
          />
        </Field>
        <Field label="Severity" required error={errors.severity}>
          <Select value={values.severity} onChange={set("severity")}>
            {INCIDENT_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {humanize(severity)}
              </option>
            ))}
          </Select>
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
        <Field label="Affected people" required error={errors.affectedPeople}>
          <Input
            type="number"
            min={1}
            value={values.affectedPeople}
            onChange={set("affectedPeople")}
          />
        </Field>
        <Field
          label="Time sensitivity (min)"
          required
          error={errors.timeSensitivityMinutes}
          hint="How quickly responders must arrive"
        >
          <Input
            type="number"
            min={1}
            value={values.timeSensitivityMinutes}
            onChange={set("timeSensitivityMinutes")}
          />
        </Field>
        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
          <KeyValueEditor
            field="resourceRequirements"
            label="Resource requirements"
            hint="Optional — what this incident needs dispatched."
            value={values.resourceRequirements}
            onChange={(next) =>
              setValues((prev) => ({ ...prev, resourceRequirements: next }))
            }
          />
          <KeyValueEditor
            field="environmentalConditions"
            label="Environmental conditions"
            hint="Optional — weather, visibility, hazards."
            value={values.environmentalConditions}
            onChange={(next) =>
              setValues((prev) => ({ ...prev, environmentalConditions: next }))
            }
          />
        </div>
      </form>
    </Modal>
  );
}
