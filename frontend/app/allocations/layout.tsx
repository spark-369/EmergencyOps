import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Allocations" };

export default function AllocationsLayout({ children }: { children: ReactNode }) {
  return children;
}