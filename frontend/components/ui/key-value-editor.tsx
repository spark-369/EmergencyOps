"use client";

import { useState } from "react";

/**
 * Structured editor for the `Map<String, Object>` fields
 * (`resourceRequirements`, `environmentalConditions`, `operationalConstraints`).
 *
 * Replaces a raw JSON textarea. Asking an operator to hand-write
 * `{"ambulances": 2}` mid-incident invites a syntax error exactly when the data
 * matters most, and a stray comma is indistinguishable from a bad *value*. Here
 * each row is a plain input and the object is assembled in code, so malformed
 * JSON is impossible by construction.
 *
 * Values keep their JSON type because the backend stores `Object`: a field typed
 * as a number is sent as a number and `true`/`false` as a boolean. That matters —
 * `"2"` and `2` are different values downstream.
 */

export type JsonValue = string | number | boolean;
export type JsonEntries = Record<string, JsonValue>;

/** Shape of one editable row. `kind` drives how the value input renders. */
interface Row {
  id: number;
  key: string;
  value: string;
  kind: "text" | "number" | "boolean";
}

let nextId = 1;
const newRow = (kind: Row["kind"] = "text"): Row => ({
  id: nextId++,
  key: "",
  value: "",
  kind,
});

/** Suggested keys, offered via `datalist` so common cases need no typing. */
const SUGGESTIONS: Record<string, string[]> = {
  resourceRequirements: [
    "ambulances",
    "fireTrucks",
    "policeUnits",
    "rescueTeams",
    "boats",
    "helicopters",
    "personnel",
  ],
  environmentalConditions: [
    "weather",
    "visibility",
    "roadCondition",
    "temperature",
    "windSpeed",
    "flooding",
  ],
  operationalConstraints: [
    "fuel",
    "crewStatus",
    "equipment",
    "maxRangeKm",
    "restriction",
    "notes",
  ],
};

function rowsFromValue(value: JsonEntries | undefined): Row[] {
  if (!value) return [];
  return Object.entries(value).map(([key, raw]) => ({
    id: nextId++,
    key,
    value: String(raw),
    kind:
      typeof raw === "boolean"
        ? "boolean"
        : typeof raw === "number"
          ? "number"
          : "text",
  }));
}

/**
 * Coerces rows into an object, skipping blank keys.
 *
 * Exported so callers can validate without duplicating the coercion rules.
 */
export function rowsToValue(
  rows: { key: string; value: string; kind: string }[],
): JsonEntries | undefined {
  const out: JsonEntries = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (row.kind === "boolean") out[key] = row.value === "true";
    else if (row.kind === "number") {
      const parsed = Number(row.value);
      out[key] = Number.isNaN(parsed) ? 0 : parsed;
    } else out[key] = row.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function KeyValueEditor({
  value,
  onChange,
  field,
  label,
  hint,
}: {
  value?: JsonEntries;
  onChange: (next: JsonEntries | undefined) => void;
  /** Selects the suggestion list. */
  field: string;
  label: string;
  hint?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => rowsFromValue(value));
  const suggestions = SUGGESTIONS[field] ?? [];
  const listId = `kv-suggestions-${field}`;

  const commit = (next: Row[]) => {
    setRows(next);
    onChange(rowsToValue(next));
  };

  const update = (id: number, patch: Partial<Row>) =>
    commit(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-slate-600">{label}</p>
        <button
          type="button"
          onClick={() => commit([...rows, newRow()])}
          className="focus-ring rounded-md border border-border-subtle px-2 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-border-strong hover:text-slate-950"
        >
          + Add field
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-subtle px-3 py-3 text-[11px] text-slate-500">
          No fields. These are optional — add one only if it is known.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-1.5">
              <input
                value={row.key}
                list={listId}
                onChange={(event) => update(row.id, { key: event.target.value })}
                placeholder="field"
                aria-label={`${label} field name`}
                className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-100 px-2 text-xs text-slate-950 outline-none placeholder:text-slate-500 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25"
              />
              <select
                value={row.kind}
                onChange={(event) =>
                  update(row.id, { kind: event.target.value as Row["kind"] })
                }
                aria-label={`Type of ${row.key || "new field"}`}
                className="h-8 shrink-0 rounded-md border border-slate-300 bg-slate-100 px-1 text-[11px] text-slate-700"
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Yes / No</option>
              </select>

              {row.kind === "boolean" ? (
                <select
                  value={row.value === "" ? "true" : row.value}
                  onChange={(event) => update(row.id, { value: event.target.value })}
                  aria-label={`Value of ${row.key || "new field"}`}
                  className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-100 px-1.5 text-xs text-slate-950"
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  value={row.value}
                  type={row.kind === "number" ? "number" : "text"}
                  step={row.kind === "number" ? "any" : undefined}
                  onChange={(event) => update(row.id, { value: event.target.value })}
                  placeholder="value"
                  aria-label={`Value of ${row.key || "new field"}`}
                  className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-100 px-2 text-xs text-slate-950 outline-none placeholder:text-slate-500 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25"
                />
              )}

              <button
                type="button"
                onClick={() => commit(rows.filter((item) => item.id !== row.id))}
                aria-label={`Remove ${row.key || "field"}`}
                className="focus-ring shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <datalist id={listId}>
        {suggestions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

