"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { signOut } from "@/lib/store/ui-slice";
import { useLogoutMutation } from "@/lib/store/api";
import { getRefreshToken } from "@/lib/auth/session";
import { humanize } from "@/lib/format";
import { ROLE_HINTS } from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { PasswordDialog } from "@/components/layout/password-dialog";

/**
 * Identity menu replacing the old credentials dialog.
 *
 * Signing out revokes the refresh token server-side first, then clears local
 * state. The revocation is best-effort: if the network call fails the local
 * session is still destroyed, otherwise the user would appear stuck signed in.
 */
export function UserMenu() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const user = useAppSelector((state) => state.auth.user);
  const [logout] = useLogoutMutation();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const handleSignOut = async () => {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) {
        await logout({ refreshToken }).unwrap();
      }
    } catch {
      // Revocation is best-effort; the session is cleared below regardless.
    }
    dispatch(signOut());
    router.replace("/login");
  };

  const initials = (user.displayName || user.username)
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface py-1 pr-2 pl-1 text-xs font-medium text-slate-700 transition-colors hover:border-border-strong hover:text-slate-950"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-400/15 text-[10px] font-bold text-teal-300 ring-1 ring-teal-400/30 ring-inset">
          {initials}
        </span>
        <span className="hidden max-w-[120px] truncate sm:block">{user.displayName}</span>
        <svg
          viewBox="0 0 24 24"
          className={`h-3 w-3 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-border-strong bg-surface-overlay shadow-[0_30px_60px_-30px_rgba(0,0,0,0.95)]"
        >
          <div className="border-b border-border-subtle px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-slate-950">
              {user.displayName}
            </p>
            <p className="truncate text-[11px] text-slate-500">@{user.username}</p>
            <div className="mt-1.5">
              <Badge
                label={humanize(user.role)}
                // ADMIN is toned apart from the operational roles: it is the only
                // one that can change accounts, and the menu is where an operator
                // confirms which identity they are acting as.
                tone={user.role === "ADMIN" ? "violet" : "info"}
                dot
                title={ROLE_HINTS[user.role]}
              />
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setPasswordOpen(true);
            }}
            className="flex w-full items-center gap-2 border-b border-border-subtle px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-white/5 hover:text-slate-950"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 7a4 4 0 11-3.2 6.4L7 18H4v-3l4.6-4.8A4 4 0 0115 7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Change password
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 12H4m0 0l3-3m-3 3l3 3M10 4h7a2 2 0 012 2v12a2 2 0 01-2 2h-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign out
          </button>
        </div>
      )}

      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}