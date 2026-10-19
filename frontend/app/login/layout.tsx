import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Server wrapper for the sign-in route.
 *
 * `page.tsx` is a Client Component (it owns form state and RTK hooks) and cannot
 * export `metadata`, so the title is declared here.
 */
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the EmergencyOps operations console.",
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}