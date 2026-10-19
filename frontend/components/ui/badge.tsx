import type { ReactNode } from "react";
import { shortLabel, statusTone, toneClass } from "@/lib/format";

export function Badge({
  label,
  tone,
  dot = false,
  className = "",
  title,
}: {
  label: ReactNode;
  tone?: ReturnType<typeof statusTone>;
  dot?: boolean;
  className?: string;
  /** Native tooltip; used where a state needs a sentence of explanation. */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap ${toneClass(
        tone ?? "neutral",
      )} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {label}
    </span>
  );
}

/** Enum badge with automatic colour mapping (incident/resource/road status …). */
export function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-500">—</span>;
  return <Badge label={shortLabel(value)} tone={statusTone(value)} dot />;
}

export function SeverityBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-500">—</span>;
  return (
    <Badge
      label={shortLabel(value)}
      tone={statusTone(value)}
      className="tracking-wide uppercase"
    />
  );
}

/** Small uppercase HTTP-method chip, used to make the exercised verb obvious. */
export function MethodChip({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-sky-400/12 text-sky-300 ring-sky-400/30",
    POST: "bg-emerald-400/12 text-emerald-300 ring-emerald-400/30",
    PUT: "bg-amber-400/12 text-amber-300 ring-amber-400/30",
    PATCH: "bg-violet-400/12 text-violet-300 ring-violet-400/30",
    DELETE: "bg-rose-400/12 text-rose-300 ring-rose-400/30",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-1 ring-inset ${
        colors[method] ?? "bg-slate-300/85 text-slate-950 ring-slate-400/40"
      }`}
    >
      {method}
    </span>
  );
}
