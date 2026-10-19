"use client";

import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { dismissToast, type Toast } from "@/lib/store/ui-slice";
import { MethodChip } from "@/components/ui/badge";

const ICONS: Record<Toast["variant"], string> = {
  success: "text-emerald-400",
  error: "text-rose-400",
  info: "text-sky-400",
  warning: "text-amber-400",
};

const EDGES: Record<Toast["variant"], string> = {
  success: "border-l-emerald-400/70",
  error: "border-l-rose-400/70",
  info: "border-l-sky-400/70",
  warning: "border-l-amber-400/70",
};

function ToastItem({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Failures stay long enough to read and copy; a caveat deserves a little more
    // time than a plain confirmation.
    const ttl =
      toast.variant === "error" ? 9000 : toast.variant === "warning" ? 7000 : 4500;
    const timer = window.setTimeout(() => dispatch(dismissToast(toast.id)), ttl);
    return () => window.clearTimeout(timer);
  }, [dispatch, toast.id, toast.variant]);

  return (
    <div
      className={`animate-toast-in pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border border-border-strong border-l-2 bg-surface-raised p-3 shadow-[0_24px_48px_-20px_rgba(0,0,0,0.95)] ${EDGES[toast.variant]}`}
    >
      <svg
        viewBox="0 0 24 24"
        className={`mt-0.5 h-4.5 w-4.5 shrink-0 ${ICONS[toast.variant]}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        {toast.variant === "success" ? (
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        ) : toast.variant === "error" ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
          </>
        ) : toast.variant === "warning" ? (
          <>
            {/* Succeeded, but something downstream is degraded — a tick would
                overstate it, a cross would understate it. */}
            <path d="M12 4l9 16H3z" strokeLinejoin="round" />
            <path d="M12 10v4M12 17v.01" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 7.5v.01" strokeLinecap="round" />
          </>
        )}
      </svg>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {toast.method && <MethodChip method={toast.method} />}
          <p className="truncate text-xs font-semibold text-slate-950">
            {toast.title}
          </p>
        </div>
        {toast.description && (
          <p className="mt-0.5 line-clamp-3 text-[11px] break-words text-slate-500">
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dispatch(dismissToast(toast.id))}
        className="rounded p-0.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-800"
        aria-label="Dismiss notification"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function ToastViewport() {
  const toasts = useAppSelector((state) => state.ui.toasts);
  const dispatch = useAppDispatch();

  return (
    /*
     * A single polite live region owns every toast. `role="status"` on each
     * item made screen readers interleave announcements; one region keeps the
     * order predictable. `aria-atomic="false"` lets only the new node be read.
     *
     * Width is `min(20rem, 100vw-2rem)` so a 320px phone does not lose the
     * dismiss button off the right edge.
     */
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed right-3 bottom-3 z-[60] flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-4 sm:bottom-4"
    >
      {toasts.length > 1 && (
        <button
          type="button"
          onClick={() => toasts.forEach((t) => dispatch(dismissToast(t.id)))}
          className="no-print pointer-events-auto self-end rounded-md border border-border-subtle bg-surface px-2 py-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase transition-colors hover:text-slate-900"
        >
          Dismiss all ({toasts.length})
        </button>
      )}
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
