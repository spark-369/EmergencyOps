import type {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
} from "@reduxjs/toolkit/query";
import type { AxiosRequestConfig, RawAxiosRequestHeaders } from "axios";
import { apiClient, normalizeApiError } from "@/lib/axios";

/**
 * Arguments accepted by `axiosBaseQuery`.
 *
 * Declared as an intersection rather than `extends FetchArgs` because the extra
 * axios keys (`method`, `data`) must stay narrow while `FetchArgs` already
 * declares `body`/`params` as `any` — an interface that extends it and
 * re-declares those members would be an incompatible override.
 */
export type AxiosQueryArgs = FetchArgs & {
  url: string;
  method?: AxiosRequestConfig["method"];
  /** Request payload for POST/PATCH/PUT. Alias of axios' `data`. */
  data?: unknown;
};

/**
 * Converts RTK Query's `headers` value into the plain record axios expects.
 *
 * The parameter type is derived from `FetchArgs` rather than `HeadersInit`:
 * RTK Query declares `string[][]` (which permits rows of any length), whereas
 * `HeadersInit` requires fixed `[string, string][]` tuples. Referencing the
 * source type directly keeps both sides in sync — and would fail to compile if
 * RTK Query's definition ever changed.
 *
 * The two sides are not assignable to each other (`Headers` has ~23 members
 * axios' type does not, and axios requires `string | number | boolean | null`
 * values), so the conversion is explicit. This is a real normalisation — not a
 * cast — so `Headers` instances and tuple arrays are actually handled.
 */
function toAxiosHeaders(
  headers: FetchArgs["headers"],
): RawAxiosRequestHeaders | undefined {
  if (!headers) return undefined;

  // `Headers` instance (also covers the undici/browser implementation).
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries()) as RawAxiosRequestHeaders;
  }

  // Tuple form: [["Accept", "application/json"], …]
  if (Array.isArray(headers)) {
    // Rows are `string[]` (RTK Query's type), so coerce each to a 2-tuple —
    // `Object.fromEntries` requires fixed-length pairs.
    const entries: [string, string][] = headers.map((row) => [
      String(row[0]),
      String(row[1] ?? ""),
    ]);
    return Object.fromEntries(entries) as RawAxiosRequestHeaders;
  }

  // Record form — drop `undefined` values, which axios rejects.
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined),
  ) as RawAxiosRequestHeaders;
}

/**
 * Builds a member of the `FetchBaseQueryError` union.
 *
 * The union is discriminated on `status`, and only the *string* statuses
 * (`FETCH_ERROR`, `TIMEOUT_ERROR`, `PARSING_ERROR`, `CUSTOM_ERROR`) may carry an
 * `error: string`. A numeric status must use the `{ status: number; data }`
 * shape instead — constructing one object with both a numeric status and an
 * `error` string is exactly the mismatch that previously required a cast.
 */
function toBaseQueryError(
  status: number | undefined,
  message: string,
  payload: unknown,
): FetchBaseQueryError {
  if (status === undefined) {
    // No HTTP response (network failure, DNS, CORS, timeout): string status
    // member, where `error` is allowed.
    return { status: "FETCH_ERROR", error: message };
  }
  return { status, data: payload };
}

/**
 * RTK Query base query backed by our shared axios instance, so every request
 * inherits the auth interceptor, timeouts and the Spring `Pageable` query
 * serialisation configured in `lib/axios.ts`.
 */
export const axiosBaseQuery =
  (): BaseQueryFn<AxiosQueryArgs, unknown, FetchBaseQueryError> =>
  async ({ url, method = "GET", params, data, body, headers }) => {
    try {
      const result = await apiClient.request({
        url,
        method,
        params,
        // Accept either `data` (axios style) or `body` (FetchArgs style).
        data: data ?? body,
        headers: toAxiosHeaders(headers),
      });
      return { data: result.data };
    } catch (error) {
      const normalized = normalizeApiError(error);
      return {
        error: toBaseQueryError(normalized.status, normalized.message, normalized),
      };
    }
  };
