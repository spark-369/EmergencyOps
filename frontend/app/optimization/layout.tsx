import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Optimization" };

export default function OptimizationLayout({ children }: { children: ReactNode }) {
  return children;
}