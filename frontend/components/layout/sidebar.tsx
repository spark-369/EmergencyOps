"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { visibleNavSections } from "@/lib/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { toggleSidebar } from "@/lib/store/ui-slice";
import { useGetActiveIncidentsQuery } from "@/lib/store/api";
import { humanize } from "@/lib/format";
import { useIsHydrated } from "@/components/providers/client-only";

/**
 * The Incidents badge, in both layouts.
 *
 * <p>This must be a <em>separate component</em>, not a hook called inside
 * `Sidebar`. `useQuery` seeds its subscription with `dataUpdatedAt: Date.now()`
 * on the very first render — and it does so <strong>even when `skip` is
 * `true`</strong> (see the class comment on `HealthIndicator`). `Sidebar` is
 * rendered by `AppShell` inside `RootLayout`, which Next.js prerenders, so the
 * hook cannot run there: the build fails with "encountered the unstable value
 * `Date.now()` in a Client Component".
 *
 * <p>Neither `skip` nor a `mounted` flag inside `Sidebar` would help — the hook
 * is still *called* before the flag flips. It must live in a child that is not
 * rendered on the server, which {@link CriticalIncidentBadgeGate} provides.
 *
 * <p>One component serves both layouts rather than a dot and a count mounted
 * separately: two mounts would mean two independent polling subscriptions.
 *
 * <p>The sidebar as a whole is deliberately not wrapped in `ClientOnly` — the nav
 * markup is static, and prerendering it is what keeps the first paint stable.
 * Only the value that needs the network is deferred.
 */
function CriticalIncidentBadge({ collapsed }: { collapsed: boolean }) {
  const incidents = useGetActiveIncidentsQuery(undefined, {
    pollingInterval: 30000,
  });
  const count = (incidents.data ?? []).filter(
    (incident) => incident.severity === "CRITICAL" || incident.severity === "CATASTROPHIC",
  ).length;

  if (count === 0) return null;

  if (collapsed) {
    return (
      <span
        aria-hidden="true"
        className="absolute -top-0.5 -right-1 h-1.5 w-1.5 rounded-full bg-rose-500 ring-2 ring-surface"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white"
      title={`${count} critical or catastrophic incident${count === 1 ? "" : "s"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Hydration gate for the badge. Renders nothing until the client takes over. */
function CriticalIncidentBadgeGate({ collapsed }: { collapsed: boolean }) {
  const hydrated = useIsHydrated();
  if (!hydrated) return null;
  return <CriticalIncidentBadge collapsed={collapsed} />;
}

/**
 * The sidebar.
 *
 * <p>Navigation is static and server-rendered; the only network-backed value it
 * shows is the Incidents badge, which is isolated in its own gated child (see
 * {@link CriticalIncidentBadge}).
 */
export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useAppSelector((state) => state.ui.sidebarCollapsed);
  const user = useAppSelector((state) => state.auth.user);
  const dispatch = useAppDispatch();

  // Sections the current role cannot use are omitted entirely.
  const sections = visibleNavSections(user?.roles ?? []);

  return (
    <aside
      aria-label="Primary"
      className={`no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border-subtle bg-surface/80 backdrop-blur-xl transition-[width] duration-200 lg:flex ${
        collapsed ? "w-[68px]" : "w-64"
      }`}
    >
      <div className="flex h-14 items-center gap-2 border-b border-border-subtle px-4">
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-400 text-sm font-bold text-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_0_22px_-4px_rgba(45,212,191,0.65)]">
          E
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">
              EmergencyOps
            </p>
            <p className="truncate text-[10px] tracking-wide text-slate-500 uppercase">
              Resource Optimization
            </p>
          </div>
        )}
      </div>

      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-2 py-4">
        {sections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                /*
                 * The badge is only defined for Incidents, and only mounts after
                 * hydration (see `CriticalIncidentBadgeGate`). Keeping the gate
                 * below the `<Link>` means the link itself — its label, href and
                 * active state — is still server-rendered.
                 */
                const showsCount = item.href === "/incidents";
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        active
                          ? "bg-teal-400/10 font-semibold text-teal-200 ring-1 ring-teal-400/25 ring-inset"
                          : "text-slate-600 hover:bg-white/5 hover:text-slate-950"
                      }`}
                    >
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-teal-300 shadow-[0_0_10px_rgba(45,212,191,0.9)]"
                        />
                      )}
                      <span
                        className={`relative w-4 shrink-0 text-center text-sm transition-colors ${
                          active
                            ? "text-teal-300"
                            : "text-slate-500 group-hover:text-slate-700"
                        }`}
                        aria-hidden="true"
                      >
                        {item.glyph}
                        {/*
                          Collapsed mode has no room for a number, so the count
                          degrades to a presence dot rendered over the glyph. In
                          expanded mode the count sits next to the label instead
                          (below), so this slot stays empty — mounting both would
                          subscribe to the same query twice.
                        */}
                        {showsCount && collapsed && (
                          <CriticalIncidentBadgeGate collapsed={true} />
                        )}
                      </span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && showsCount && <CriticalIncidentBadgeGate collapsed={false} />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border-subtle p-2">
        {/*
          Current role.

          Screens the role cannot reach are hidden entirely, so a user has no
          other way to know why "Users" is absent — it looks like a missing
          feature rather than a permission. Naming the role closes that gap, and
          the tooltip points at the remedy (ask an administrator).
        */}
        {!collapsed && user && (
          <p
            className="mb-1 truncate px-2.5 text-[10px] text-slate-500"
            title={`Signed in as ${humanize(user.role)}. Screens your role cannot use are hidden.`}
          >
            Signed in as{" "}
            <span className="font-semibold text-slate-600">{humanize(user.role)}</span>
          </p>
        )}
        <button
          type="button"
          onClick={() => dispatch(toggleSidebar())}
          className="focus-ring flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-800"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          title="Sidebar preference is remembered"
        >
          <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
