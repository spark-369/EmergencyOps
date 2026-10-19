"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Column } from "@/components/ui/table";
import { SkeletonTable } from "@/components/ui/layout";
import type { RegistryFilter, SortState } from "@/lib/use-registry";

/**
 * Registry building blocks.
 *
 * One `Column<T>[]` definition drives two presentations: a dense table from
 * `md` up, and a stacked card list below it. That is the single biggest
 * usability win for this console — the previous tables were horizontally
 * scrollable on a phone, so an operator in the field had to drag sideways to
 * reach the status column. Cards keep the identifying field and the primary
 * metric always visible and collapse the rest into a label/value list.
 */

const HIDE_BELOW: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

/* ---------------------------------------------------------------- Search */

export function RegistrySearch({
  value,
  onChange,
  placeholder = "Search…",
  autoFocusKey = "/",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Single key that focuses the field when no input is focused. `null` disables. */
  autoFocusKey?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" is the convention operators expect from log and search tools. Ignored
  // while typing in another field so it never swallows a literal slash.
  useEffect(() => {
    if (!autoFocusKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // React 19 replays DOM events into React listeners; a replay has no `key`.
      if (typeof event.key !== "string" || event.key !== autoFocusKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [autoFocusKey]);

  return (
    <div className="relative w-full sm:w-64">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-lg border border-slate-300 bg-slate-100 pr-2 pl-8 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-500 hover:border-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 [&::-webkit-search-cancel-button]:appearance-none"
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Filters */

export function RegistryFilterSelect({
  filter,
  value,
  onChange,
}: {
  filter: RegistryFilter;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={filter.label}
      className={`h-9 rounded-lg border bg-slate-100 px-2.5 pr-8 text-sm outline-none transition-colors focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 ${
        value === ""
          ? "border-slate-300 text-slate-600"
          : "border-teal-400/50 font-medium text-slate-950"
      }`}
    >
      <option value="">{filter.label}</option>
      {filter.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/* --------------------------------------------------------------- Toolbar */

export function RegistryToolbar({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-slate-100/60 px-4 py-3">
      {children}
      {trailing && <div className="ml-auto flex flex-wrap items-center gap-2">{trailing}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ Sort header */

export function RegistrySortButton({
  label,
  columnKey,
  sort,
  onToggle,
  className = "",
}: {
  label: string;
  columnKey: string;
  sort: SortState;
  onToggle: (key: string) => void;
  className?: string;
}) {
  const active = sort.key === columnKey;
  return (
    <button
      type="button"
      onClick={() => onToggle(columnKey)}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-slate-950 ${
        active ? "text-teal-300" : ""
      } ${className}`}
    >
      {label}
      <span
        aria-hidden="true"
        className={`text-[9px] ${active ? "opacity-100" : "opacity-35"}`}
      >
        {active && sort.direction === "desc" ? "▼" : "▲"}
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------- Empty */

export function RegistryEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border-subtle bg-slate-100 text-slate-500">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description && (
        <p className="max-w-sm text-xs leading-relaxed text-slate-500">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Table */

export function RegistryTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  sort,
  onToggleSort,
  sortableKeys,
  onOpenRow,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Enables sortable headers when provided together with `onToggleSort`. */
  sort?: SortState;
  onToggleSort?: (key: string) => void;
  /** Only these column keys render a sort control; omit to allow all. */
  sortableKeys?: string[];
  /** Adds an "Open" affordance to each mobile card. */
  onOpenRow?: (row: T) => void;
}) {
  if (loading) return <SkeletonTable rows={6} />;

  if (rows.length === 0) {
    return (
      <RegistryEmpty title={emptyTitle} description={emptyDescription} action={emptyAction} />
    );
  }

  const leadColumn = columns[0];

  return (
    <>
      {/* Tablet and up: dense table. */}
      <div className="scroll-thin hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-border-subtle text-sm">
          <thead className="bg-slate-100/70">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-3 py-2 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase ${
                    column.hideBelow ? HIDE_BELOW[column.hideBelow] : ""
                  } ${column.headerClassName ?? ""}`}
                >
                  {sort &&
                  onToggleSort &&
                  column.header &&
                  (!sortableKeys || sortableKeys.includes(column.key)) ? (
                    <RegistrySortButton
                      label={String(column.header)}
                      columnKey={column.key}
                      sort={sort}
                      onToggle={onToggleSort}
                    />
                  ) : (
                    column.header
                  )}
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
                    className={`px-3 py-2.5 align-middle tabular-nums text-slate-700 ${
                      column.hideBelow ? HIDE_BELOW[column.hideBelow] : ""
                    } ${column.className ?? ""}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        Phone: one card per record. Hidden columns reappear here on purpose —
        `hideBelow` exists to save horizontal space, which cards solve.
      */}
      <ul className="divide-y divide-border-subtle md:hidden">
        {rows.map((row, index) => (
          <li key={rowKey(row, index)} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">{leadColumn?.render(row)}</div>
              {onOpenRow && (
                <button
                  type="button"
                  onClick={() => onOpenRow(row)}
                  className="focus-ring shrink-0 rounded-md border border-border-subtle px-2 py-1 text-[11px] font-medium text-slate-600"
                >
                  Open
                </button>
              )}
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
              {columns.slice(1).map((column) => (
                <div key={column.key} className="min-w-0">
                  {column.header ? (
                    <dt className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                      {column.header}
                    </dt>
                  ) : null}
                  <dd className="truncate text-xs text-slate-700">{column.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ Pager */

export function RegistryPager({
  page,
  pageCount,
  total,
  size,
  onPage,
  onSize,
  sizeOptions = [10, 25, 50, 100],
  noun = "record",
}: {
  page: number;
  pageCount: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
  onSize?: (size: number) => void;
  sizeOptions?: number[];
  noun?: string;
}) {
  const from = total === 0 ? 0 : page * size + 1;
  const to = Math.min(total, (page + 1) * size);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-slate-100/60 px-4 py-2.5 text-xs text-slate-500">
      <p className="tabular-nums">
        {total === 0 ? (
          <>No {noun}s</>
        ) : (
          <>
            Showing <span className="font-semibold text-slate-900">{from}</span>–
            <span className="font-semibold text-slate-900">{to}</span> of{" "}
            <span className="font-semibold text-slate-900">{total}</span> {noun}s
          </>
        )}
      </p>

      <div className="flex items-center gap-2">
        {onSize && (
          <label className="hidden items-center gap-1.5 sm:flex">
            <span className="sr-only">Rows per page</span>
            <select
              value={size}
              onChange={(event) => onSize(Number(event.target.value))}
              className="h-7 rounded-md border border-slate-300 bg-slate-100 px-1.5 text-xs text-slate-700"
            >
              {sizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option} / page
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(0)}
            disabled={page === 0}
            aria-label="First page"
            className="focus-ring rounded-md border border-border-subtle px-2 py-1 font-medium text-slate-600 transition-colors hover:text-slate-950 disabled:opacity-40"
          >
            «
          </button>
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page === 0}
            className="focus-ring rounded-md border border-border-subtle px-2.5 py-1 font-medium text-slate-600 transition-colors hover:text-slate-950 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-1 tabular-nums text-slate-600">
            {page + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page + 1 >= pageCount}
            className="focus-ring rounded-md border border-border-subtle px-2.5 py-1 font-medium text-slate-600 transition-colors hover:text-slate-950 disabled:opacity-40"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => onPage(pageCount - 1)}
            disabled={page + 1 >= pageCount}
            aria-label="Last page"
            className="focus-ring rounded-md border border-border-subtle px-2 py-1 font-medium text-slate-600 transition-colors hover:text-slate-950 disabled:opacity-40"
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}
