import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Resources" };

export default function ResourcesLayout({ children }: { children: ReactNode }) {
  return children;
}