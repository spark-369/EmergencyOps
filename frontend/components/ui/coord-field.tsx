"use client";

import { MapPicker, type MapPreset } from "@/components/ui/leaflet-map";
/**
 * Location field: a map, with the resulting coordinates shown as a read-out.
 *
 * The map is the input. Earlier versions paired it with two editable number
 * inputs, which made the "authority" value a typed string and let a form submit
 * coordinates the operator had never seen on the map. Operators pick a place —
 * the pin updates state, and the exact values the API receives are displayed
 * beneath it so they can still be read off, quoted in a report, or checked for
 * sanity. `Use my location` and the sector shortcuts cover the cases where
 * clicking a precise spot on a tile is impractical.
 *
 * Empty string is kept as the canonical "not set" value in form state so the
 * required-field validation on each page still works unchanged.
 */
export function CoordField({
  latitude,
  longitude,
  onChange,
  latitudeError,
  longitudeError,
  presets,
  center,
  label = "Location",
  height,
}: {
  /** Raw form values; `""` means unset. */
  latitude: string;
  longitude: string;
  onChange: (latitude: string, longitude: string) => void;
  latitudeError?: string;
  longitudeError?: string;
  presets?: MapPreset[];
  /** Where the map opens while no point is set (e.g. the record's own position). */
  center?: [number, number];
  label?: string;
  height?: number;
}) {
  const lat = latitude === "" ? null : Number(latitude);
  const lon = longitude === "" ? null : Number(longitude);

  const invalidLat = lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90);
  const invalidLon = lon !== null && (Number.isNaN(lon) || lon < -180 || lon > 180);
  const hasValidPoint = lat !== null && lon !== null && !invalidLat && !invalidLon;

  const setFromMap = (nextLat: number, nextLon: number) => {
    onChange(String(nextLat), String(nextLon));
  };

  const error = latitudeError ?? longitudeError;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-600">
        {label}
        <span className="ml-0.5 text-rose-400">*</span>
        <span className="ml-2 text-[11px] font-normal text-slate-500">
          {hasValidPoint
            ? "click the map to move the pin"
            : "click the map to place the pin"}
        </span>
      </p>

      {/*
        `center` matters before the first point exists: a relocation dialog passes
        the unit's current position so the map opens there, not on central Dhaka.
      */}
      <MapPicker
        latitude={hasValidPoint ? lat : null}
        longitude={hasValidPoint ? lon : null}
        onChange={setFromMap}
        presets={presets}
        center={center}
        height={height}
        error={error}
      />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-slate-100/60 px-2.5 py-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Coordinates
        </span>
        {hasValidPoint ? (
          <span className="font-mono text-xs tabular-nums text-slate-800">
            {lat.toFixed(5)}, {lon.toFixed(5)}
          </span>
        ) : (
          <span className="text-xs text-slate-500">No point selected yet</span>
        )}
        {hasValidPoint && (
          <span className="ml-auto text-[10px] text-slate-500">
            sent as <code className="font-mono">latitude</code> /{" "}
            <code className="font-mono">longitude</code>
          </span>
        )}
      </div>

      {error && (
        <p className="text-[11px] font-medium text-rose-400">
          {latitudeError ?? longitudeError}
        </p>
      )}
    </div>
  );
}
