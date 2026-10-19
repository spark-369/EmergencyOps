/** Shared presentation helpers for enums, statuses and timestamps. */

const TONES = {
  /*
   * `neutral` must read as ink on a *light* chip: `bg-slate-200` resolves to a
   * dark navy in this palette, so pairing it with `text-slate-700` produced
   * dark-on-dark. `slate-300` (mid) + `slate-950` (brightest ink) is legible.
   */
  neutral: "bg-slate-300/85 text-slate-950 ring-slate-400/40",
  info: "bg-sky-400/12 text-sky-300 ring-sky-400/30",
  success: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/30",
  warning: "bg-amber-400/12 text-amber-300 ring-amber-400/30",
  danger: "bg-rose-400/12 text-rose-300 ring-rose-400/30",
  critical:
    "bg-rose-500 text-white ring-rose-300/40 shadow-[0_0_16px_-4px_rgba(244,63,94,0.8)]",
  violet: "bg-violet-400/12 text-violet-300 ring-violet-400/30",
} as const;

export type Tone = keyof typeof TONES;

export function toneClass(tone: Tone): string {
  return TONES[tone];
}

const STATUS_TONES: Record<string, Tone> = {
  // incidents
  RECEIVED: "info",
  PRIORITIZED: "violet",
  ALLOCATING: "warning",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
  CANCELLED: "neutral",
  FAILED: "danger",
  // resources / allocations
  AVAILABLE: "success",
  BUSY: "warning",
  MAINTENANCE: "warning",
  OFFLINE: "danger",
  DEPLOYED: "info",
  STANDBY: "neutral",
  PENDING: "info",
  ASSIGNED: "violet",
  EN_ROUTE: "info",
  ARRIVED: "warning",
  COMPLETED: "success",
  // hospitals
  OPERATIONAL: "success",
  AT_CAPACITY: "warning",
  OVER_CAPACITY: "danger",
  // roads
  OPEN: "success",
  CLOSED: "danger",
  DELAYED: "warning",
  CONGESTED: "warning",
  // severities
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
  CATASTROPHIC: "critical",
};
export function statusTone(value?: string): Tone {
  if (!value) return "neutral";
  return STATUS_TONES[value] ?? "neutral";
}

/**
 * Urgency ordering for severities.
 *
 * Severity must sort by *risk*, not alphabetically — "CATASTROPHIC" would
 * otherwise land after "CRITICAL" in an ascending sort, which inverts the one
 * column an operator is most likely to sort on.
 */
export const SEVERITY_RANK: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
  CATASTROPHIC: 5,
};

/** `EMERGENCY_OPERATION_CENTER` -> `Emergency Operation Center`. */
export function humanize(value?: string | null): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Compact label for badges (keeps acronyms readable). */
export function shortLabel(value?: string | null): string {
  if (!value) return "—";
  const acronyms = new Set(["ICU", "EOC"]);
  return value
    .split("_")
    .map((part) =>
      acronyms.has(part) ? part : part.charAt(0) + part.slice(1).toLowerCase(),
    )
    .join(" ");
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "3m ago"-style relative time.
 *
 * Reads the clock, so it must not run during prerender — React would hydrate
 * mismatched text. Callers must live inside a `ClientOnly` subtree (see
 * `components/providers/client-only`), or use `formatDateTime` when a stable,
 * clock-free value is required.
 */
export function formatRelative(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatRelativeTo(value, Date.now());
}

/**
 * Clock-injected variant of {@link formatRelative} — pure, so it can be used in
 * contexts where an explicit `now` is available (tests, timers).
 */
export function formatRelativeTo(value: string, now: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = now - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatNumber(value?: number | null, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

export function formatCoord(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function percent(part?: number, total?: number): number {
  if (!total || total <= 0 || part === undefined) return 0;
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)));
}
