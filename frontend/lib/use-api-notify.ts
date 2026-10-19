"use client";

import { useCallback } from "react";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { useAppDispatch } from "@/lib/store/hooks";
import { pushToast } from "@/lib/store/ui-slice";
import { normalizeApiError } from "@/lib/axios";

export interface NotifyOptions {
  /** HTTP verb exercised, surfaced as a chip inside the toast. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  successTitle: string;
  successDescription?: string;
  /**
   * Appended to the success toast when the write succeeded but the event pipeline
   * is degraded, e.g. "Recorded — event queued, the broker is unreachable".
   *
   * Kept separate from `successDescription` so a caller can decide at call time
   * whether the pipeline is healthy, without having to turn a committed write into
   * an error toast.
   */
  successNote?: string;
}

/**
 * Error bodies the backend produces, as far as this module cares.
 *
 * Every field is optional because `FetchBaseQueryError` exposes the parsed body
 * as `unknown`; nothing here may assume a shape that the server did not send.
 */
interface BackendErrorBody {
  message?: unknown;
  error?: unknown;
  /** Validation failures: field → message. */
  errors?: unknown;
  /** 409 from `InvalidStateTransitionException`. */
  from?: unknown;
  to?: unknown;
  hint?: unknown;
  aggregate?: unknown;
}

/**
 * Extracts a human-readable message from an RTK Query error, preferring the
 * backend's `GlobalExceptionHandler` payload (`message`) when present.
 *
 * `FetchBaseQueryError` is a discriminated union: only the string-status members
 * (`FETCH_ERROR`, `TIMEOUT_ERROR`, `PARSING_ERROR`, `CUSTOM_ERROR`) carry an
 * `error: string`. The parameter is `unknown` because hooks expose the wrapper
 * loosely, so `status` is inspected directly rather than casting back into the
 * union.
 */
export function getErrorMessage(error: unknown, fallback = "Request failed"): string {
  if (!error) return fallback;

  // Plain string / Error thrown outside of RTK Query.
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error !== "object") return fallback;

  const candidate = error as {
    status?: unknown;
    error?: unknown;
    data?: unknown;
    originalStatus?: unknown;
  };

  // String-status members carry the message in `error`.
  if (typeof candidate.status === "string" && typeof candidate.error === "string") {
    if (candidate.error) return candidate.error;
  }

  // Numeric-status members carry the Spring error body in `data`.
  const data = candidate.data;
  if (typeof data === "string" && data) return data;

  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.originalStatus === "number"
        ? candidate.originalStatus
        : undefined;

  if (data && typeof data === "object") {
    const payload = data as BackendErrorBody;

    /*
     * A lifecycle violation (409) is richer than its `message`: the handler also
     * sends `from`, `to` and a `hint` listing the statuses that *are* allowed.
     * Dropping the hint would leave the operator with "Incident x cannot move from
     * COMPLETED to ALLOCATING" and no idea what to do next, so the legal targets
     * are appended when present.
     */
    if (typeof payload.message === "string" && payload.message) {
      const hint = typeof payload.hint === "string" && payload.hint ? payload.hint : "";
      return hint && !payload.message.includes(hint)
        ? `${payload.message} (${hint})`
        : payload.message;
    }

    /*
     * Bean-validation failures arrive as `errors: { field: message }` with no
     * top-level `message`. Reporting only "Validation Failed" hides which field is
     * wrong, so the first few are listed.
     */
    if (payload.errors && typeof payload.errors === "object") {
      const entries = Object.entries(payload.errors as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string");
      if (entries.length > 0) {
        const shown = entries.slice(0, 3).map(([field, message]) => `${field}: ${message}`);
        const remainder = entries.length - shown.length;
        return `Validation failed — ${shown.join("; ")}${remainder > 0 ? ` (+${remainder} more)` : ""}`;
      }
    }

    if (typeof payload.error === "string" && payload.error) {
      return payload.error;
    }
  }

  /*
   * A bare status with no body is common for 404/409/500 when a proxy or the
   * Servlet container answers instead of the application; naming the status beats
   * returning a generic fallback.
   */
  if (status !== undefined) return `${fallback} (HTTP ${status})`;

  return fallback;
}

/** Narrowing guard for the error wrapper RTK Query hands back. */
function isRejectedWithValue(error: unknown): error is FetchBaseQueryError {
  return typeof error === "object" && error !== null && "status" in error;
}

/**
 * Title for a failed mutation.
 *
 * A `409` is not a malfunction: the request was valid, the aggregate's state
 * conflicts (a lifecycle violation, or a duplicate dispatch). Labelling it
 * "PATCH failed" reads like an outage, so it gets its own wording. The same holds
 * for `403` — the caller is authenticated but lacks the role, which is a
 * permission answer rather than an error.
 */
