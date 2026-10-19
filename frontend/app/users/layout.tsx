import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Users & access" };

/**
 * Server wrapper so the Client Component page can have a per-route title.
 * The body is the shared app chrome, unaffected by this file.
 */
export default function UsersLayout({ children }: { children: ReactNode }) {
  return children;
}