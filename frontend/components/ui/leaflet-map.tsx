"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Real interactive map (Leaflet + OpenStreetMap).
 *
 * Why this replaces the canvas grid: a grid can only show *numbers in space*.
 * An operator needs to recognise a bridge, a ring road, a hospital district —
 * that requires actual geography. OSM tiles provide it with no API key and no
 * billing.
 *
 * Integration constraints, all handled below:
 *
 * 1. **Leaflet is client-only.** It reads `window` at import time, so it is
 *    loaded with a dynamic `import()` inside an effect. A top-level import would
 *    break the server render.
 * 2. **The package may not be installed yet.** If the import rejects, the
 *    component reports it instead of taking down the surrounding form.
 * 3. **Leaflet's marker icons are asset URLs.** Bundlers rewrite them wrongly,
 *    so the icon is supplied as an inline `divIcon` — no 404s, no missing pins.
 * 4. **Leaflet's stylesheet is bundled, not fetched from a CDN.** It used to be
 *    injected as a `<link>` to `unpkg.com`. That is incompatible with the app's
 *    Content-Security-Policy (`style-src 'self' 'unsafe-inline'`), so in
 *    production the stylesheet was blocked and the map rendered collapsed —
 *    Leaflet's `.leaflet-*` positioning rules are what give the panes and tiles
 *    their size. It is now imported in `app/globals.css` so it is emitted as part
 *    of the build.
 */

export interface MapPreset {
  label: string;
  latitude: number;
  longitude: number;
}

/** Approximate Dhaka sectors used as quick jumps. */
export const DEFAULT_PRESETS: MapPreset[] = [
  { label: "Motijheel", latitude: 23.7330, longitude: 90.4172 },
  { label: "Gulshan", latitude: 23.7925, longitude: 90.4078 },
  { label: "Uttara", latitude: 23.8759, longitude: 90.3795 },
  { label: "Mirpur", latitude: 23.8223, longitude: 90.3654 },
  { label: "Dhanmondi", latitude: 23.7461, longitude: 90.3742 },
  { label: "Old Dhaka", latitude: 23.7104, longitude: 90.4074 },
];

/*
 * ---------------------------------------------------------------------------
 * Leaflet's stylesheet is NOT fetched at runtime.
 * ---------------------------------------------------------------------------
 * This file used to append `<link href="https://unpkg.com/leaflet/dist/leaflet.css">`
 * to `document.head`. That is incompatible with the app's Content-Security-Policy
 * (`style-src 'self' 'unsafe-inline'`), which blocks the request in production —
 * and without Leaflet's own `.leaflet-container` / `.leaflet-pane` rules the map
 * host has no height and the tiles do not position. The visible symptom is a
 * collapsed or solid-grey map that only recovers on a window resize.
 *
 * The stylesheet is now imported from `app/globals.css`, so it is emitted with
 * the app bundle: no third-party request, no CSP exception, and no flash of an
 * unstyled map while a CDN response is in flight.
 */



/**
 * Fallback view before the operator picks a point: central Dhaka.
 *
 * Kept in one place so the map, the presets and the numeric placeholders in
 * `CoordField` can never drift apart — an earlier version still defaulted to
 * Kolkata while the presets claimed Dhaka sectors.
 */
export const DEFAULT_CENTER: [number, number] = [23.8103, 90.4125];
/** City-wide view: Dhaka's sprawl is legible at 12 without hiding the river. */
const DEFAULT_ZOOM = 12;
/** Closer zoom used when jumping to a named sector. */
const PRESET_ZOOM = 15;

/**
 * How long to wait before the final post-mount re-measure.
 *
 * `Modal` runs `animate-toast-in` for 160 ms, and Leaflet measures its container
 * part-way through it. This is the animation's duration plus a frame of slack, so
 * the last `invalidateSize()` happens against the final, unscaled geometry.
 *
 * It is a *settling* value, not the only defence: `ResizeObserver` below
 * re-measures on any real change, so a slow first paint or a slower animation
 * still converges.
 */
const MODAL_SETTLE_MS = 200;

