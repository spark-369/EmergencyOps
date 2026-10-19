import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Hospitals" };

export default function HospitalsLayout({ children }: { children: ReactNode }) {
  return children;
}