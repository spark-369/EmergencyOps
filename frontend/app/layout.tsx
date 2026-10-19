import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "EmergencyOps · Resource Optimization Platform",
    template: "%s · EmergencyOps",
  },
  description:
    "Enterprise console for emergency incident intake, resource allocation, hospital capacity and road-network operations.",
};

/**
 * Dark-only console: declaring the scheme here keeps native form controls,
 * scrollbars and the mobile browser chrome dark from the very first paint.
 */
export const viewport: Viewport = {
  themeColor: "#060a12",
  colorScheme: "dark",
};

/**
 * Root layout for the App Router.
 *
 * The prop type is declared explicitly instead of relying on Next's generated
 * global `LayoutProps<"/">` (written to `next-env.d.ts`, which is gitignored and
 * therefore absent on a fresh clone until the dev server/build runs).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-[#060a12] antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

