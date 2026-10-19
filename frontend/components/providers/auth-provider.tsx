"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Role } from "@/lib/types";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { hydrate, signOut } from "@/lib/store/ui-slice";
import { hasRole, LOGIN_PATH } from "@/lib/auth/session";
import { ClientOnly } from "@/components/providers/client-only";
import { SESSION_EXPIRED_EVENT } from "@/lib/axios";
import { ProfileSync } from "@/components/providers/profile-sync";

/** Routes reachable without a session. */
const PUBLIC_ROUTES = ["/login", "/register"];

/**
 * Routes restricted to specific roles.
 *
 * A non-matching role is sent to `/` rather than shown an error: the page and all
 * of its data would fail with 403, so there is nothing useful to display. The API
 * enforces the same rule; this only avoids a dead-end screen.
 */
const ROLE_RESTRICTED_ROUTES: { path: string; roles: Role[] }[] = [
  { path: "/users", roles: ["ADMIN"] },
];

function matchingRoute(pathname: string) {
  return ROLE_RESTRICTED_ROUTES.find(
    (route) => pathname === route.path || pathname.startsWith(`${route.path}/`),
  );
}

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Sign-in target for an unauthenticated visitor.
 *
 * `pathname` is the bare route (no query string) and deliberately does **not**
 * carry any existing `next`. The login screen is where a `next` originates, so
 * forwarding one from here means `/login?next=/register` redirects to
 * `/login?next=/login`, and every hop re-encodes the previous value —
 * `/login?next=%2Flogin%3Fnext%3D%252Flogin…` growing without bound.
 */
function signInTarget(pathname: string): string {
  if (isPublicRoute(pathname)) return LOGIN_PATH;
  return `${LOGIN_PATH}?next=${encodeURIComponent(pathname)}`;
}

/**
 * Owns the client-side session lifecycle.
 *
 * Responsibilities, in order of importance:
 * 1. Hydrate the Redux `auth` slice from `localStorage` after mounts (the server
 *    cannot read it, and doing so during render would break hydration).
 * 2. React to `SESSION_EXPIRED_EVENT`, emitted by the axios layer when a refresh
 *    fails, by clearing state and sending the user to `/login`.
 * 3. Redirect unauthenticated visitors away from protected routes, and signed-in
 *    users away from `/login`.
 *
 * This is a UX guard only. The API rejects unauthenticated and unauthorised
 * calls on its own; nothing here is a security boundary.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const { user, initialized } = useAppSelector((state) => state.auth);

  // 1. Restore the persisted session once.
  useEffect(() => {
    dispatch(hydrate());
  }, [dispatch]);

  // 2. A failed refresh means the session is gone for good.
  useEffect(() => {
    const onExpired = () => {
      dispatch(signOut());

      /*
       * Never build `next` from the current location.
       *
       * If the failure happens while already on a public screen — e.g. the login
       * page's registration-status probe — the current URL is `/login`, so
       * forwarding it would emit `/login?next=%2Flogin`, which the login screen
       * then treats as the post-sign-in target. Same growth loop as the guard had.
       */
      const current = window.location.pathname + window.location.search;
      const onPublic = PUBLIC_ROUTES.some(
        (route) =>
          window.location.pathname === route ||
          window.location.pathname.startsWith(`${route}/`),
      );
      router.replace(
        onPublic ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(current)}`,
      );
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [dispatch, router]);

  // 3. Route guards, only after hydration so the first paint never redirects.
  useEffect(() => {
    if (!initialized) return;

    if (!user && !isPublicRoute(pathname)) {
      const target = signInTarget(pathname);
      router.replace(target);
      /*
       * Safety net. If the App Router transition does not commit (it can be
       * superseded while a `loading.tsx` streams), a protected page would stay
       * mounted with no session and every request would 403. A hard replace is
       * idempotent and only fires when the URL still disagrees with the guard,
       * so it cannot reintroduce a loop.
       */
      const timer = window.setTimeout(() => {
        if (window.location.pathname !== LOGIN_PATH) {
          window.location.replace(target);
        }
      }, 1500);
      return () => window.clearTimeout(timer);
    }

    if (user && isPublicRoute(pathname)) {
      router.replace("/");
      return;
    }

    // Role-restricted area (e.g. user administration). Checked here rather than in
    // the page so the forbidden screen is never rendered even for one frame.
    const restricted = matchingRoute(pathname);
    if (user && restricted && !hasRole(user, ...restricted.roles)) {
      router.replace("/");
    }
  }, [initialized, user, pathname, router]);

  return (
    <>
      {/*
        Mounted only after hydration: `ProfileSync` calls an RTK Query hook, and
        `useQuery` reads `Date.now()` on its first render, which Next.js rejects
        during prerender even when the query is skipped.
      */}
      <ClientOnly>
        <ProfileSync />
      </ClientOnly>
      {children}
    </>
  );
}