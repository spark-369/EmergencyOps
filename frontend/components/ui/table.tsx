import type { ReactNode } from "react";
import { EmptyState, SkeletonTable } from "@/components/ui/layout";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Tailwind alignment / width helper, e.g. "text-right w-32". */
  className?: string;
  headerClassName?: string;
  /** Hide below a breakpoint to keep the table readable on small screens. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
}

/* ------------------------------------------------------------------ Table */

const HIDE: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyTitle = "No records",
  emptyDescription,
  emptyAction,
  footer,
  dense = false,
  /** Pin the header while the body scrolls; useful on long registries. */
  stickyHeader = false,
  /** Vertical scroll cap (e.g. "max-h-[60vh]"), pairs with stickyHeader. */
  maxHeight,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  footer?: ReactNode;
  dense?: boolean;
  stickyHeader?: boolean;
  maxHeight?: string;
}) {
  // A shaped placeholder rather than a bare spinner: the table keeps its height
  // instead of collapsing and re-expanding when data lands.
  if (loading) return <SkeletonTable />;

  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <div className={`scroll-thin scroll-x ${maxHeight ?? ""}`}>
      <table className="min-w-full divide-y divide-border-subtle text-sm">
        <thead className={stickyHeader ? "bg-surface-muted" : "bg-slate-100/70"}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`${
                  stickyHeader ? "sticky top-0 z-[1] bg-surface-muted " : ""
                }px-3 py-2 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase ${
                  column.hideBelow ? HIDE[column.hideBelow] : ""
                } ${column.headerClassName ?? ""}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className="transition-colors hover:bg-white/[0.035]"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`${dense ? "px-3 py-1.5" : "px-3 py-2.5"} align-middle tabular-nums text-slate-700 ${
                    column.hideBelow ? HIDE[column.hideBelow] : ""
                  } ${column.className ?? ""}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle bg-slate-100/40 px-3 py-2 text-xs text-slate-500">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Monospaced identifier cell with graceful truncation + title tooltip. */
export function Mono({ children }: { children?: ReactNode }) {
  return (
    <span
      className="block max-w-[190px] truncate font-mono text-xs text-slate-700"
      title={typeof children === "string" ? children : undefined}
    >
      {children ?? "—"}
    </span>
  );
}

export function KeyValue({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {label}
      </dt>
      <dd className="text-sm text-slate-800">{value}</dd>
    </div>
  );
}
