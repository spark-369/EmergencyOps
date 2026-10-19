import { LinkButton } from "@/components/ui/button";

/**
 * Themed 404.
 *
 * Without this file Next.js renders its built-in page, which is light-themed and
 * visually breaks out of this console entirely.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <p className="font-mono text-[11px] tracking-[0.18em] text-teal-300 uppercase">
          404 · Not found
        </p>
        <h1 className="mt-2 text-lg font-semibold text-slate-950">
          That screen does not exist
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          The address may be mistyped, or the page may have been removed. The
          command center is the best place to start again.
        </p>
        <div className="mt-4 flex justify-center">
          <LinkButton href="/" variant="primary">
            Back to command center
          </LinkButton>
        </div>
      </div>
    </div>
  );
}