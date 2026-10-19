"use client";

import { useGetHealthQuery } from "@/lib/store/api";
import type { EventDeliveryState } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/format";

/**
 * Live API health indicator.
 *
 * Kept in a dedicated component (mounted only after hydration, see
 * `HealthIndicatorGate`) because `useQuery` seeds its subscription state with
 * `dataUpdatedAt: Date.now()`, which Next.js rejects during prerender — even
 * when `skip` is `true`. Gating the *call site* is therefore not sufficient;
 * the hook itself must not run on the server.
 */
export function HealthIndicator({ showCheckedAt = true }: { showCheckedAt?: boolean }) {
  const health = useGetHealthQuery(undefined, { pollingInterval: 30000 });

  /*
   * The backend reports event-delivery state alongside liveness:
   *   OK        — the outbox is empty, everything reached the broker
   *   DELAYED   — events are queued because the broker is unreachable; the relay
   *               retries them, so nothing is lost
   *   ATTENTION — at least one event exhausted its retries and is being re-offered
   *               on every relay pass
   *
   * Neither degradation is an API outage, so it must not read as `danger`: an
   * exhausted row means "not delivered yet", not "lost" — the relay keeps
   * re-offering it. An operator who believes events are being lost will re-enter
   * incidents that are already recorded and merely queued, so the label counts what
   * is waiting and the tooltip states the remedy.
   */
  const delivery = health.data?.details?.eventDelivery as
    | EventDeliveryState
    | undefined;
  const gaveUp = Number(health.data?.details?.outboxGaveUp ?? 0);
  const pending = Number(health.data?.details?.outboxPending ?? 0);

  const tone = health.isLoading
    ? "info"
    : health.error
      ? "danger"
      : health.data?.status !== "UP"
        ? "warning"
        : delivery === "ATTENTION" || delivery === "DELAYED"
          ? "warning"
          : "success";

  /*
   * The count is part of the label, not only of a tooltip: "Events retrying" on its
   * own is unactionable, whereas "3 events retrying" tells an operator whether this
   * is a blip or a backlog worth chasing. The remedy differs by state — ATTENTION
   * means the broker is refusing or slow, DELAYED means it is unreachable but has
   * not yet exhausted attempts — so the title spells out the next step.
   */
  const label = health.isLoading
    ? "Probing"
    : health.error
      ? "Backend unreachable"
      : delivery === "ATTENTION"
        ? gaveUp > 0
          ? `${gaveUp} event${gaveUp === 1 ? "" : "s"} retrying`
          : "Events retrying"
        : delivery === "DELAYED"
          ? pending > 0
            ? `${pending} event${pending === 1 ? "" : "s"} queued`
            : "Events queued"
          : `API ${health.data?.status ?? "unknown"}`;

  const hint =
    delivery === "ATTENTION"
      ? "The broker is not acknowledging events. They are stored durably and retried " +
        "every relay pass, so nothing is lost — check the broker and GET /api/v1/pipeline/outbox."
      : delivery === "DELAYED"
        ? "Events are queued waiting for the broker. They will be delivered once it " +
          "accepts them; the API and the data are unaffected."
        : undefined;

  return (
    <div className="flex items-center gap-2">
      <Badge label={label} tone={tone} dot title={hint} />
      {showCheckedAt && health.isSuccess && health.fulfilledTimeStamp !== undefined && (
        <span className="text-[10px] text-slate-500">
          checked{" "}
          {formatRelative(new Date(health.fulfilledTimeStamp).toISOString())}
        </span>
      )}
    </div>
  );
}
