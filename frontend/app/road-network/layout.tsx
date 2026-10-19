import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Road network" };

export default function RoadNetworkLayout({ children }: { children: ReactNode }) {
  return children;
}