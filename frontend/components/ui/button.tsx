import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-teal-400 text-slate-950 shadow-[0_1px_0_0_rgba(255,255,255,0.18)_inset,0_8px_20px_-12px_rgba(20,184,166,0.9)] hover:bg-teal-300 focus-visible:outline-teal-300 disabled:bg-teal-400/40 disabled:text-slate-950/70",
  secondary:
    "bg-surface text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-surface-raised hover:text-slate-950 hover:ring-slate-400 focus-visible:outline-teal-400",
  ghost:
    "text-slate-600 hover:bg-white/5 hover:text-slate-950 focus-visible:outline-teal-400",
  danger:
    "bg-rose-600 text-white shadow-sm hover:bg-rose-500 focus-visible:outline-rose-400 disabled:bg-rose-600/50",
  /*
   * Raised neutral fill. The label must be *dark*: `bg-slate-800` is now a
   * genuinely light surface in the repaired ramp, so pairing it with
   * `text-slate-950` (the brightest ink) rendered white-on-white.
   */
  subtle:
    "bg-slate-700 text-slate-50 shadow-sm ring-1 ring-white/10 ring-inset hover:bg-slate-800 focus-visible:outline-slate-400",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9.5 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

/**
 * Class list shared by {@link Button} and {@link LinkButton}.
 *
 * Keeping it in one place is what guarantees a navigation CTA and an action
 * button look identical; it also removed a silent divergence where the anchor
 * version had drifted from the button version.
 */
const BASE =
  "inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 active:translate-y-px";

export function buttonClass(
  variant: Variant = "secondary",
  size: Size = "md",
  className = "",
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // `aria-busy` lets assistive tech announce the in-flight state instead of
      // the label silently doing nothing.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`${buttonClass(
        variant,
        size,
        className,
      )} disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0`}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

/**
 * Button styling applied to a link.
 *
 * Rendering `<button>` inside `<a>` (as `<Link><Button/></Link>` does) produces
 * invalid HTML and breaks keyboard activation in some browsers, so navigation
 * actions use this instead.
 */
export function LinkButton({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  icon,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}) {
  return (
    <a className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </a>
  );
}
