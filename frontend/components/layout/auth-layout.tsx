import type { ReactNode } from "react";

/**
 * Shared chrome for the two unauthenticated screens (`/login`, `/register`).
 *
 * A single implementation keeps them visually identical: on wide screens a
 * branded panel sits beside the form, and on narrow screens the panel collapses
 * to a compact header so the form stays above the fold.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel — hidden on small screens to keep the form prominent. */}
      <aside className="relative hidden w-[42%] max-w-[520px] flex-col justify-between overflow-hidden border-r border-border-subtle bg-surface/50 p-10 lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_360px_at_20%_0%,rgba(20,184,166,0.14),transparent_60%)]" />

        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400 text-base font-bold text-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_0_28px_-6px_rgba(45,212,191,0.7)]">
            E
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-950">EmergencyOps</p>
            <p className="text-[11px] tracking-wide text-slate-500 uppercase">
              Resource Optimization Platform
            </p>
          </div>
        </div>

        <div className="relative space-y-4">
          <h2 className="text-xl leading-snug font-semibold text-slate-950">
            Emergency response, coordinated in one console.
          </h2>
          <ul className="space-y-2 text-xs text-slate-500">
            {[
              "Incident intake, triage and lifecycle",
              "Fleet, hospital and road-network capacity",
              "Allocation recommendations with rationale",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-300" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-slate-500">
          Access is limited to provisioned operator accounts.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          {/* Compact brand for narrow screens, where the aside is hidden. */}
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400 text-base font-bold text-slate-950">
              E
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-950">EmergencyOps</p>
              <p className="text-[11px] tracking-wide text-slate-500 uppercase">
                Resource Optimization Platform
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border-subtle bg-surface p-5 shadow-[var(--shadow-panel)]">
            <h1 className="text-lg font-semibold text-slate-950">{title}</h1>
            <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            <div className="mt-4 space-y-4">{children}</div>
          </div>

          {footer && <div className="mt-4">{footer}</div>}
        </div>
      </main>
    </div>
  );
}