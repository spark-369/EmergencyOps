"use client";

import type { ReactNode } from "react";
import type { Incident, PipelineEventView } from "@/lib/types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue } from "@/components/ui/table";
import { SeverityBadge, StatusBadge } from "@/components/ui/badge";
import { formatCoord, formatDateTime, formatNumber, humanize } from "@/lib/format";
import { useGetAllocationSummaryByIncidentQuery, useGetPipelineTimelineQuery } from "@/lib/store/api";
import { getErrorMessage } from "@/lib/use-api-notify";
import { ErrorState, SkeletonTable } from "@/components/ui/layout";

export function shortId(id?: string): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Read-only JSON viewer for the free-form `Map<String,Object>` columns
 * (`resourceRequirements`, `environmentalConditions`).
 *
 * The fill is `surface-muted`, not a slate step: this panel sits *inside* a
 * card, so it needs a recessed surface token rather than a palette value that
 * is free to be re-tuned. Wrap mode replaces horizontal scrolling — these
 * objects are short and an operator should never have to scroll sideways to
 * read them.
 */
export function JsonBlock({ value }: { value?: Record<string, unknown> }) {
  if (!value || Object.keys(value).length === 0) {
    return <span className="text-xs text-slate-500">Not provided</span>;
  }
  return (
    <pre className="scroll-thin max-h-40 overflow-auto rounded-lg border border-border-subtle bg-slate-50 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-teal-200">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Pure presentation of an incident — shared by the detail route and drawer. */
export function IncidentDetail({ incident }: { incident: Incident }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader
            title={incident.locationDescription ?? "Incident"}
            description={[
              humanize(incident.status),
              incident.severity ? `${humanize(incident.severity)} severity` : null,
              incident.createdAt
                ? `reported ${formatDateTime(incident.createdAt)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            actions={
              <div className="flex items-center gap-1.5">
                <SeverityBadge value={incident.severity} />
                <StatusBadge value={incident.status} />
              </div>
            }
          />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {/*
                The business id is a UUID. It is needed (it is the key every
                mutation and the pipeline use) but it is not *information* — so it
                is shown truncated with the full value in a tooltip and selectable
                text, instead of a 36-character string wrapping across the card.
              */}
              <KeyValue
                label="Incident ID"
                value={
                  <span
                    className="cursor-help font-mono text-xs text-slate-700"
                    title={incident.incidentId ?? "—"}
                  >
                    {shortId(incident.incidentId)}
                  </span>
                }
              />
              <KeyValue label="Priority score" value={formatNumber(incident.priorityScore)} />

              <KeyValue label="Affected people" value={formatNumber(incident.affectedPeople)} />
              <KeyValue
                label="Time sensitivity"
                value={`${formatNumber(incident.timeSensitivityMinutes)} min`}
              />
              <KeyValue
                label="Est. response"
                value={`${formatNumber(incident.estimatedResponseTimeMinutes)} min`}
              />
              <KeyValue
                label="Coordinates"
                value={
                  <span className="font-mono text-xs">
                    {formatCoord(incident.latitude, incident.longitude)}
                  </span>
                }
              />
              <KeyValue label="Created" value={formatDateTime(incident.createdAt)} />
              <KeyValue label="Updated" value={formatDateTime(incident.updatedAt)} />
            </dl>
          </CardBody>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader title="Resource requirements" />
            <CardBody>
              <JsonBlock value={incident.resourceRequirements} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Environmental conditions" />
            <CardBody>
              <JsonBlock value={incident.environmentalConditions} />
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Embedded allocations"
            description="Deployments captured in this incident's own payload"
          />
          <CardBody>
            {incident.allocations && incident.allocations.length > 0 ? (
              <ul className="space-y-2">
                {incident.allocations.map((allocation, index) => (
                  <li
                    key={`${allocation.resourceId}-${index}`}
                    className="rounded-lg border border-border-subtle bg-slate-100/50 px-2.5 py-2"
                  >
                    {/*
                      The unit *type* leads, not its UUID. An operator reads
                      "Ambulance, arrived in 15 min"; the identifier is only ever
                      needed to look the unit up, so it is demoted to a tooltip.
                    */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-800">
                        {humanize(allocation.resourceType)}
                      </span>
                      <StatusBadge value={allocation.status} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Travel {formatNumber(allocation.estimatedTravelTimeMinutes)} min
                      {allocation.status === "EN_ROUTE" && " · en route"}
                      {allocation.status === "ARRIVED" && " · on scene"}
                    </p>
                    {allocation.resourceId && (
                      <p
                        className="mt-1 cursor-help font-mono text-[9px] text-slate-500"
                        title={`Unit id ${allocation.resourceId}`}
                      >
                        unit {shortId(allocation.resourceId)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">No allocations attached.</p>
            )}
          </CardBody>
        </Card>

        <AllocationSummaryCard incidentId={incident.incidentId} />

        <PipelineTimelineCard aggregateId={incident.incidentId} />
      </div>
    </div>
  );
}

/**
 * Describes one pipeline event from its payload.
 *
 * <p>The timeline previously rendered `<event type> · correlation <short-uuid>`,
 * which answers "did something happen" but not "what happened". The correlation
 * id is a tracing handle — useless to an operator triaging an incident, and
 * identical in shape to every other id on the page, so it actively obscured the
 * facts. The payload already contains the answer:
 *
 * <ul>
 *   <li>{@code INCIDENT_STATUS_CHANGED} — {@code previousStatus → status}, plus
 *       the reason and the priority score that triggered it.</li>
 *   <li>{@code ALLOCATION_*} — the resource, its type and the travel estimate.</li>
 *   <li>{@code INCIDENT_CREATED} / {@code _REPORTED} — severity, affected people,
 *       time sensitivity.</li>
 * </ul>
 *
 * <p>Returns {@code null} when the payload carries nothing worth showing, so the
 * caller falls back to the event type alone rather than printing empty rows.
 */
function describeEvent(event: PipelineEventView): ReactNode {
  const payload = event.payload;
  if (!payload) return null;

  const str = (key: string): string | undefined => {
    const value = payload[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const num = (key: string): number | undefined => {
    const value = payload[key];
    return typeof value === "number" ? value : undefined;
  };

  switch (event.type) {
    case "INCIDENT_STATUS_CHANGED": {
      const from = str("previousStatus");
      const to = str("status");
      if (!to) return null;
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {from && (
            <>
              <StatusBadge value={from} />
              <span aria-hidden="true" className="text-slate-500">
                →
              </span>
            </>
          )}
          <StatusBadge value={to} />
          {num("priorityScore") !== undefined && (
            <span className="text-[10px] tabular-nums text-slate-500">
              priority {formatNumber(num("priorityScore"))}
            </span>
          )}
        </span>
      );
    }
    case "INCIDENT_CREATED":
    case "INCIDENT_REPORTED": {
      const severity = str("severity");
      const affected = num("affectedPeople");
      const sensitivity = num("timeSensitivityMinutes");
      if (!severity && affected === undefined) return null;
      return (
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
          {severity && <SeverityBadge value={severity} />}
          {affected !== undefined && (
            <span className="tabular-nums">{formatNumber(affected)} affected</span>
          )}
          {sensitivity !== undefined && (
            <span className="tabular-nums">· {formatNumber(sensitivity)} min window</span>
          )}
        </span>
      );
    }
    case "ALLOCATION_CREATED":
    case "ALLOCATION_STATUS_CHANGED": {
      const resourceType = str("resourceType");
      const resourceId = str("resourceId");
      const status = str("status");
      const from = str("previousStatus");
      const travel = num("estimatedTravelTimeMinutes");
      if (!resourceType && !resourceId && !status) return null;
      return (
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
          {resourceType && <span className="font-medium">{humanize(resourceType)}</span>}
          {status && (
            <>
              {from && <StatusBadge value={from} />}
              {from && (
                <span aria-hidden="true" className="text-slate-500">
                  →
                </span>
              )}
              <StatusBadge value={status} />
            </>
          )}
          {travel !== undefined && (
            <span className="tabular-nums">· ETA {formatNumber(travel)} min</span>
          )}
        </span>
      );
    }
    default:
      return null;
  }
}

/**
 * The event-pipeline audit trail for one incident.
 *
 * <p>`GET /pipeline/timeline/{aggregateId}` returns every event recorded against
 * the aggregate, oldest first — report, dispatch, status changes — each with the
 * correlation id of the request that caused it. It was the one part of the
 * pipeline that had no screen, so an operator could see "the incident is
 * IN_PROGRESS" but not *how* it got there or whether the corresponding event
 * actually reached the broker.
 *
 * <p>`aggregateId` is the business `incidentId`, not the numeric key: the pipeline
 * keys its events by the UUID.
 */
function PipelineTimelineCard({ aggregateId }: { aggregateId?: string }) {
  const { data, isLoading, isError, error, refetch } = useGetPipelineTimelineQuery(
    aggregateId ?? "",
    { skip: !aggregateId },
  );

  return (
    <Card>
      <CardHeader
        title="Event timeline"
        description="Every event recorded for this incident, oldest first"
      />
      <CardBody>
        {!aggregateId ? (
          <p className="text-xs text-slate-500">Incident ID unavailable.</p>
        ) : isLoading ? (
          <SkeletonTable rows={3} />
        ) : isError ? (
          <ErrorState
            message={getErrorMessage(error, "Failed to load the event timeline")}
            onRetry={() => refetch()}
          />
        ) : data && data.length > 0 ? (
          <ol className="space-y-2">
            {data.map((event, index) => {
              const detail = describeEvent(event);
              /*
               * A delivery that did not reach the broker is the one failure an
               * operator must be able to see here: the incident moved but
               * downstream systems were not told.
               */
              const undelivered = event.status !== "PUBLISHED";
              return (
                <li
                  key={event.eventId ?? `${index}`}
                  className="rounded-lg border border-border-subtle bg-slate-100/50 px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-800">
                        {humanize(event.type ?? "")}
                      </p>
                      {detail && <div className="mt-1">{detail}</div>}
                    </div>
                    <StatusBadge value={event.status} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {formatDateTime(event.occurredAt)}
                    {undelivered && event.attempts !== undefined && event.attempts > 0 && (
                      <> · {formatNumber(event.attempts)} delivery attempt(s)</>
                    )}
                    {event.exhausted && (
                      <span className="text-amber-300"> · retry budget spent</span>
                    )}
                  </p>
                  {event.lastError && (
                    <p
                      className="mt-1 truncate font-mono text-[10px] text-rose-300"
                      title={event.lastError}
                    >
                      {event.lastError}
                    </p>
                  )}
                  {/*
                    The correlation id is a tracing handle for support, not triage
                    information. It stays available on hover rather than occupying
                    a line on every event, which is what made this list unreadable.
                  */}
                  {event.correlationId && (
                    <p
                      className="mt-1 cursor-help font-mono text-[9px] text-slate-500"
                      title={`Correlation id ${event.correlationId}`}
                    >
                      trace {shortId(event.correlationId)}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-slate-500">
            No events recorded yet. The outbox writes one row per fact.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function AllocationSummaryCard({ incidentId }: { incidentId?: string }) {
  const { data, isLoading, isError, error, refetch } =
    useGetAllocationSummaryByIncidentQuery(incidentId ?? "", { skip: !incidentId });

  return (
    <Card>
      <CardHeader
        title="Allocation summary"
        description="Every deployment recorded against this incident"
      />
      <CardBody>
        {!incidentId ? (
          <p className="text-xs text-slate-500">Incident ID unavailable.</p>
        ) : isLoading ? (
          <SkeletonTable rows={2} />
        ) : isError ? (
          <ErrorState
            message={getErrorMessage(error, "Failed to load allocation summary")}
            onRetry={() => refetch()}
          />
        ) : data && data.length > 0 ? (
          <ul className="space-y-2">
            {data.map((summary, index) => (
              <li
                key={`${summary.id ?? "row"}-${index}`}
                className="rounded-lg border border-border-subtle bg-slate-100/50 px-2.5 py-2"
              >
                {/*
                  Leading with "#1 · 83467f09…" answered the wrong question. What a
                  dispatcher needs is which kind of unit was sent and what it was
                  told to expect; the record number only matters when quoting the
                  allocation, so it moves to the corner.
                */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-800">
                    {humanize(summary.resourceType)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {summary.id !== undefined && (
                      <span
                        className="font-mono text-[10px] text-slate-500"
                        title={`Allocation #${summary.id}`}
                      >
                        #{summary.id}
                      </span>
                    )}
                    <StatusBadge value={summary.status} />
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Travel {formatNumber(summary.estimatedTravelTimeMinutes)} min ·
                  Resolution {formatNumber(summary.estimatedResolutionTimeMinutes)} min
                </p>
                {summary.resourceId && (
                  <p
                    className="mt-1 cursor-help font-mono text-[9px] text-slate-500"
                    title={`Unit id ${summary.resourceId}`}
                  >
                    unit {shortId(summary.resourceId)}
                  </p>
                )}
                {summary.decisionRationale && (
                  <p
                    className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500"
                    title={summary.decisionRationale}
                  >
                    {summary.decisionRationale}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No allocations yet.</p>
        )}
      </CardBody>
    </Card>
  );
}
