"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Dialog keyboard and scroll behaviour, shared by `Modal` and the command
 * palette.
 *
 * Three things an operator console cannot get wrong:
 * 1. **Escape closes.** A blocked dialog during an incident must never trap the
 *    page.
 * 2. **Tab stays inside.** Focus walks the dialog's own focusables and wraps,
 *    so a keyboard user cannot tab into the table behind the overlay.
 * 3. **Focus returns.** The element that opened the dialog is refocused on
 *    close; otherwise focus falls to `<body>` and the next Tab restarts at the
 *    top of the page.
 *
 * Panels are portalled into `document.body`, so children are rendered one
 * commit *after* `open` flips. Everything here therefore waits for the panel:
 * `containerRef.current` is still `null` on the first pass, and `open` alone
 * does not mean a node exists.
 *
 * The scroll lock is restored from the previous inline value, so a nested or
 * rapid open/close cycle cannot leave the page unscrollable.
 */
export function useDialogBehavior({
  open,
  onClose,
  containerRef,
}: {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
}) {
  // `onClose` is often an inline arrow; keeping it in a ref avoids tearing down
  // and re-adding the listener on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    /*
     * Focus the first control. One frame is enough for a portal, but a single
     * frame is not *guaranteed*: if the host mounts in the same batch the panel
     * can still be attached on the second frame. `focusFirst` retries until the
     * node exists (or the dialog closes), which keeps keyboard users on the
     * first field instead of leaving focus on `<body>`.
     */
    let attempts = 0;
    let frame = 0;

    const focusFirst = () => {
      const node = containerRef.current;
      if (!node) {
        if (attempts++ < 5) frame = window.requestAnimationFrame(focusFirst);
        return;
      }
      const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? node).focus({ preventScroll: true });
    };
    frame = window.requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      // React 19 replays DOM events into React listeners; a replay has no `key`.
      if (typeof event.key !== "string") return;

      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const node = containerRef.current;
      if (!node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      /*
       * Only restore focus if the opener is still in the document. Playwright
       * and React both detach nodes aggressively; focusing a detached element is
       * a no-op at best and throws in older engines.
       */
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, containerRef]);
}
