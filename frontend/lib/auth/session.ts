import type { AuthUser, Role } from "@/lib/types";

/**
 * Client-side session storage for the JWT pair.
 *
 * Tokens live in `localStorage` so a page reload keeps the session. That choice
 * is deliberate and has a known trade-off: `localStorage` is readable by any
 * script running on the origin, so a successful XSS can exfiltrate them. The
 * alternative (httpOnly cookies) removes that risk but requires CSRF protection
 * and server-side cookie handling; for this console the API is a separate origin
 * authenticated by header, so the header approach is used and the mitigations
 * are: short access-token TTL, rotated refresh tokens, and no third-party scripts.
 */
export const SESSION_STORAGE_KEY = "erp.session";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token dies; required, see `readSession`. */
  expiresAt: number;
  user: AuthUser;
}

export function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user) return null;

    /*
     * A session with no expiry information at all is not trustworthy: treat it
     * as signed out. `expiresAt` is written on every sign-in and refresh, so a
     * `0` means the record was hand-edited, truncated, or written by a build
     * that predates the field.
     */
    const expiresAt = parsed.expiresAt ?? 0;
    if (expiresAt <= 0) return null;

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt,
      user: parsed.user,
    };
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession | null) {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

/** Access token for the request interceptor, or `null` when signed out. */
export function getAccessToken(): string | null {
  return readSession()?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return readSession()?.refreshToken ?? null;
}

/** The sign-in screen; also the base for `?next=` deep links. */
export const LOGIN_PATH = "/login";

/**
 * True for a path that is safe to redirect to after signing in.
 *
 * Absolute URLs (`https://evil.example`), protocol-relative URLs
 * (`//evil.example`) and backslash variants (`/\evil.example`) are all rejected.
 * `next` arrives from the URL, so following it blindly would be an open
 * redirect. Only same-origin absolute paths survive.
 */
export function isSafeNextPath(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  return !value.startsWith("/\\");
}

/** Milliseconds of head-room before expiry at which a refresh is triggered. */
const EXPIRY_SKEW_MS = 15_000;

export function isAccessTokenExpiring(session: StoredSession | null = readSession()): boolean {
  if (!session) return false;
  return session.expiresAt - EXPIRY_SKEW_MS <= Date.now();
}

/**
 * Role helpers used by navigation and `<Can>` guards.
 *
 * These only decide what to *render*. Every one of these checks is enforced
 * again by `@PreAuthorize` on the server; hiding a button is a UX affordance,
 * never a security boundary.
 */
export function hasRole(user: AuthUser | null | undefined, ...roles: readonly Role[]): boolean {
  if (!user) return false;
  return roles.some((role) => user.roles.includes(role));
}

export function isAdmin(user: AuthUser | null | undefined): boolean {
  return hasRole(user, "ADMIN");
}

/** True for roles that may mutate operational data. */
export function canOperate(user: AuthUser | null | undefined): boolean {
  return hasRole(user, "ADMIN", "DISPATCHER", "FIELD_OPERATOR");
}

/** True when the user may create/delete records (not merely progress them). */
export function canManageInventory(user: AuthUser | null | undefined): boolean {
  return hasRole(user, "ADMIN", "DISPATCHER");
}