import type { ReactNode } from "react";
import { formatNumber, percent } from "@/lib/format";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-subtle pb-4">
      <div>
        {eyebrow && (
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-teal-300 uppercase">
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-teal-300" />
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      {children}
      {error ? (
        <span className="text-[11px] font-medium text-rose-400">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  "h-9 w-full rounded-lg border border-slate-300 bg-slate-100 px-2.5 text-sm text-slate-950 outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-slate-500 hover:border-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60";

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`min-h-20 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-2 text-sm text-slate-950 outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-slate-500 hover:border-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}

export function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${CONTROL} cursor-pointer pr-8 ${className}`} {...props}>
      {children}
    </select>
  );
}

/** Compact filter bar used above every table. */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle bg-slate-100/40 px-4 py-3">
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-slate-100 text-slate-500">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="max-w-md text-xs text-slate-500">{description}</p>}
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------- Meter */

export type MeterTone = "auto" | "teal" | "rose" | "amber" | "sky";

const METER_FILL: Record<Exclude<MeterTone, "auto">, string> = {
  teal: "bg-teal-400 shadow-[0_0_10px_rgba(45,212,191,0.5)]",
  rose: "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.55)]",
  amber: "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]",
  sky: "bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.5)]",
};

/**
 * Horizontal capacity meter.
 *
 * Replaces the three hand-rolled bar implementations that had drifted apart
 * (dashboard, resources, hospitals). Unifying them fixed two things at once:
 * every read-out is now `tabular-nums`, so a live value changing from 9 to 10
 * no longer nudges the label, and the fill animates with a single transform
 * instead of per-instance shadow/bg conditionals.
 *
 * `tone="auto"` mirrors the dispatch semantics used elsewhere: ≥100 % danger,
 * ≥70 % warning, otherwise nominal. The numeric read-out is the accessible
 * value — the bar itself is decorative.
 */
export function Meter({
  value,
  max,
  tone = "auto",
  className = "",
  showValue = false,
  label,
}: {
  value?: number;
  max?: number;
  tone?: MeterTone;
  className?: string;
  /** Renders `value/max` and the percentage next to the bar. */
  showValue?: boolean;
  /** Accessible name, e.g. "Fleet load". Required when nothing else labels it. */
  label?: string;
}) {
  const pct = percent(value, max);
  const resolved: Exclude<MeterTone, "auto"> =
    tone !== "auto"
      ? tone
      : pct >= 100
        ? "rose"
        : pct >= 70
          ? "amber"
          : "teal";

  return (
    <div className={className}>
      {showValue && (
        <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-600">
          <span>
            {formatNumber(value)}/{formatNumber(max)}
          </span>
          <span>{pct}%</span>
        </div>
      )}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max ?? 100}
        aria-valuenow={value}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className={`animate-meter h-full rounded-full ${METER_FILL[resolved]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  fieldErrors,
  onRetry,
  retryLabel = "Retry",
}: {
  message: string;
  fieldErrors?: Record<string, string>;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      <p className="flex items-start gap-2 font-medium">
        <svg
          viewBox="0 0 24 24"
          className="mt-0.5 h-4 w-4 shrink-0 text-rose-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
        </svg>
        {message}
      </p>
      {fieldErrors && (
        <ul className="list-inside list-disc space-y-0.5 text-xs">
          {Object.entries(fieldErrors).map(([field, msg]) => (
            <li key={field}>
              <span className="font-mono">{field}</span>: {msg}
            </li>
          ))}
        </ul>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-md bg-rose-500 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-rose-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function InlineLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-300" />
      {label}
    </div>
  );
}

/**
 * Shimmering placeholder block.
 *
 * Used while a table or card is resolving so the layout does not jump between
 * "spinner" and "content" — the box already occupies its final size. The
 * animation is a translated gradient (see `.skeleton` in `globals.css`), which
 * the compositor handles, instead of `animate-pulse`, which repaints the block
 * every frame. Purely decorative, so it is hidden from assistive tech and the
 * surrounding region should carry `aria-busy`.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

/** Placeholder shaped like a stat-card row, matching `StatCard`'s height. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="rounded-xl border border-border-subtle bg-surface p-4"
        >
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-3 h-6 w-16" />
          <Skeleton className="mt-2 h-2 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder shaped like a data table: header row plus `rows` body rows. */
export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="px-4 py-3">
      <Skeleton className="h-2.5 w-40" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
