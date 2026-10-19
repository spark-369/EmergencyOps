import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import type { ApiErrorBody, TokenResponse } from "@/lib/types";
import {
  getAccessToken,
  getRefreshToken,
  readSession,
  writeSession,
} from "@/lib/auth/session";

/**
 * Root URL of the Spring Boot backend.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so a
 * dev server started before `.env` existed — or one whose env entry was left
 * blank (e.g. `NEXT_PUBLIC_API_BASE_URL=`) — ships an empty string rather than
 * `undefined`. `??` would keep that empty string and every request would fail
 * with "Cannot reach the API", so blank values fall back to the local default.
 */
const DEFAULT_API_BASE_URL = "http://localhost:8080/api/v1";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;

/** Where the JWT session is persisted (see `lib/auth/session.ts`). */
export { SESSION_STORAGE_KEY } from "@/lib/auth/session";

/** Normalised error shape consumed by the UI layer. */
export interface NormalizedApiError {
  status?: number;
  message: string;
  /** Field level validation messages from `GlobalExceptionHandler`. */
  fieldErrors?: Record<string, string>;
  /** True for 401/403 so the shell can react (re-login vs. "not allowed"). */
  isAuthError: boolean;
  /** True only for 401: the session is invalid or expired. */
  isUnauthenticated: boolean;
  /** True only for 403: authenticated but the role is insufficient. */
  isForbidden: boolean;
}

/**
 * Ends the local session and notifies the app.
 *
 * Emits a DOM event instead of calling into React: this module is imported by
 * the Redux slice and the axios layer, and importing the store here would create
 * a cycle (store → api → axios → store). `AuthProvider` subscribes to the event
 * and clears the slice, so there is still exactly one source of truth.
 */
export const SESSION_EXPIRED_EVENT = "erp:session-expired";

export function clearSession(notify = true) {
  writeSession(null);
  if (notify && typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

/** Endpoints that must never trigger a refresh retry (they *are* the refresh). */
const NO_RETRY_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout"];

/**
 * In-flight refresh shared by every 401 that arrives while it runs.
 *
 * Without this, a dashboard firing four requests would start four refreshes;
 * because the backend rotates (and revokes) the refresh token, only the first
 * would succeed and the other three would log the user out.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  // A bare axios instance: using `apiClient` here would re-enter the 401
  // interceptor and loop.
  const response = await axios.post<TokenResponse>(
    `${API_BASE_URL}/auth/refresh`,
    { refreshToken },
    { timeout: 20000, headers: { Accept: "application/json" } },
  );

  const tokens = response.data;
  const current = readSession();
  const user = tokens.user ?? current?.user;
  if (!user) {
    // A refresh response without a user means the stored session was corrupted;
    // treat it as a failed refresh rather than persisting a half-session.
    return false;
  }

  writeSession({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    user,
  });
  return true;
}

/**
 * On a 401: refresh once (shared) and replay the original request.
 *
 * Only one retry is attempted per request; a failed refresh clears the session
 * and the 401 propagates so the UI can redirect to the login screen. A 403 is
 * deliberately *not* handled here — the token is fine, the role is not.
 */
function attachAuthRetry(instance: AxiosInstance) {
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as (InternalAxiosRequestConfig & { _authRetried?: boolean }) | undefined;
      const status = error.response?.status;

      const isRefreshable =
        status === 401 &&
        config !== undefined &&
        !config._authRetried &&
        !NO_RETRY_PATHS.some((path) => config.url?.includes(path));

      if (!isRefreshable) {
        return Promise.reject(error);
      }

      config._authRetried = true;

      refreshInFlight ??= refreshAccessToken().finally(() => {
        refreshInFlight = null;
      });

      let refreshed: boolean;
      try {
        refreshed = await refreshInFlight;
      } catch {
        refreshed = false;
      }

      if (!refreshed) {
        clearSession();
        return Promise.reject(error);
      }

      // The request interceptor attaches the new token on replay.
      return instance.request(config);
    },
  );
}

/**
 * Explains *why* a request produced no HTTP response.
 *
 * axios only sets `response` when the server actually answered, so a missing
 * response covers several unrelated faults that used to be reported as one
 * misleading "backend is not running" message:
 *
 * - `ECONNABORTED` / `ETIMEDOUT` — the server accepted the connection but never
 *   replied before the timeout.
 * - `ERR_NETWORK` — the request never completed: backend down, refused port,
 *   DNS failure, or the browser blocking it (CORS / mixed content).
 *
 * Including the resolved URL and the underlying cause makes the toast
 * actionable instead of sending the developer to check `.env` every time.
 */
