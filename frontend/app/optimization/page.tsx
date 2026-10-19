"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { OptimizationDecision, ReoptimizeResult } from "@/lib/types";
import {
  useFlushOutboxMutation,
  useGetActiveIncidentsQuery,
  useGetOutboxStatusQuery,
  useGetPipelineEventsQuery,
  useOptimizeForIncidentQuery,
  useReoptimizeAllMutation,
  useReplayPipelineEventMutation,
} from "@/lib/store/api";
import { getErrorMessage, useMutationToast } from "@/lib/use-api-notify";
import { ClientOnly } from "@/components/providers/client-only";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, StatCard } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  SkeletonStats,
  SkeletonTable,
  Toolbar,
} from "@/components/ui/layout";
import type { Column } from "@/components/ui/table";
import { DataTable, Mono } from "@/components/ui/table";
import { Badge, SeverityBadge } from "@/components/ui/badge";
import { SEVERITY_RANK, formatDateTime, formatNumber, formatRelative, humanize, percent } from "@/lib/format";
import { shortId } from "@/components/incidents/incident-detail";

/**
 * Severity rank with a fallback.
 *
 * `SEVERITY_RANK` is a `Record<string, number>`, so a missing key returns
 * `undefined` at runtime despite the type saying `number`. The backend omits
 * nulls, so an absent severity is entirely possible and would otherwise sort to
 * an arbitrary position.
 */
function severityRank(value?: string): number {
  return (value && SEVERITY_RANK[value]) || 0;
}

/**
 * Human explanation of one optimisation decision.
 *
 * <p>The backend has already done the work: `rationale` is a single formatted
 * sentence, and every fact inside it (unit, type, severity, priority, ETA,
 * estimate source, load) is *also* present as a structured field on the same
 * payload. Rendering that sentence as-is repeats the whole panel as prose and
 * tells an operator nothing about <em>why</em> the choice was made.
 *
 * <p>This component explains each selection criterion separately, in the order
 * the engine applied them, so the reasoning is auditable:
 *
 * <ol>
 *   <li><b>Eligibility</b> — severity gates which unit types may respond at all
 *       ({@code OptimizationService.isResourceSuitableForIncident}).</li>
 *   <li><b>Selection</b> — among eligible units, the one with the shortest
 *       estimated travel time wins ({@code Stream.min} on ETA).</li>
 *   <li><b>Confidence</b> — whether that ETA came from the road graph or the
 *       straight-line fallback, which changes how much to trust it.</li>
 * </ol>
 *
 * <p>Every claim is derived from fields on the decision; nothing is invented.
 * The raw sentence is still available behind a disclosure for audit purposes.
 */
