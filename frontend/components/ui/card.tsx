import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-[var(--shadow-panel)] ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle bg-white/[0.015] px-4 py-3">
      <div className="flex items-start gap-2.5">
        {icon && <span className="mt-0.5 text-slate-500">{icon}</span>}
        <div>
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-slate-100/60 px-4 py-3 text-slate-500">
      {children}
    </footer>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "teal",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "teal" | "rose" | "amber" | "sky" | "violet" | "slate";
}) {
  /* Accent drives a top hairline glow, the tinted wash and the value colour. */
  const accents: Record<string, { glow: string; wash: string; value: string }> = {
    teal: {
      glow: "bg-teal-400/70",
      wash: "from-teal-400/12 to-teal-400/0",
      value: "text-teal-300",
    },
    rose: {
      glow: "bg-rose-400/70",
      wash: "from-rose-400/12 to-rose-400/0",
      value: "text-rose-300",
    },
    amber: {
      glow: "bg-amber-400/70",
      wash: "from-amber-400/12 to-amber-400/0",
      value: "text-amber-300",
    },
    sky: {
      glow: "bg-sky-400/70",
      wash: "from-sky-400/12 to-sky-400/0",
      value: "text-sky-300",
    },
    violet: {
      glow: "bg-violet-400/70",
      wash: "from-violet-400/12 to-violet-400/0",
      value: "text-violet-300",
    },
    slate: {
      glow: "bg-slate-400/70",
      wash: "from-slate-400/10 to-slate-400/0",
      value: "text-slate-800",
    },
  };
  const accent = accents[tone] ?? accents.teal;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface p-4 shadow-[var(--shadow-panel)] transition-colors hover:border-border-strong">
      <div className={`absolute inset-x-0 top-0 h-px ${accent.glow}`} />
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent.wash}`}
      />
      <div className="relative">
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          {label}
        </p>
        <p
          className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent.value}`}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}