function describeNetworkFailure(error: AxiosError): string {
  const target = error.config?.baseURL ?? API_BASE_URL;
  const path = error.config?.url ?? "";
  const url = `${target.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const code = error.code ?? "";
  const cause = error.cause as { message?: string } | undefined;

  if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
    const timeout = error.config?.timeout ?? 0;
    /*
     * Since the event pipeline was introduced, a timeout on a write endpoint has a
     * specific and likely cause that a generic "slow query" hint misses:
     * `EventPublisher` sends with `acks=all` and blocks on `send(...).get()` so that
     * "PUBLISHED" means "durable in Kafka". If the broker is unreachable, that wait
     * runs to the producer's `delivery.timeout.ms` (120 s) — far longer than this
     * client's timeout — so the browser gives up while the backend is still blocked,
     * and the request may yet commit.
     *
     * That distinction matters to the operator: the safest next step is to check
     * whether the change took effect before retrying, not to retry blindly.
     */
    const isWrite = (error.config?.method ?? "get").toLowerCase() !== "get";
    return (
      `The request to ${url} timed out after ${timeout}ms. The backend accepted the ` +
      `connection but did not answer in time. Likely causes, in order: ` +
      `(1) the event broker is unreachable and the write is blocked waiting for the ` +
      `Kafka acknowledgement (acks=all); (2) a slow or locked database query; ` +
      `(3) a saturated request thread pool. ` +
      `Check GET /api/v1/health — "eventDelivery": "DELAYED" or "ATTENTION" means ` +
      `events are queued or failing, which points at the broker; the outbox backlog ` +
      `is at GET /api/v1/pipeline/outbox.` +
      (isWrite
        ? ` This was a write request: it may still have committed after this timeout, ` +
          `so reload before retrying to avoid applying it twice.`
        : "")
    );
  }

  if (code === "ERR_NETWORK") {
    return (
      `No response from ${url}. Either the backend is not running on that address, ` +
      `or the browser blocked the request (CORS or mixed content). Confirm the API ` +
      `answers directly in a browser tab${cause?.message ? ` — detail: ${cause.message}` : ""}.`
    );
  }

  if (code === "ERR_CANCELED") {
    return `The request to ${url} was cancelled before a response arrived.`;
  }

  return (
    `The request to ${url} failed before a response was received` +
    `${code ? ` (${code})` : ""}. Verify the backend is running and ` +
    `NEXT_PUBLIC_API_BASE_URL points at it.`
  );
}

/** Turns any thrown value into a predictable object for the UI. */
export function normalizeApiError(error: unknown): NormalizedApiError {
  const axiosError = error as AxiosError<ApiErrorBody>;
  if (axiosError?.isAxiosError) {
    const status = axiosError.response?.status;
    const body = axiosError.response?.data;
    const fieldErrors =
      body?.errors && Object.keys(body.errors).length > 0
        ? body.errors
        : undefined;

    let message =
      body?.message ||
      body?.error ||
      axiosError.message ||
      "Unexpected request failure";

    if (!axiosError.response) {
      message = describeNetworkFailure(axiosError);
    } else if (status === 401) {
      message =
        "Your session has expired or is invalid. Sign in again to continue.";
    } else if (status === 403) {
      // Distinct from 401 on purpose: the user is signed in, the role is
      // insufficient. The UI must not log them out for this.
      message =
        body?.message ??
        "Your role does not permit this action. Ask an administrator for access.";
    } else if (status === 429) {
      message = "Rate limit exceeded. Please retry in a minute.";
    } else if (status === 404) {
      message = body?.message ?? "Record not found.";
    }

    const isUnauthenticated = status === 401;
    const isForbidden = status === 403;

    return {
      status,
      message,
      fieldErrors,
      isAuthError: isUnauthenticated || isForbidden,
      isUnauthenticated,
      isForbidden,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      isAuthError: false,
      isUnauthenticated: false,
      isForbidden: false,
    };
  }
  return {
    message: "Unexpected request failure",
    isAuthError: false,
    isUnauthenticated: false,
    isForbidden: false,
  };
}

/**
 * Adds the project-wide {@code Authorization: Bearer <jwt>} header.
 *
 * The token is read from the persisted session on every request, so a refresh
 * that happens mid-session is picked up by subsequent calls without extra wiring.
 * Applied to both instances; the server-side one simply finds no session.
 */
function attachInterceptors(instance: AxiosInstance) {
  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
    }
    config.headers.set("Accept", "application/json");
    return config;
  });
}

/** Browser instance: talks to the Spring Boot API directly (same-origin CORS). */
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  paramsSerializer: { indexes: null },
});

/**
 * Server-side instance for Server Components / Route Handlers. Uses the
 * internal docker/host URL when configured.
 */
export const serverApiClient: AxiosInstance = axios.create({
  baseURL: process.env.BACKEND_URL?.trim()
    ? `${process.env.BACKEND_URL.trim()}/api/v1`
    : API_BASE_URL,
  timeout: 20000,
  paramsSerializer: { indexes: null },
});

attachInterceptors(apiClient);
attachInterceptors(serverApiClient);

// Refresh-and-retry only makes sense in the browser: the server-side instance
// has no session to refresh and must not mutate client storage.
attachAuthRetry(apiClient);

export type RequestConfig = Omit<AxiosRequestConfig, "url" | "method">;