function DecisionExplanation({
  decision,
  showRaw = true,
}: {
  decision: OptimizationDecision;
  /** Hides the raw-sentence disclosure where the caller already shows it. */
  showRaw?: boolean;
}) {
  const covered = Boolean(decision.allocatedResourceId);
  const fallback = decision.etaSource !== "ROAD_GRAPH";
  const severity = decision.incidentSeverity;
  const load = decision.unitCurrentLoad;
  const capacity = decision.unitCapacity;

  /*
   * The severity gate mirrors `isResourceSuitableForIncident`: CRITICAL and
   * CATASTROPHIC need a medical/rescue asset, HIGH needs a narrower set, and
   * LOW/MEDIUM accept anything. Stating the rule that applied is what makes the
   * pick defensible after the fact.
   */
  const eligibilityRule =
    severity === "CATASTROPHIC" || severity === "CRITICAL"
      ? "Critical and catastrophic incidents require an ambulance, helicopter, rescue team or hospital."
      : severity === "HIGH"
        ? "High-severity incidents require an ambulance, rescue team or hospital."
        : "Low and medium incidents accept any available unit.";

  const loadPercent =
    load !== undefined && capacity !== undefined && capacity > 0 ? percent(load, capacity) : null;

  return (
    <div className="space-y-3">
      {!covered ? (
        <div className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2.5 text-xs leading-relaxed text-rose-200">
          <p className="font-semibold">No unit was selected.</p>
          <p className="mt-1">
            No available unit met all three conditions: spare capacity, an eligible type for a{" "}
            {humanize(severity)} incident, and a location the router could reach. Dispatch
            manually, or free a unit and run the optimiser again.
          </p>
        </div>
      ) : (
        <ol className="space-y-2.5">
          {/* 1 — what the engine filtered on before comparing anything. */}
          <ExplanationStep index={1} title="Eligibility">
            {eligibilityRule} A {humanize(decision.resourceType).toLowerCase()} qualifies
            {loadPercent !== null ? ", and it has spare capacity" : ""}.
          </ExplanationStep>

          {/* 2 — the actual ranking criterion. */}
          <ExplanationStep index={2} title="Fastest arrival">
            Among the eligible units, this one had the shortest estimated travel time
            {decision.estimatedTravelTimeWindow ? (
              <>
                {" — "}
                <span className="font-mono font-medium text-slate-700">
                  {decision.estimatedTravelTimeWindow}
                </span>
              </>
            ) : null}
            .
          </ExplanationStep>

          {/* 3 — how much to trust that number. */}
          <ExplanationStep
            index={3}
            title="Estimate confidence"
            tone={fallback ? "warning" : "default"}
          >
            {fallback
              ? "Straight-line estimate. The road graph had no route (or its circuit breaker was open), so closures and congestion are not priced in — treat this ETA as optimistic."
              : "Routed on the maintained road graph, so closures and congestion are already priced in."}
          </ExplanationStep>

          {/* 4 — remaining capacity: what limits the next dispatch from this unit. */}
          {loadPercent !== null && (
            <ExplanationStep index={4} title="Remaining capacity">
              Carrying {formatNumber(load)} of {formatNumber(capacity)} ({loadPercent}%). It leaves
              the candidate pool once load reaches capacity.
            </ExplanationStep>
          )}
        </ol>
      )}

      {/*
        The backend's own sentence, kept for audit. It is the literal record of
        what the server decided, so hiding it entirely would make this panel a
        reinterpretation rather than a presentation of the decision.
      */}
      {showRaw && decision.rationale && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[10px] font-medium text-slate-500 transition-colors hover:text-slate-700">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
            Engine rationale (raw)
          </summary>
          <p className="mt-1 rounded-md border border-border-subtle bg-slate-100/60 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-slate-600">
            {decision.rationale}
          </p>
        </details>
      )}
    </div>
  );
}

/** One numbered step in the explanation. */
function ExplanationStep({
  index,
  title,
  tone = "default",
  children,
}: {
  index: number;
  title: string;
  tone?: "default" | "warning";
  children: ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-400/15 text-[9px] font-bold text-teal-300 ring-1 ring-teal-400/30 ring-inset"
      >
        {index}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-slate-800">{title}</p>
        <p
          className={`mt-0.5 text-[11px] leading-relaxed ${
            tone === "warning" ? "text-amber-300" : "text-slate-500"
          }`}
        >
          {children}
        </p>
      </div>
    </li>
  );
}

/**
 * Live optimization view. Rendered only after hydration via `ClientOnly`,
 * because its RTK Query hooks read `Date.now()` on first render.
 */
