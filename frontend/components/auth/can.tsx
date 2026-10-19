"use client";

import type { ReactNode } from "react";
import type { Role } from "@/lib/types";
import { useAppSelector } from "@/lib/store/hooks";
import { hasRole } from "@/lib/auth/session";

/**
 * Renders `children` only when the signed-in user holds one of `roles`.
 *
 * <p><strong>Presentation only.</strong> Hiding a control is a courtesy that
 * prevents a confusing 403, not a security measure: the matching endpoint is
 * guarded by `@PreAuthorize` on the server. Never rely on this alone — a user can
 * always craft the request by hand.
 *
 * <p>The role list mirrors the server rule for the action it wraps. Keep the two
 * in step: a mismatch here either hides a permitted action or offers one that
 * will fail.
 *
 * @example
 * <Can roles={["ADMIN", "DISPATCHER"]}>
 *   <Button onClick={create}>Register hospital</Button>
 * </Can>
 */
export function Can({
  roles,
  children,
  fallback = null,
}: {
  /**
   * Accepted as `readonly Role[]` so an inline literal (`roles={["ADMIN"]}`) keeps
   * its narrow element type instead of widening to `string[]`.
   */
  roles: readonly Role[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const user = useAppSelector((state) => state.auth.user);
  return hasRole(user, ...roles) ? <>{children}</> : <>{fallback}</>;
}