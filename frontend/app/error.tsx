"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary.
 *
 * Deliberately does not print `error.message`: a thrown value can carry internal
 * detail (SQL, file paths). The digest below is what pairs this screen with the
 * server log entry. Authentication and authorisation failures are handled in the
 * providers/interceptors, not here, so this only shows genuine render faults.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Kept as a console error so the digest is visible in the browser during
    // development; a production build would forward this to telemetry.
    console.error("Route error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-rose-400/25 bg-rose-500/10 p-5 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-rose-400/30 bg-rose-500/15">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 text-rose-300"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
          </svg>
        </div>

        <h1 className="mt-3 text-base font-semibold text-rose-100">
          Something went wrong
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-rose-200/80">
          This screen failed to render. Retrying usually clears a transient data
          problem; if it persists, give the reference below to an administrator.
        </p>

        {error.digest && (
          <p className="mt-3 rounded-md border border-rose-400/20 bg-black/30 px-2 py-1 font-mono text-[11px] text-rose-200/70">
            ref {error.digest}
          </p>
        )}

        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => reset()}>
            Try again
          </Button>
          <Button variant="primary" onClick={() => window.location.assign("/")}>
            Back to command center
          </Button>
        </div>
      </div>
    </div>
  );
}