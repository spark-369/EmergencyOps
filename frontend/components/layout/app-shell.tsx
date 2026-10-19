"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { StoreProvider } from "@/components/providers/store-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandPalette } from "@/components/layout/command-palette";
import { ToastViewport } from "@/components/ui/toast-viewport";
import { useAppDispatch } from "@/lib/store/hooks";
import { hydrateSidebar } from "@/lib/store/ui-slice";

/** Routes rendered without the application chrome. */
const CHROMELESS_ROUTES = ["/login", "/register"];

/**
 * Client shell: providers + chrome shared by every route.
 *
 * The login screen deliberately renders without the sidebar and top bar — it has
 * no identity yet, and the navigation would only leak the product's structure.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const chromeless = CHROMELESS_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return (
    <StoreProvider>
      <AuthProvider>
        {/* Inside the provider: needs the Redux store for `hydrateSidebar`. */}
        <SidebarPreferenceSync />
        {chromeless ? (
          <main id="main-content">{children}</main>
        ) : (
          <div className="flex min-h-screen">
            {/*
              Skip link: the first tab stop, hidden until focused. Keyboard and
              screen-reader users land on `#main-content` instead of tabbing
              through ~20 nav items on every page.
            */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-lg focus:bg-teal-400 focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-slate-950"
            >
              Skip to content
            </a>
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <MobileNav />
              {/*
                A 4px translate + fade on a single element, so the cost is
                negligible even above a long table.
              */}
              <main
                id="main-content"
                tabIndex={-1}
                className="animate-route-in flex-1 px-4 py-5 outline-none sm:px-6 lg:px-8"
              >
                <div className="mx-auto w-full max-w-[1400px] space-y-5">{children}</div>
              </main>
              <footer className="no-print mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-4 py-3 text-[11px] text-slate-500 sm:px-6 lg:px-8">
                <span>
                  Emergency Response &amp; Resource Optimization Platform · Spring Boot v1
                  API
                </span>
                <span className="hidden items-center gap-2 sm:flex">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-2 py-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                    JWT session · Next.js App Router · Redux Toolkit · Tailwind CSS
                  </span>
                </span>
              </footer>
            </div>
          </div>
        )}
        <CommandPalette />
      </AuthProvider>
      <ToastViewport />
    </StoreProvider>
  );
}

/**
 * Restores the persisted sidebar preference after hydration.
 *
 * Split from `AppShell` so the chrome itself stays a pure layout: the dispatch
 * runs once on mount, and the initial server render still uses the default
 * (expanded) so markup matches.
 */
export function SidebarPreferenceSync() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(hydrateSidebar());
  }, [dispatch]);
  return null;
}
