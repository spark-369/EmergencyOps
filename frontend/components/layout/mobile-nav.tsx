"use client";

import { visibleNavItems } from "@/lib/navigation";
import { useAppSelector } from "@/lib/store/hooks";
import { usePathname } from "next/navigation";
import Link from "next/link";

/**
 * Horizontal navigation for small screens (the sidebar is desktop-only).
 *
 * The active chip is removed from the strip. The top bar directly above it
 * already names the current screen ("Platform / Incidents"), so keeping it here
 * only pushed the destinations you actually need off-screen on a 360px phone.
 */
export function MobileNav() {
  const pathname = usePathname();
  const user = useAppSelector((state) => state.auth.user);
  const items = visibleNavItems(user?.roles ?? []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const destinations = items.filter((item) => !isActive(item.href));

  return (
    <nav
      aria-label="Screens"
      className="scroll-thin sticky top-14 z-20 flex gap-1.5 overflow-x-auto border-b border-border-subtle bg-background/90 px-3 py-2 backdrop-blur-xl lg:hidden"
    >
      {destinations.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="shrink-0 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium whitespace-nowrap text-slate-600 transition-colors hover:border-border-strong hover:text-slate-950"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
