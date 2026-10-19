"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

/**
 * Hydration signal.
 *
 * `getServerSnapshot` returns `false` and `getSnapshot` returns `true`, so every
 * consumer renders its fallback on the server and its content on the client —
 * exactly the one-bit switch `ClientOnly` needs. Because the value is read
 * during render by React itself, there is no intermediate frame in which the
 * component renders `null` and then swaps: the effect-based version used to
 * flash an empty screen on `/login` and `/register`.
 *
 * The store is module-level and never changes, so it is safe to share across
 * every instance and needs no cleanup.
 */
const subscribe = () => () => {};

function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

/**
 * Defers rendering of `children` until after hydration.
 *
 * Required for any subtree that calls RTK Query hooks: `useQuery` seeds its
 * subscription state with `dataUpdatedAt: Date.now()` on the very first render,
 * regardless of `skip`. With `cacheComponents` enabled, Next.js prerenders
 * Client Components and rejects that clock read, so the hook cannot run on the
 * server at all — a `mounted` flag inside the same component is not enough,
 * because the hook is still *called* before the flag flips.
 *
 * Always pass a `fallback` shaped like the real content (a skeleton or a
 * static header). It is what the server renders, what is present on the very
 * first paint, and what is shown until hydration completes.
 *
 * @example
 * <ClientOnly fallback={<SkeletonStats />}>
 *   <LiveDashboard />
 * </ClientOnly>
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const hydrated = useHydrated();
  return hydrated ? <>{children}</> : <>{fallback}</>;
}

/**
 * Escape hatch for leaves whose only client-only behaviour is a clock read
 * (relative timestamps, "checked 12s ago"). Prefer `ClientOnly` when the whole
 * subtree needs RTK Query; use this when only a few characters differ.
 */
export function useIsHydrated(): boolean {
  return useHydrated();
}