function OptimizationView() {
  const [result, setResult] = useState<ReoptimizeResult | null>(null);
  const [incidentId, setIncidentId] = useState("");
  const [target, setTarget] = useState("");

  const run = useMutationToast();
  const [reoptimizeAll, { isLoading: isReoptimizing }] = useReoptimizeAllMutation();
  const recommendation = useOptimizeForIncidentQuery(target, { skip: target === "" });
  /*
   * Candidate incidents for the dropdown. Loaded once per mount and refreshed by the
   * `Incident` tags, so the list a dispatcher picks from matches the register.
   */
  const incidents = useGetActiveIncidentsQuery();

  const runOptimization = async () => {
    const outcome = await run(reoptimizeAll, undefined, {
      method: "POST",
      successTitle: "Fleet re-optimised",
      successDescription: "Every active incident was re-matched against free resources.",
    });
    if (outcome.ok && outcome.data) setResult(outcome.data);
  };

  /*
   * Plan summary.
   *
   * All of it derives from `result.decisions`, so it is only meaningful after a
   * run. Each figure is guarded to `null`/0 rather than a misleading zero: an
   * "Earliest ETA: 0 min" would read as instantaneous arrival.
   */
  const decisions = result?.decisions ?? [];
  const decisionCount = decisions.length;
  const matched = decisions.filter((decision) => Boolean(decision.allocatedResourceId));
  const matchedCount = matched.length;
  const unmatchedCount = decisionCount - matchedCount;
  const coveragePercent = decisionCount === 0 ? 0 : percent(matchedCount, decisionCount);

  /** Only matched rows carry a travel estimate worth averaging. */
  const etas = matched
    .map((decision) => decision.estimatedTravelTimeMinutes)
    .filter((value): value is number => typeof value === "number");

  const fastestEta = etas.length === 0 ? null : Math.min(...etas);
  const slowestEta = etas.length === 0 ? null : Math.max(...etas);
  const averageEta =
    etas.length === 0 ? 0 : Math.round(etas.reduce((sum, value) => sum + value, 0) / etas.length);

  /**
   * How many estimates came from the road graph rather than the straight-line
   * fallback. This is the plan's confidence, not a data-quality nicety: the
   * fallback ignores closures and congestion entirely.
   */
  const roadGraphCount = matched.filter(
    (decision) => decision.etaSource === "ROAD_GRAPH",
  ).length;
  const graphPercent = matchedCount === 0 ? 0 : percent(roadGraphCount, matchedCount);

  /**
   * Decisions ordered by what an operator acts on first: severity, then
   * priority. The backend returns its own matching order, which is by priority
   * within a pass — but the table is re-readable after the fact, and a
   * CATASTROPHIC buried mid-list is the wrong default.
   */
  const orderedDecisions = useMemo(
    () =>
      [...decisions].sort(
        (a, b) =>
          severityRank(b.incidentSeverity) - severityRank(a.incidentSeverity) ||
          (b.incidentPriority ?? 0) - (a.incidentPriority ?? 0),
      ),
    [decisions],
  );

  const columns: Column<OptimizationDecision>[] = [
    {
      key: "incidentId",
      header: "Incident",
      render: (row) => {
        /*
         * The matched/unmatched state is the single most consequential property
         * of a row — an unmatched incident has no unit en route to it — so it is
         * a rail rather than a badge buried in a later column.
         */
        const covered = Boolean(row.allocatedResourceId);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              title={covered ? "Matched to a unit" : "No unit available"}
              className={`h-8 w-1 shrink-0 rounded-full ${covered ? "bg-emerald-400" : "bg-rose-500"}`}
            />
            <div className="min-w-0">
              <p className="font-mono text-xs text-slate-900">{shortId(row.incidentId)}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {covered ? "Matched" : "Needs an operator"}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: "severity",
      header: "Severity",
      render: (row) => <SeverityBadge value={row.incidentSeverity} />,
    },
    {
      key: "priority",
      header: "Priority",
      hideBelow: "sm",
      render: (row) => (
        <span className="font-semibold tabular-nums text-slate-800">
          {formatNumber(row.incidentPriority)}
        </span>
      ),
    },
    {
      key: "resource",
      header: "Recommended unit",
      render: (row) =>
        row.allocatedResourceId ? (
          <div className="min-w-0">
            <p className="font-mono text-xs text-slate-900">
              {shortId(row.allocatedResourceId)}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">{humanize(row.resourceType)}</p>
          </div>
        ) : (
          <Badge
            label="No suitable unit"
            tone="danger"
            title="No free unit of a compatible type was within range for this incident"
          />
        ),
    },
    {
      key: "eta",
      header: "ETA",
      hideBelow: "md",
      render: (row) => {
        if (
          row.estimatedTravelTimeMinutes === null ||
          row.estimatedTravelTimeMinutes === undefined
        ) {
          return <span className="text-xs text-slate-500">—</span>;
        }
        // The window is a range on the road graph (e.g. `12–15 min`) and a point
        // estimate (~9 min) on the fallback; show whichever the backend sent.
        const value = row.estimatedTravelTimeWindow
          ? row.estimatedTravelTimeWindow.replace(/\s*min$/, "")
          : formatNumber(row.estimatedTravelTimeMinutes);
        const fallback = row.etaSource !== "ROAD_GRAPH";
        return (
          <div className="flex flex-col">
            <span
              className="text-xs font-semibold tabular-nums text-slate-800"
              title={
                fallback
                  ? "Straight-line estimate — closures and congestion are ignored"
                  : "Routed on the maintained road graph"
              }
            >
              {value}
              <span className="ml-1 font-normal text-slate-500">min</span>
            </span>
            <span
              className={`mt-0.5 text-[10px] font-medium ${
                fallback ? "text-amber-300" : "text-slate-500"
              }`}
            >
              {fallback ? "straight line" : "road graph"}
            </span>
          </div>
        );
      },
    },
    {
      key: "rationale",
      header: "Why this unit",
      hideBelow: "lg",
      render: (row) => {
        /*
         * The table shows the two facts that differentiate rows at a glance —
         * the ranking criterion (ETA) and how much to trust it (source) — with
         * the full factor-by-factor explanation available inline. Dumping the
         * backend's sentence here was unreadable at this width and repeated
         * columns that are already to its left.
         */
        const fallback = row.etaSource !== "ROAD_GRAPH";
        return (
          <details className="group max-w-[320px]">
            <summary className="cursor-pointer list-none">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <span
                  aria-hidden="true"
                  className="inline-block transition-transform group-open:rotate-90"
                >
                  ▸
                </span>
                {row.allocatedResourceId ? (
                  <>
                    Fastest eligible unit
                    <span className={fallback ? "text-amber-300" : "text-slate-500"}>
                      · {fallback ? "estimated" : "routed"}
                    </span>
                  </>
                ) : (
                  <span className="text-rose-300">Nothing suitable available</span>
                )}
              </span>
            </summary>
            <div className="mt-2 rounded-md border border-border-subtle bg-slate-100/40 p-2.5">
              <DecisionExplanation decision={row} />
            </div>
          </details>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Optimization engine"
        description="Matches open incidents to the fastest suitable unit with spare capacity. Recommendations are read-only — nothing is dispatched until an operator confirms."
        actions={
          <Button variant="primary" loading={isReoptimizing} onClick={runOptimization}>
            Re-optimise fleet
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Covered"
          value={result ? `${formatNumber(matchedCount)}/${formatNumber(decisionCount)}` : "—"}
          hint={
            result
              ? decisionCount === 0
                ? "No active incidents to match"
                : `${coveragePercent}% of open incidents have a unit`
              : "Run the optimiser to see coverage"
          }
          tone={
            !result
              ? "slate"
              : decisionCount === 0
                ? "slate"
                : coveragePercent >= 100
                  ? "teal"
                  : coveragePercent >= 50
                    ? "amber"
                    : "rose"
          }
        />
        <StatCard
          label="Unmatched"
          value={result ? formatNumber(unmatchedCount) : "—"}
          hint={
            unmatchedCount > 0 ? "No suitable unit available" : "Every incident covered"
          }
          tone={unmatchedCount > 0 ? "rose" : result ? "teal" : "slate"}
        />
        <StatCard
          label="Earliest ETA"
          value={fastestEta === null ? "—" : `${fastestEta} min`}
          hint={
            fastestEta === null
              ? "No travel estimates yet"
              : `Mean ${averageEta} min · slowest ${slowestEta} min`
          }
          tone="violet"
        />
        <StatCard
          label="Estimate confidence"
          value={result ? `${graphPercent}%` : "—"}
          hint={
            !result
              ? "Run the optimiser to measure"
              : roadGraphCount === 0
                ? "All ETAs are straight-line fallbacks"
                : `${roadGraphCount} of ${matchedCount} routed on the road graph`
          }
          tone={
            !result
              ? "slate"
              : roadGraphCount === 0
                ? "amber"
                : graphPercent >= 80
                  ? "teal"
                  : "sky"
          }
        />
      </div>

      {/*
        Reliability caveat. A fallback ETA is a straight-line estimate: it ignores
        closures, congestion and one-ways, so a plan built mostly from them looks
        precise while being systematically optimistic. Saying so is the difference
        between a number an operator trusts and one they should not.
      */}
      {result && matchedCount > 0 && roadGraphCount < matchedCount && (
        <div
          role="status"
          className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${
            roadGraphCount === 0
              ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
              : "border-border-subtle bg-surface text-slate-600"
          }`}
        >
          <span
            aria-hidden="true"
            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
              roadGraphCount === 0 ? "bg-amber-400" : "bg-sky-400"
            }`}
          />
          <span>
            {roadGraphCount === 0 ? (
              <>
                <strong className="font-semibold">Every ETA is a straight-line fallback.</strong>{" "}
                Closures and congestion are not accounted for — treat these times as optimistic.
              </>
            ) : (
              <>
                {matchedCount - roadGraphCount} of {matchedCount} ETAs used the straight-line
                fallback rather than the road graph, so those are optimistic.
              </>
            )}
          </span>
        </div>
      )}

      <Card>
        <CardHeader
          title="Re-optimisation result"
          description={
            result?.optimizedAt
              ? `Computed ${formatDateTime(result.optimizedAt)} · ${formatRelative(result.optimizedAt)}`
              : "Run the optimiser to generate recommendations"
          }
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={runOptimization}
              loading={isReoptimizing}
            >
              Run again
            </Button>
          }
        />
        {result ? (
          <>
            <DataTable
              columns={columns}
              rows={orderedDecisions}
              rowKey={(row, index) => `${row.incidentId ?? "d"}-${index}`}
              emptyTitle="No active incidents"
              emptyDescription="The optimiser found no open incidents to match against the fleet."
            />
            <CardFooter>
              <span>
                {formatNumber(decisionCount)} incident{decisionCount === 1 ? "" : "s"} evaluated ·{" "}
                {formatNumber(matchedCount)} matched
              </span>
              {unmatchedCount > 0 ? (
                <span className="text-rose-300">
                  {formatNumber(unmatchedCount)} need an operator — dispatch manually
                </span>
              ) : (
                <span className="text-emerald-300">Full coverage</span>
              )}
            </CardFooter>
          </>
        ) : (
          <CardBody>
            <div className="flex flex-col gap-1.5 py-1">
              <p className="text-xs text-slate-500">
                No run yet. Re-optimisation is read-only: it recommends matches without creating
                allocations, so nothing is dispatched until an operator confirms.
              </p>
              <p className="text-[11px] text-slate-500">
                Run it whenever the fleet changes hands or a new incident is reported — the
                result is a snapshot, not a live view.
              </p>
            </div>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Recommendation for one incident"
          description="Preview the match for a single incident without running a full pass"
        />
        <Toolbar>
          <Field label="Incident" hint="Open incidents, highest priority first">
            <Select
              className="w-80"
              value={incidentId}
              onChange={(event) => setIncidentId(event.target.value)}
            >
              <option value="">Select an incident…</option>
              {(incidents.data ?? []).map((incident) => (
                <option key={incident.incidentId} value={incident.incidentId}>
                  {incident.locationDescription ?? shortId(incident.incidentId)} ·{" "}
                  {humanize(incident.severity)} · P{formatNumber(incident.priorityScore)}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="primary"
            onClick={() => setTarget(incidentId)}
            disabled={incidentId === ""}
            loading={recommendation.isFetching}
          >
            Get recommendation
          </Button>
        </Toolbar>
        <CardBody>
          {target === "" ? (
            <EmptyState
              title="Nothing selected"
              description="Pick an open incident to see which unit the optimiser would send, and why."
            />
          ) : recommendation.isLoading ? (
            <SkeletonTable rows={3} />
          ) : recommendation.isError ? (
            <ErrorState
              message={getErrorMessage(recommendation.error, "Optimization failed")}
              onRetry={() => recommendation.refetch()}
            />
          ) : recommendation.data ? (
            <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Incident</dt>
                  <dd className="font-mono text-xs text-slate-800">
                    {shortId(recommendation.data.incidentId ?? target)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Severity</dt>
                  <dd>
                    <SeverityBadge value={recommendation.data.incidentSeverity} />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Priority</dt>
                  <dd className="font-semibold tabular-nums text-slate-800">
                    {formatNumber(recommendation.data.incidentPriority)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Recommended unit</dt>
                  <dd>
                    {recommendation.data.recommendedResourceId ? (
                      <span className="font-mono text-xs text-slate-800">
                        {shortId(recommendation.data.recommendedResourceId)}
                      </span>
                    ) : (
                      <Badge label="None available" tone="danger" />
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Unit type</dt>
                  <dd className="text-slate-800">{humanize(recommendation.data.resourceType)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Estimated travel</dt>
                  <dd className="tabular-nums text-slate-800">
                    {recommendation.data.estimatedTravelTimeWindow ??
                      (formatNumber(recommendation.data.estimatedTravelTimeMinutes) + " min")}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Estimate source</dt>
                  <dd
                    className={`text-[11px] font-medium ${
                      recommendation.data.etaSource === "ROAD_GRAPH"
                        ? "text-slate-500"
                        : "text-amber-300"
                    }`}
                  >
                    {recommendation.data.etaSource === "ROAD_GRAPH"
                      ? "Road graph"
                      : recommendation.data.etaSource === "GEOMETRIC_FALLBACK"
                        ? "Straight line (optimistic)"
                        : "—"}
                  </dd>
                </div>
              </dl>
              <div className="panel-inset p-3">
                <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  Why this unit
                </p>
                <div className="mt-2">
                  {/*
                    Rebuilt from the structured fields rather than echoing the
                    backend's one-line sentence: the same facts are already in the
                    definition list beside this panel, so the value here is the
                    *reasoning*, not a restatement.
                  */}
                  <DecisionExplanation
                    decision={{
                      incidentId: recommendation.data.incidentId,
                      incidentSeverity: recommendation.data.incidentSeverity,
                      incidentPriority: recommendation.data.incidentPriority,
                      allocatedResourceId: recommendation.data.recommendedResourceId,
                      resourceType: recommendation.data.resourceType,
                      estimatedTravelTimeMinutes:
                        recommendation.data.estimatedTravelTimeMinutes,
                      estimatedTravelTimeWindow:
                        recommendation.data.estimatedTravelTimeWindow,
                      etaSource: recommendation.data.etaSource,
                      unitCurrentLoad: recommendation.data.unitCurrentLoad,
                      unitCapacity: recommendation.data.unitCapacity,
                      rationale: recommendation.data.rationale,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <PipelinePanel />
    </>
  );
}

/**
 * Outbox and replay controls.
 *
 * <p>`GET /pipeline/outbox` reports what the transactional outbox still owes the
 * broker; `POST /pipeline/outbox/flush` forces a relay pass instead of waiting for
 * the 15 s schedule; `POST /pipeline/replay/{eventId}` re-sends one stored event
 * after a consumer or broker fault has been fixed.
 *
 * <p>The `PROCESSING_FAILED` list below is what makes the replay button usable: an
 * operator needs the event id of the row that failed, and it is only obtainable by
 * querying the store. Replay keeps the original event id, so a consumer that
 * already applied the event treats the copy as a duplicate.
 */
function PipelinePanel() {
  const run = useMutationToast();
  const outbox = useGetOutboxStatusQuery(undefined, { pollingInterval: 30000 });
  const failures = useGetPipelineEventsQuery(
    { type: "PROCESSING_FAILED", limit: 10 },
    { pollingInterval: 30000 },
  );
  const [flushOutbox, flushState] = useFlushOutboxMutation();
  const [replayEvent, replayState] = useReplayPipelineEventMutation();

  const pending = outbox.data?.pending ?? 0;
  const gaveUp = outbox.data?.gaveUp ?? 0;
  const published = outbox.data?.published ?? 0;

  return (
    <Card>
      <CardHeader
        title="Event delivery"
        description="Facts recorded here are delivered to the broker by the outbox relay. Nothing is lost if it lags."
      />
      <CardBody className="space-y-4">
        {/* Health strip: one line that says whether the pipeline needs attention. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-slate-700">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                gaveUp > 0 ? "bg-rose-400" : pending > 0 ? "bg-amber-400" : "bg-emerald-400"
              }`}
            />
            {gaveUp > 0
              ? "Attention required"
              : pending > 0
                ? "Delivering"
                : "Fully delivered"}
          </span>
          <span className="text-slate-500">
            {formatNumber(published)} fact{published === 1 ? "" : "s"} acknowledged
          </span>
          {outbox.data?.broker && (
            <span className="hidden font-mono text-[11px] text-slate-500 sm:inline">
              broker {outbox.data.broker}
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            loading={flushState.isLoading}
            onClick={() =>
              run(flushOutbox, undefined, {
                method: "POST",
                successTitle: "Outbox flushed",
                successDescription: "One relay pass completed.",
              })
            }
          >
            Force a relay pass
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Queued"
            value={formatNumber(pending)}
            tone={pending > 0 ? "amber" : "teal"}
            hint="Not yet acknowledged by the broker"
          />
          <StatCard
            label="Exhausted"
            value={formatNumber(gaveUp)}
            tone={gaveUp > 0 ? "rose" : "teal"}
            hint="Retry budget spent — still retried"
          />
          <StatCard
            label="Delivered"
            value={formatNumber(published)}
            tone="teal"
            hint="Acknowledged facts (excludes bookkeeping)"
          />
        </div>

        <p className="text-[11px] text-slate-500">
          {/*
            `pending` includes the exhausted rows, so it is the truthful backlog.
            The copy distinguishes "queued and waiting" from "budget spent", because
            only the latter needs an operator: an exhausted row keeps being retried,
            so the fix is on the broker side, not in this console.
          */}
          {gaveUp > 0
            ? `${pending} event(s) are undelivered, ${gaveUp} of them after exhausting their retries. They stay queued and are retried every pass — check the broker, then flush.`
            : pending > 0
              ? `${pending} event(s) are queued durably and will be delivered as soon as the broker accepts them.`
              : "Nothing outstanding: every recorded fact reached the broker."}
        </p>

        {/*
          The reason, not just the count. Rendering the last delivery error is what
          turns "PUBLISHED is always zero" from a mystery into an actionable line
          (wrong broker address / missing topic / rejected ACL) — previously that text
          existed only in the `lastError` column.
        */}
        {pending > 0 && (
          <div className="panel-inset space-y-1 px-3 py-2">
            <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Last delivery error
            </p>
            {outbox.data?.lastDeliveryError ? (
              <p className="font-mono text-[11px] leading-relaxed break-words text-rose-300">
                {outbox.data.lastDeliveryError}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">
                No error recorded yet — the next relay pass will report one.
              </p>
            )}
            {outbox.data?.broker && (
              <p className="text-[10px] text-slate-500">
                broker:{" "}
                <code className="font-mono">{outbox.data.broker}</code>
              </p>
            )}
          </div>
        )}

        {failures.isError ? (
          <ErrorState
            message={getErrorMessage(failures.error, "Failed to load processing failures")}
            onRetry={() => failures.refetch()}
          />
        ) : failures.data && failures.data.length > 0 ? (
          <ul className="space-y-2">
            {failures.data.map((event) => (
              <li
                key={event.eventId}
                className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-slate-100/50 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <Mono>{shortId(event.eventId)}</Mono>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {event.type} · {formatDateTime(event.occurredAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={replayState.isLoading}
                  onClick={() =>
                    event.eventId &&
                    run(replayEvent, event.eventId, {
                      method: "POST",
                      successTitle: "Event replayed",
                      successDescription:
                        "Consumers treat a replay as a duplicate of the original event id.",
                    })
                  }
                  disabled={!event.eventId}
                >
                  Replay
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            No failed events recorded — nothing needs replaying.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export default function OptimizationPage() {
  return (
    <ClientOnly
      fallback={
        <div aria-busy="true" aria-live="polite">
          <PageHeader
            eyebrow="Intelligence"
            title="Optimization engine"
            description="Matches open incidents to the fastest suitable unit with spare capacity. Recommendations are read-only — nothing is dispatched until an operator confirms."
          />
          <SkeletonStats count={4} />
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
            <div className="border-b border-border-subtle px-4 py-3">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="mt-2 h-2.5 w-64" />
            </div>
            <SkeletonTable rows={6} />
          </div>
        </div>
      }
    >
      <OptimizationView />
    </ClientOnly>
  );
}