/**
 * Minimal structural view of the Leaflet API used here.
 *
 * Declared locally rather than imported from `@types/leaflet` so this file still
 * type-checks before the package is installed. Once `npm install` runs, the real
 * types are available and these can be replaced by an `import type`.
 */
interface LeafletMap {
  on(event: string, handler: (event: { latlng: { lat: number; lng: number } }) => void): void;
  remove(): void;
  invalidateSize(): void;
  flyTo(lat: number, lng: number, zoom?: number): void;
}

interface LeafletMarker {
  setLatLng(latlng: [number, number]): LeafletMarker;
  addTo(map: LeafletMap): LeafletMarker;
  remove(): void;
}

interface LeafletNs {
  map(el: HTMLElement, options?: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, options?: Record<string, unknown>): { addTo(map: LeafletMap): void };
  marker(latlng: [number, number], options?: Record<string, unknown>): LeafletMarker;
  divIcon(options: Record<string, unknown>): unknown;
}

const round = (value: number, digits = 5) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

/** Inline pin. Avoids Leaflet's PNG marker, whose URL bundlers rewrite wrongly. */
const PIN_HTML =
  '<span style="display:block;width:16px;height:16px;border-radius:9999px;background:#2dd4bf;border:3px solid #04121a;box-shadow:0 0 0 6px rgba(45,212,191,0.25)"></span>';

