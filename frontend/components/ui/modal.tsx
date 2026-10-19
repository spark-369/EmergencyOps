"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useDialogBehavior } from "@/components/ui/use-dialog-behavior";

/**
 * Renders children into `document.body`.
 *
 * A dialog must not live inside the component that opened it. Any ancestor with
 * `position: relative`, `overflow: hidden`, `transform` or `filter` becomes the
 * containing block / clip for a `position: fixed` overlay, so a modal opened
 * from the user menu (a `relative` div) or a table row (inside an
 * `overflow: hidden` card) was being confined to that box and painted beneath
 * the sticky header instead of over the viewport.
 *
 * `document.body` is the only ancestor with no clipping and no stacking
 * context, so the overlay always covers the full viewport and its `z-50`
 * competes only with other top-level chrome.
 *
 * Mounting is deferred to an effect because `document` does not exist during
 * prerender; `ClientOnly`'s hydration signal is not usable here (portals need a
 * real DOM node, not just a client render).
 */
function Portal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.body);
  }, []);

  return host ? createPortal(children, host) : null;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useDialogBehavior({ open, onClose, containerRef: panelRef });

  if (!open) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-md sm:items-center"
        // Clicking the backdrop (but not the panel) closes the dialog.
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={`animate-toast-in my-auto w-full rounded-xl border border-border-strong bg-surface-overlay shadow-[var(--shadow-overlay)] outline-none ${
            size === "lg" ? "max-w-3xl" : "max-w-lg"
          }`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-slate-950">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-0.5 text-xs text-slate-500">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="focus-ring rounded-md p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-950"
            >
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="scroll-thin max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle bg-white/[0.015] px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600">{message}</div>
    </Modal>
  );
}
