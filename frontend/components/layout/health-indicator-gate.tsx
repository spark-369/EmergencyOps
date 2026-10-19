"use client";

import { HealthIndicator } from "@/components/layout/health-indicator";
import { Badge } from "@/components/ui/badge";
import { useIsHydrated } from "@/components/providers/client-only";

/**
 * Renders a static placeholder during prerender/SSR and swaps in the live
 * {@link HealthIndicator} after hydration.
 *
 * Why a separate component instead of a `mounted` flag inside the consumer:
 * `useGetHealthQuery` seeds RTK Query state with `dataUpdatedAt: Date.now()`,
 * so simply *calling* the hook during prerender trips Next.js'
 * "unstable value `Date.now()`" check. Returning early does not help because
 * hooks cannot be called conditionally — the hook must live in a child that is
 * not rendered at all on the server.
 *
 * `useIsHydrated` reads through `useSyncExternalStore`, so the swap happens in
 * the same render React already needs for hydration instead of in a follow-up
 * effect (which left the placeholder on screen for an extra frame).
 */
export function HealthIndicatorGate({
  showCheckedAt = true,
}: {
  showCheckedAt?: boolean;
}) {
  const hydrated = useIsHydrated();

  if (!hydrated) {
    // Same markup shape as the live version, minus any clock-derived text, so
    // the top bar does not shift width when the probe resolves.
    return (
      <div className="flex items-center gap-2">
        <Badge label="Connecting…" tone="neutral" dot />
      </div>
    );
  }

  return <HealthIndicator showCheckedAt={showCheckedAt} />;
}

