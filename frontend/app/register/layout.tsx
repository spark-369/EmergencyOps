import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Server wrapper for the first-run registration route.
 *
 * `page.tsx` is a Client Component and cannot export `metadata`, so the title is
 * declared here.
 */
export const metadata: Metadata = {
  title: "First-run setup",
  description: "Create the first administrator account for the EmergencyOps console.",
};

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}