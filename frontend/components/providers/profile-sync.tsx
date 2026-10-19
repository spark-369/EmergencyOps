"use client";

import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { updateUser } from "@/lib/store/ui-slice";
import { useMeQuery } from "@/lib/store/api";

/**
 * Re-reads the signed-in user's profile and keeps the auth slice in sync.
 *
 * <p>A role change made by an administrator revokes the refresh token, but the
 * current access token stays valid until it expires; re-reading `/auth/me` keeps
 * the rendered menus honest in the meantime.
 *
 * <p><strong>Must be rendered inside {@link ClientOnly}.</strong> RTK Query's
 * `useQuery` seeds its subscription with `dataUpdatedAt: Date.now()` on the first
 * render — even when `skip` is true — and Next.js rejects that clock read while
 * prerendering ("encountered the unstable value `Date.now()` in a Client
 * Component"). Because hooks cannot be called conditionally, the only fix is to
 * keep the hook in a component that never renders on the server.
 */
export function ProfileSync() {
  const dispatch = useAppDispatch();
  const { user, initialized } = useAppSelector((state) => state.auth);

  const { data: profile } = useMeQuery(undefined, { skip: !initialized || !user });

  useEffect(() => {
    if (profile) dispatch(updateUser(profile));
  }, [profile, dispatch]);

  return null;
}