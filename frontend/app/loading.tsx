import { Skeleton, SkeletonStats, SkeletonTable } from "@/components/ui/layout";

/**
 * Route-level loading UI.
 *
 * Shown while a segment's code/data resolves. It mirrors the standard page
 * layout (header, stat row, table card) so the transition into real content does
 * not shift anything.
 *
 * Each data-heavy segment re-exports this file so Next.js can stream the
 * skeleton as soon as navigation starts, instead of keeping the previous screen
 * until the page module has loaded. Without a per-segment boundary only the root
 * of the tree had one, which is why `/incidents` used to sit motionless for the
 * first few hundred milliseconds.
 */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="border-b border-border-subtle pb-4">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="mt-2 h-6 w-64" />
        <Skeleton className="mt-2 h-3 w-full max-w-xl" />
      </div>

      <SkeletonStats />

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
        <div className="border-b border-border-subtle px-4 py-3">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="mt-2 h-2.5 w-64" />
        </div>
        <SkeletonTable />
      </div>
    </div>
  );
}