"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setPaletteOpen, togglePalette } from "@/lib/store/ui-slice";
import { visibleNavSections } from "@/lib/navigation";
import { useDialogBehavior } from "@/components/ui/use-dialog-behavior";

/**
 * True when the event is a genuine ⌘K / Ctrl-K key press.
 *
 * Two guards, both load-bearing:
 *
 * 1. **`typeof event.key !== "string"`.** React 19 replays real DOM events into
 *    React listeners to flush effects that mounted during a discrete event
 *    (clicking "Create the first administrator" does exactly that). A replayed
 *    event is not a `KeyboardEvent` — it has no `key` — so calling
 *    `event.key.toLowerCase()` threw `Cannot read properties of undefined` from
 *    inside a `window` listener.
 *
 * 2. **`!(event.target instanceof Node)`.** The replay must also be *ignored*
 *    rather than merely tolerated: if it reached `togglePalette()`, the click
 *    that triggered the replay would open the command palette. Requiring a real
 *    `Node` target rejects replays while keeping genuine synthetic and
 *    cross-frame handler invocations working.
 */
function isPaletteShortcut(event: KeyboardEvent): boolean {
  if (typeof event.key !== "string") return false;
  if (typeof Node === "undefined" || !(event.target instanceof Node)) return false;
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
}

/**
 * Command palette (⌘K / Ctrl-K).
 *
 * The console has eleven destinations across four sections; on a laptop that is
 * a lot of pointer travel mid-incident. This gives keyboard-first operators a
 * two-keystroke jump and doubles as a mobile escape hatch for the
 * horizontally scrolling nav.
 *
 * Filters on label, description and section, so "bed" finds Hospitals without
 * anyone memorising the labels. Arrow keys move the active row, Enter
 * navigates, Escape closes — with focus trapped and restored by the shared
 * dialog hook.
 */
export function CommandPalette() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  // Visibility lives in the UI slice so the top-bar trigger and the ⌘K shortcut
  // share one source of truth (two `useState` copies would drift apart).
  const open = useAppSelector((state) => state.ui.paletteOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /*
   * Portal host. The palette is mounted inside `AuthProvider`, whose children
   * include chrome with `position: relative` ancestors (top bar actions) and
   * `overflow: hidden` cards; a `position: fixed` overlay nested in those is
   * clipped to their box. Portalling to `body` guarantees it covers the
   * viewport, exactly like `Modal`.
   */
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.body);
  }, []);

  const close = () => dispatch(setPaletteOpen(false));

  const sections = useMemo(
    () => visibleNavSections(user?.roles ?? []),
    [user?.roles],
  );

  const flat = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.map((item) => ({ ...item, section: section.title })),
      ),
    [sections],
  );

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return flat;
    return flat.filter((item) =>
      `${item.label} ${item.description} ${item.section}`
        .toLowerCase()
        .includes(term),
    );
  }, [flat, query]);

  useDialogBehavior({ open, onClose: close, containerRef: panelRef });

  // Global shortcut. Registered on `window` so it works regardless of focus,
  // and prevented from reaching the browser's own ⌘K handler.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      dispatch(togglePalette());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  // Reset the query each time the palette opens; a stale filter on reopen reads
  // as a bug ("why is only one screen listed?").
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
  }, [open]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (href: string) => {
    close();
    router.push(href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((prev) =>
        results.length === 0 ? 0 : (prev - 1 + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = results[active];
      if (target) go(target.href);
    }
  };

  if (!open || !host) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/65 p-4 pt-[12vh] backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="animate-toast-in w-full max-w-lg overflow-hidden rounded-xl border border-border-strong bg-surface-overlay shadow-[var(--shadow-overlay)]"
      >

        <div className="flex items-center gap-2 border-b border-border-subtle px-3">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0 text-slate-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="Jump to a screen…"
            aria-label="Search screens"
            aria-controls="command-palette-results"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-500"
          />
          <kbd className="hidden shrink-0 rounded border border-border-subtle px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:block">
            esc
          </kbd>
        </div>

        <ul
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          aria-label="Matching screens"
          className="scroll-thin max-h-[46vh] overflow-y-auto p-1.5"
        >
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-slate-500">
              No screen matches “{query}”.
            </li>
          )}
          {results.map((item, index) => (
            <li key={item.href}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseMove={() => setActive(index)}
                onClick={() => go(item.href)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  index === active ? "bg-teal-400/10 text-slate-950" : "text-slate-700"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-4 shrink-0 text-center ${
                    index === active ? "text-teal-300" : "text-slate-500"
                  }`}
                >
                  {item.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {item.description}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                  {item.section}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3 border-t border-border-subtle px-3 py-2 text-[10px] text-slate-500">
          <span>
            <kbd className="font-mono">↑↓</kbd> move
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span className="ml-auto">
            <kbd className="font-mono">⌘K</kbd> toggle
          </span>
        </div>
      </div>
    </div>,
    host,
  );
}
