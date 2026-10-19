"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setPaletteOpen } from "@/lib/store/ui-slice";
import { API_BASE_URL } from "@/lib/axios";
import { visibleNavItems } from "@/lib/navigation";
import { HealthIndicatorGate } from "@/components/layout/health-indicator-gate";
import { UserMenu } from "@/components/layout/user-menu";

export function Topbar() {
  const pathname = usePathname();
  const user = useAppSelector((state) => state.auth.user);
  const dispatch = useAppDispatch();

  // Only entries the current role can reach are considered for the breadcrumb.
  const navItems = visibleNavItems(user?.roles ?? []);

  const current =
    navItems.find((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
    ) ?? navItems[0];

  const apiMapActive = pathname.startsWith("/api-explorer");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border-subtle bg-background/80 px-4 backdrop-blur-xl">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <li>
              {/*
                The crumb is a link, not a label. It previously read "Platform /
                Incidents" as inert text, so the one affordance a breadcrumb is
                supposed to offer — a way back up — did not exist.
              */}
              <Link
                href="/"
                className="rounded transition-colors hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400"
              >
                Platform
              </Link>
            </li>
            <li aria-hidden="true" className="text-slate-500">
              /
            </li>
            <li aria-current="page" className="font-medium text-slate-700">
              {current?.label ?? ""}
            </li>
          </ol>
        </nav>
        <p className="truncate text-xs text-slate-500">{current?.description ?? ""}</p>
      </div>

      <div className="flex items-center gap-2">
        {/*
          Palette trigger. Rendered as a button (not an input) so it cannot be
          mistaken for a real search field: activating it opens the ⌘K dialog,
          which owns the actual input and focus.
        */}
        <button
          type="button"
          onClick={() => dispatch(setPaletteOpen(true))}
          aria-label="Open command palette (Ctrl or Command + K)"
          aria-keyshortcuts="Meta+K Control+K"
          className="focus-ring hidden items-center gap-2 rounded-lg border border-border-subtle bg-surface py-1.5 pr-1.5 pl-2.5 text-xs text-slate-500 transition-colors hover:border-border-strong hover:text-slate-800 md:flex"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <span>Jump to…</span>
          <kbd className="rounded border border-border-subtle bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            ⌘K
          </kbd>
        </button>

        <div className="hidden md:flex">
          {/*
            The health probe is isolated behind a gate: `useQuery` initialises
            `dataUpdatedAt: Date.now()`, which cannot run during prerender.
          */}
          <HealthIndicatorGate />
        </div>

        {/*
          The API base URL used to be a permanently visible monospace chip. It is
          genuinely useful when debugging a connection, but it is noise in an
          operations header — the address only matters when something is wrong.
          It now lives in the tooltip of the API-map link, which is where anyone
          investigating CORS or a wrong backend would look anyway.
        */}
        <Link
          href="/api-explorer"
          aria-current={apiMapActive ? "page" : undefined}
          title={`API explorer · ${API_BASE_URL}`}
          className={`hidden rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400 sm:block ${
            apiMapActive
              ? "bg-teal-400/10 text-teal-200 ring-1 ring-teal-400/25 ring-inset"
              : "text-slate-500 hover:bg-white/5 hover:text-slate-800"
          }`}
        >
          API map
        </Link>

        <UserMenu />
      </div>
    </header>
  );
}