function failureTitle(method: NotifyOptions["method"], error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (status === 409) return "Rejected by the lifecycle";
  if (status === 403) return "Not permitted";
  if (status === 404) return "Not found";
  if (status === 422 || status === 400) return "Invalid request";
  if (status === 429) return "Too many requests";
  if (typeof status === "string") return "Backend unreachable";
  return `${method} failed`;
}

export function useApiNotify() {
  const dispatch = useAppDispatch();

  const notifySuccess = useCallback(
    ({ method, successTitle, successDescription, successNote }: NotifyOptions) => {
      // The note is appended rather than replacing the description: both are
      // useful, and the operator should see "what happened" before "and here is
      // the caveat".
      const description = [successDescription, successNote]
        .filter((part): part is string => Boolean(part))
        .join(" ");
      dispatch(
        pushToast({
          // A caveat demotes the confirmation to a warning: the write is durable,
          // but the operator should not read a bare tick when downstream delivery
          // is in doubt.
          variant: successNote ? "warning" : "success",
          method,
          title: successTitle,
          description: description || undefined,
        }),
      );
    },
    [dispatch],
  );

  const notifyError = useCallback(
    (error: unknown, method: NotifyOptions["method"], title = "Request failed") => {
      // RTK Query rejects with its own FetchBaseQueryError wrapper; axios errors
      // reach `normalizeApiError` untouched.
      const message = isRejectedWithValue(error)
        ? getErrorMessage(error)
        : normalizeApiError(error).message;

      dispatch(
        pushToast({ variant: "error", method, title, description: message }),
      );
    },
    [dispatch],
  );

  return { notifySuccess, notifyError };
}

/**
 * Structural shape of an RTK Query mutation trigger.
 *
 * A trigger is a *callable* that returns `{ unwrap }` — it does **not** expose
 * `unwrap` itself, so the helper must call first and unwrap on the result.
 * Generated triggers are also generic functions, so `A` is inferred per call.
 */
export type MutationTrigger<A, R = unknown> = (arg: A) => {
  unwrap: () => Promise<R>;
};

/**
 * Convenience wrapper: run an RTK Query trigger and emit a success/error toast
 * in one place. Returns `{ ok, data, message }` so callers can close dialogs.
 *
 * <p><strong>Success means the server answered.</strong> `unwrap()` rejects for
 * every non-2xx response and for transport failures, so `ok: true` already
 * corresponds to a committed write (or a completed read) — including a `204`,
 * whose resolved value is `null`.
 *
 * <p><strong>What this cannot know</strong> is whether the *event* left the
 * building. Since the pipeline was introduced a write commits first and publishes
 * afterwards, so a `200` means "recorded", not necessarily "downstream notified".
 * A caller that cares passes {@link NotifyOptions.successNote}, typically the
 * result of `GET /health` or `GET /pipeline/outbox`; that note is attached to the
 * success toast instead of turning it into a failure, because the operation did
 * happen.
 *
 * For endpoints whose argument type is `void` (e.g. `reoptimizeAll`), pass
 * `undefined` as the second argument — `A` is inferred as `void`.
 *
 * Both `A` and the response type are inferred from the trigger, so `result.data`
 * is fully typed at the call site instead of being `unknown`.
 *
 * @example
 * const [updateStatus] = useUpdateResourceStatusMutation();
 * const run = useMutationToast();
 * const result = await run(updateStatus, { id, status }, {
 *   method: "PATCH",
 *   successTitle: "Resource status updated",
 * });
 * if (result.ok) closeDialog();
 *
 * @example
 * const outcome = await run(reoptimizeAll, undefined, {
 *   method: "POST",
 *   successTitle: "Re-optimised",
 * });
 * if (outcome.ok && outcome.data) setResult(outcome.data); // ReoptimizeResult
 */
export function useMutationToast() {
  const { notifySuccess, notifyError } = useApiNotify();

  return useCallback(
    async <A, R>(
      trigger: MutationTrigger<A, R>,
      arg: A,
      options: NotifyOptions,
    ): Promise<{ ok: boolean; data?: R; message?: string }> => {
      try {
        const data = await trigger(arg).unwrap();
        notifySuccess(options);
        return { ok: true, data };
      } catch (error) {
        const message = isRejectedWithValue(error)
          ? getErrorMessage(error)
          : normalizeApiError(error).message;
        notifyError(error, options.method, failureTitle(options.method, error));
        return { ok: false, message };
      }
    },
    [notifyError, notifySuccess],
  );
}
