import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "API explorer" };

export default function ApiExplorerLayout({ children }: { children: ReactNode }) {
  return children;
}