import type { Role } from "@/lib/types";

/**
 * What each role may actually do, in one sentence.
 *
 * Lives here (not in a page) because three surfaces need it: the users screen,
 * the identity menu, and anywhere a role is explained. Like `NavItem.roles`,
 * this is documentation for the *purely presentational* side — the real rule is
 * the `@PreAuthorize` guard on the controller.
 */
export const ROLE_HINTS: Record<Role, string> = {
  ADMIN: "Full access, including account management.",
  DISPATCHER: "Create allocations and incidents, and manage the fleet and road network.",
  FIELD_OPERATOR: "Progress allocations and update unit status, location and load.",
  VIEWER: "Read-only across every screen.",
};

export interface NavItem {
  href: string;
  label: string;
  description: string;
  /** Short glyph rendered in the sidebar (kept dependency-free). */
  glyph: string;
  /**
   * Roles allowed to see this entry. Omitted means "every signed-in user".
   *
   * This only drives rendering. The API enforces the same rule with
   * `@PreAuthorize`, so a user who navigates to a hidden URL still receives 403.
   */
  roles?: Role[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Operations",
    items: [
      {
        href: "/",
        label: "Command Center",
        description: "Live posture across incidents, resources and allocations",
        glyph: "◎",
      },
      {
        href: "/incidents",
        label: "Incidents",
        description: "Report, triage, re-prioritise and close incidents",
        glyph: "▲",
      },
      {
        href: "/allocations",
        label: "Allocations",
        description: "Dispatch resources and drive them through their lifecycle",
        glyph: "⇄",
      },
    ],
  },
  {
    title: "Assets",
    items: [
      {
        href: "/resources",
        label: "Resources",
        description: "Ambulances, teams, aircraft and their availability",
        glyph: "✦",
      },
      {
        href: "/hospitals",
        label: "Hospitals",
        description: "Bed, ICU and emergency capacity management",
        glyph: "✚",
      },
      {
        href: "/road-network",
        label: "Road Network",
        description: "Segments, closures and travel-time updates",
        glyph: "⌗",
      },
    ],
  },
  {
    title: "Intelligence",
    items: [
      {
        href: "/optimization",
        label: "Optimization",
        description: "Allocation recommendations and fleet re-optimisation",
        glyph: "◈",
      },
      {
        href: "/api-explorer",
        label: "API Explorer",
        description: "Every endpoint, its verb and the screen that exercises it",
        glyph: "⌘",
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        href: "/users",
        label: "Users",
        description: "Accounts, roles and access control",
        glyph: "☰",
        roles: ["ADMIN"],
      },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

/**
 * Hides entries the current user's roles cannot access, dropping any section
 * left empty. Server-side enforcement is unchanged; this is presentation only.
 */
export function visibleNavSections(roles: Role[]): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.roles || item.roles.some((role) => roles.includes(role)),
    ),
  })).filter((section) => section.items.length > 0);
}

/** Flat, role-filtered list used by the top bar and mobile navigation. */
export function visibleNavItems(roles: Role[]): NavItem[] {
  return visibleNavSections(roles).flatMap((section) => section.items);
}