export function MapPicker({
  latitude,
  longitude,
  onChange,
  presets = DEFAULT_PRESETS,
  height = 240,
  error,
  center,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
  presets?: MapPreset[];
  height?: number;
  /** Highlights the frame when the coordinate pair is invalid. */
  error?: string;
  /**
   * Where to open when no point is set yet.
   *
   * Editing an existing record passes its current position so the map is already
   * looking at the right neighbourhood; a new record falls back to `DEFAULT_CENTER`.
   * Ignored once `latitude`/`longitude` are set — the pin wins.
   */
  center?: [number, number];
}) {
  // Resolved once per mount: re-centring an existing Leaflet map is `flyTo`'s job,
  // not the initialisation path's.
  const initialCenter = useRef<[number, number]>(center ?? DEFAULT_CENTER);
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const leafletRef = useRef<LeafletNs | null>(null);
  /*
   * `onChange` is usually an inline arrow, so it is mirrored in a ref. Without
   * this, every parent render would tear down and rebuild the map.
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const hasPoint = latitude !== null && longitude !== null;

  const makeIcon = (L: LeafletNs) =>
    L.divIcon({ className: "", html: PIN_HTML, iconSize: [16, 16], iconAnchor: [8, 8] });

  /* ------------------------------------------------------------ map setup */
  useEffect(() => {
    let cancelled = false;
    /*
     * Everything this effect starts must be torn down with it: the map, the
     * resize observer and any pending timers. Leaving a timer running after
     * unmount is how a removed map gets `invalidateSize()` called on it.
     */
    let resizeObserver: ResizeObserver | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let rafIds: number[] = [];

    /** Runs `fn` on the next frame, ignoring the result if we were cancelled. */
    const onNextFrame = (fn: () => void) => {
      const id = window.requestAnimationFrame(() => {
        if (!cancelled) fn();
      });
      rafIds.push(id);
    };

    (async () => {
      let L: LeafletNs;
      try {
        // Dynamic import: Leaflet reads `window` at module scope, so it must not
        // be evaluated during the server render.
        const mod = await import("leaflet");
        L =
          (mod as unknown as { default?: LeafletNs }).default ??
          (mod as unknown as LeafletNs);
      } catch {
        // Package not installed, or the bundler could not resolve it.
        if (!cancelled) setStatus("unavailable");
        return;
      }

      if (cancelled || !hostRef.current || mapRef.current) return;

      const map = L.map(hostRef.current, {
        center: hasPoint ? [latitude, longitude] : initialCenter.current,
        // An existing point (or an explicit centre) means we are working on a known
        // place, so open closer than the city-wide default.
        zoom: hasPoint || center ? PRESET_ZOOM : DEFAULT_ZOOM,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        // Required by the OSM tile usage policy.
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      if (hasPoint) {
        markerRef.current = L.marker([latitude, longitude], { icon: makeIcon(L) }).addTo(map);
      }

      map.on("click", (event) => {
        onChangeRef.current(round(event.latlng.lat), round(event.latlng.lng));
      });

      leafletRef.current = L;
      mapRef.current = map;
      setStatus("ready");

      /*
       * ---------------------------------------------------------- sizing
       *
       * Leaflet measures its container ONCE, at `L.map(...)`, and caches that
       * size. If the measurement is wrong the tiles render into a stale box — a
       * map that looks collapsed or grey until the window is resized.
       *
       * Two things make the measurement wrong here, and both are structural:
       *
       * 1. The map usually lives inside a `Modal`, which is portalled into
       *    `document.body`. At the moment this effect runs, the dialog has only
       *    just been inserted — layout may not have settled.
       *
       * 2. `Modal` applies `animate-toast-in`, whose starting keyframe is
       *    `transform: translateY(8px) scale(0.98)`. During those 160 ms the
       *    container is *scaled*, and a transform also makes the panel a
       *    containing block, so any offset Leaflet computes relates to a
       *    transformed box. The old code called `invalidateSize()` once from a
       *    single `requestAnimationFrame` — which can land inside that window —
       *    and never again, so a stale size was latched permanently.
       *
       * The fix is not a bigger timeout: a fixed delay is a guess about how long
       * someone else's animation takes, and it still fails on a slow first paint.
       * Instead the map is told to re-measure whenever its box actually changes,
       * and a short settle pass covers the leading edge of the animation.
       */

      // Re-measure on the next frames: covers the pre-animation layout.
      onNextFrame(() => map.invalidateSize());
      onNextFrame(() => map.invalidateSize());

      // Re-measure after the dialog's 160 ms entry animation has finished.
      settleTimer = setTimeout(() => {
        if (!cancelled) map.invalidateSize();
      }, MODAL_SETTLE_MS);

      /*
       * Then keep observing. This is what makes the map self-healing: any later
       * layout change — a scrollbar appearing, the window resizing, the dialog
       * being reflowed, a responsive breakpoint — triggers exactly one
       * re-measure. `ResizeObserver` fires once on observe, which also covers the
       * case where the container was still 0×0 above.
       */
      if (typeof ResizeObserver !== "undefined" && hostRef.current) {
        let lastWidth = 0;
        let lastHeight = 0;
        resizeObserver = new ResizeObserver((entries) => {
          if (cancelled) return;
          const entry = entries[0];
          if (!entry) return;
          const { width, height: boxHeight } = entry.contentRect;
          // Leaflet resets its panes on every call, so only act on real change.
          if (width === lastWidth && boxHeight === lastHeight) return;
          if (width === 0 || boxHeight === 0) return;
          lastWidth = width;
          lastHeight = boxHeight;
          map.invalidateSize();
        });
        resizeObserver.observe(hostRef.current);
      }
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      for (const id of rafIds) window.cancelAnimationFrame(id);
      rafIds = [];
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
    };
    // Built once per mount; prop changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------------------------- keep marker in sync */

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (!hasPoint) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude]);
      return;
    }

    markerRef.current = L.marker([latitude, longitude], { icon: makeIcon(L) }).addTo(map);
  }, [latitude, longitude, hasPoint]);

  /* ---------------------------------------------------------- geolocation */

  /**
   * Validates a `GeolocationPosition` before use.
   *
   * The success callback is not a guarantee: some browsers, permission-policy
   * stubs and mock implementations invoke it with a null `coords`, which threw
   * `Cannot read properties of null` inside the handler. Coordinates are also
   * validated numerically — `NaN` would reach `Number.isNaN` downstream and
   * silently blank the form.
   */
  const readPosition = (position: GeolocationPosition | null | undefined) => {
    const coords = position?.coords;
    if (!coords) return null;
    const { latitude, longitude } = coords;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }
    return { latitude, longitude };
  };

  /**
   * Moves the view when — and only when — a live map exists.
   *
   * `mapRef.current` can point at a removed map between cleanup and the next
   * mount (dialog close, Strict Mode double-invoke). Leaflet throws on `flyTo`
   * against a torn-down map, and this runs inside a geolocation callback, where a
   * throw surfaces as an unhandled browser error rather than a handled one.
   */
  const flyToSafe = (lat: number, lng: number, zoom: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    try {
      mapRef.current?.flyTo(lat, lng, zoom);
    } catch {
      // A destroyed map simply does not move; the marker still updates via state.
    }
  };

  const useMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateError("Location is not available in this browser.");
      return;
    }
    setLocating(true);
    setLocateError(null);

    const fail = (message: string) => {
      setLocateError(message);
      setLocating(false);
    };

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const point = readPosition(position);
          if (!point) {
            // Malformed payload: treat it as a failure rather than crashing the
            // dialog that hosts this map.
            fail("Could not read your location — click the map instead.");
            return;
          }
          const lat = round(point.latitude);
          const lng = round(point.longitude);
          onChange(lat, lng);
          flyToSafe(lat, lng, 15);
          setLocating(false);
        },
        () => fail("Could not read your location — click the map instead."),
        { timeout: 8000, maximumAge: 60000 },
      );
    } catch {
      // Some environments throw synchronously (permissions policy, insecure
      // origin on plain HTTP). Never let that escape into the render tree.
      fail("Location is blocked in this browser — click the map instead.");
    }
  };

  const jumpTo = (preset: MapPreset) => {
    const lat = round(preset.latitude);
    const lng = round(preset.longitude);
    onChange(lat, lng);
    flyToSafe(lat, lng, PRESET_ZOOM);
  };

  return (
    <div className="space-y-2">
      {/*
        The frame is explicitly sized in both axes. `minHeight` alone was not
        enough: inside a flex column a child can still be shrunk below its
        content, and Leaflet then measures a squashed box and renders a collapsed
        map. `height` + `flexShrink: 0` + `overflowHidden` gives Leaflet a box
        whose size cannot be negotiated away by an ancestor.
      */}
      <div
        className={`relative overflow-hidden rounded-lg border ${
          error ? "border-rose-400/50" : "border-border-subtle"
        }`}
        style={{ height, minHeight: height, flexShrink: 0 }}
      >
        {/*
          The map host must be a real, sized box: Leaflet reads its dimensions on
          init and otherwise renders grey tiles against a 0-height container.
          `z-0` creates a stacking context so Leaflet's internal z-indexes
          (panes at 200–700) stay inside this frame instead of competing with the
          dialog's overlay.
        */}
        <div
          ref={hostRef}
          className="z-0 h-full w-full bg-slate-200"
          role="application"
          aria-label="Map"
        />

        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-100">
            <p className="text-[11px] font-medium text-slate-500">Loading map…</p>
          </div>
        )}

        {status === "unavailable" && (
          <div className="absolute inset-0 grid place-items-center bg-slate-100 p-4 text-center">
            <div>
              <p className="text-xs font-semibold text-slate-800">Map unavailable</p>
              <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-slate-500">
                The <code className="font-mono">leaflet</code> package is not installed.
                Run <code className="font-mono">npm install</code> and reload. Coordinates
                can still be typed below.
              </p>
            </div>
          </div>
        )}

        {status === "ready" && (
          <div className="absolute top-2 right-2 z-[500]">
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className="rounded-md border border-border-strong bg-surface/95 px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition-colors hover:text-slate-950 disabled:opacity-60"
            >
              {locating ? "Locating…" : "Use my location"}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-500">Jump to</span>
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => jumpTo(preset)}
            className="focus-ring rounded-full border border-border-subtle bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-border-strong hover:text-slate-950"
          >
            {preset.label}
          </button>
        ))}
        {hasPoint && (
          <span className="ml-auto font-mono text-[10px] tabular-nums text-slate-500">
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </span>
        )}
      </div>

      {locateError && <p className="text-[11px] text-amber-300">{locateError}</p>}
    </div>
  );
}

