"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/** Sort direction for a given key. */
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string | null;
  direction: SortDirection;
}

export interface RegistryFilterOption {
  value: string;
  label: string;
}

export interface RegistryFilter {
  key: string;
  label: string;
  /** `""` means "no filter applied". */
  options: RegistryFilterOption[];
  /** Called with the row and the selected value; return true to keep the row. */
  match: (row: unknown, value: string) => boolean;
}

/**
 * Sort comparator derived from a row.
 *
 * Column keys are presentation identifiers (`"user"`, `"load"`), not property
 * names, so the hook cannot read `row[key]`. The caller supplies the value to
 * sort on instead, which also supports computed columns (a full name, a
 * percentage) without adding hidden row fields.
 */
export type SortAccessor<T> = (row: T) => string | number | null | undefined;

/**
 * Headless search / filter / sort / pagination for registry screens.
 *
 * Every registry in this console (incidents, resources, hospitals, allocations,
 * road segments, users) had grown its own slightly different combination of
 * these controls, and two of them had none at all. Centralising the state means
 * "press / to search", "sort by a header" and "clear filters" behave the same
 * everywhere, and the markup that renders them stays purely presentational.
 *
 * Design notes:
 * - **Search is debounced** (150 ms). The row set is already in memory, but
 *   filtering a few thousand rows on every keystroke makes typing feel heavy;
 *   the debounce keeps the input at 60 fps.
 * - **Filtering and sorting are memoised** on their inputs, so the table only
 *   recomputes when the query, the filters or the source array change.
 * - **Pagination resets** whenever the result set changes shape. Without that,
 *   typing a query while on page 4 leaves the user on an empty page 4 and looks
 *   like "search returns nothing".
 * - The hook owns no DOM: it returns plain state and callbacks. The `/`
 *   shortcut that focuses the search field lives in `RegistrySearch`, and the
 *   sortable header controls live in `RegistryTable`.
 */
export function useRegistry<T>({
  rows,
  searchFields,
  filters = [],
  sortValues = {},
  initialSort,
  pageSize = 25,
}: {
  rows: T[];
  /** Values concatenated into the search haystack for a row. */
  searchFields: (row: T) => Array<string | number | null | undefined>;
  filters?: RegistryFilter[];
  /** Column key → value accessor. A column without an entry is not sortable. */
  sortValues?: Record<string, SortAccessor<T>>;
  initialSort?: SortState;
  pageSize?: number;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>(initialSort ?? { key: null, direction: "asc" });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const filtered = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase();
    const active = filters.filter((filter) => (values[filter.key] ?? "") !== "");

    return rows.filter((row) => {
      for (const filter of active) {
        if (!filter.match(row, values[filter.key])) return false;
      }
      if (!term) return true;
      return searchFields(row).some((field) =>
        String(field ?? "")
          .toLowerCase()
          .includes(term),
      );
    });
    // `searchFields`/`filters` are typically inline closures; depending on them
    // would invalidate on every render and defeat the memo. Their behaviour is
    // fixed per screen, so the row set, query and values are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, debouncedQuery, values]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const accessor = sortValues[sort.key];
    if (!accessor) return filtered;
    const factor = sort.direction === "asc" ? 1 : -1;

    // Copy first: `Array.prototype.sort` mutates, and `filtered` is memoised.
    return [...filtered].sort((a, b) => {
      const left = accessor(a);
      const right = accessor(b);

      // Empty values always sink, regardless of direction — a blank cell should
      // not head a descending sort.
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;

      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * factor;
      }
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * factor;
    });
    // `sortValues` is a per-screen constant, like `searchFields`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  /*
   * Clamp rather than store an out-of-range page: when the source shrinks (a
   * filter narrows the rows), `page` can exceed the new last page and the user
   * would see an empty table that looks like "no results".
   */
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const pageRows = useMemo(
    () => sorted.slice(safePage * size, safePage * size + size),
    [sorted, safePage, size],
  );

  // Persist the clamp so the pager and the rows can never disagree.
  useEffect(() => {
    setPage((prev) => Math.min(Math.max(0, prev), pageCount - 1));
  }, [pageCount]);

  const setFilter = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setQuery("");
    setValues({});
    setPage(0);
  }, []);

  const toggleSort = useCallback((key: string) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
    setPage(0);
  }, []);

  const isFiltered = query.trim() !== "" || Object.values(values).some((value) => value !== "");

  return {
    query,
    setQuery,
    values,
    setFilter,
    clearFilters,
    sort,
    toggleSort,
    page: safePage,
    setPage,
    size,
    setSize,
    total,
    pageCount,
    pageRows,
    /**
     * The complete filtered + sorted result set, before paging.
     *
     * `pageRows` is only the current slice, so any figure that summarises "the
     * rows on screen" (counts by severity, sums, breach totals) needs the whole
     * set — computing them from `pageRows` would make the headline change as the
     * operator pages through, which reads as a bug. Already memoised by `sorted`,
     * so exposing it costs nothing.
     */
    rows: sorted,
    isFiltered,
  };
}

