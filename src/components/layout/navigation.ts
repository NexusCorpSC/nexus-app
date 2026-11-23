import {
  Archive,
  BookOpen,
  Bot,
  Building2,
  ClipboardList,
  Coins,
  Compass,
  Container,
  Database,
  Flag,
  FlaskConical,
  Gauge,
  Hammer,
  Map as MapIcon,
  MapPin,
  MapPinned,
  NotebookPen,
  Orbit,
  Package,
  Radar,
  Rocket,
  Route as RouteIcon,
  Search,
  ShoppingBag,
  Star,
  User,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Shortcuts } from "@/lib/settings";
import type { OverlayLabel } from "@/lib/windows";

export type NavKey =
  | "home"
  | "blueprints"
  | "items"
  | "places"
  | "markers"
  | "missions"
  | "factions"
  | "lore"
  | "inventory"
  | "orders"
  | "requests"
  | "refining"
  | "reputations"
  | "friends"
  | "notes"
  | "chat"
  | "cargo"
  | "telemetry"
  | "orgs";

export type NavGroupId = "database" | "economy" | "mySpace" | "community";

export type NavItem = {
  to: string;
  label: NavKey;
  icon: LucideIcon;
  /** Hidden while signed out. */
  requiresAuth?: boolean;
  /** Extra route prefixes that belong to this page. */
  alsoMatches?: string[];
};

export type NavGroup = {
  id: NavGroupId;
  icon: LucideIcon;
  items: NavItem[];
};

/**
 * The four poles on the primary rail, matching Nexus Tools' categories:
 * what the game holds, what moves through the economy, the reader's own
 * session tools, and the people they play with.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "database",
    icon: Database,
    items: [
      { to: "/blueprints", label: "blueprints", icon: Hammer },
      { to: "/items", label: "items", icon: Package },
      { to: "/places", label: "places", icon: MapPin },
      { to: "/missions", label: "missions", icon: Rocket },
      { to: "/factions", label: "factions", icon: Flag },
      { to: "/lore", label: "lore", icon: BookOpen },
    ],
  },
  {
    id: "economy",
    icon: Coins,
    items: [
      {
        to: "/inventory",
        label: "inventory",
        icon: Archive,
        requiresAuth: true,
      },
      {
        to: "/refining",
        label: "refining",
        icon: FlaskConical,
        requiresAuth: true,
      },
      {
        to: "/orders",
        label: "orders",
        icon: ShoppingBag,
        requiresAuth: true,
      },
      {
        to: "/requests",
        label: "requests",
        icon: ClipboardList,
        requiresAuth: true,
      },
      { to: "/cargo", label: "cargo", icon: Container },
    ],
  },
  {
    id: "mySpace",
    icon: User,
    items: [
      {
        to: "/markers",
        label: "markers",
        icon: MapPinned,
        requiresAuth: true,
      },
      {
        to: "/reputations",
        label: "reputations",
        icon: Star,
        requiresAuth: true,
      },
      { to: "/notes", label: "notes", icon: NotebookPen },
      { to: "/chat", label: "chat", icon: Bot, requiresAuth: true },
      { to: "/telemetry", label: "telemetry", icon: Gauge },
    ],
  },
  {
    id: "community",
    icon: Users,
    items: [
      { to: "/friends", label: "friends", icon: UserRound, requiresAuth: true },
      {
        to: "/orgs",
        label: "orgs",
        icon: Building2,
        // Personal events outside an organization still live under Community.
        alsoMatches: ["/events"],
      },
    ],
  },
];

export type QuickOverlayKey = "squad" | "map";

/** The two overlays kept one click away at the foot of the contextual panel. */
export const QUICK_OVERLAYS: {
  label: OverlayLabel & QuickOverlayKey;
  icon: LucideIcon;
}[] = [
  { label: "squad", icon: Users },
  { label: "map", icon: MapIcon },
];

export type DrawerOverlayKey =
  | "search"
  | "squad"
  | "map"
  | "nps"
  | "radar"
  | "halo"
  | "plan"
  | "notes"
  | "cargo"
  | "chat";

/** Every overlay reachable from the rail's «En jeu» popover, with its shortcut. */
export const DRAWER_OVERLAYS: {
  label: OverlayLabel;
  key: DrawerOverlayKey;
  icon: LucideIcon;
  shortcut: keyof Shortcuts;
}[] = [
  { label: "overlay", key: "search", icon: Search, shortcut: "search" },
  { label: "squad", key: "squad", icon: Users, shortcut: "squad" },
  { label: "map", key: "map", icon: MapIcon, shortcut: "map" },
  { label: "nps", key: "nps", icon: Compass, shortcut: "nps" },
  { label: "radar", key: "radar", icon: Radar, shortcut: "radar" },
  { label: "halo", key: "halo", icon: Orbit, shortcut: "halo" },
  { label: "plan", key: "plan", icon: RouteIcon, shortcut: "plan" },
  { label: "notes", key: "notes", icon: NotebookPen, shortcut: "notes" },
  { label: "cargo", key: "cargo", icon: Container, shortcut: "cargo" },
  { label: "chat", key: "chat", icon: Bot, shortcut: "chat" },
];

/** `/missions` covers `/missions/42`, not `/missionsx`. */
function covers(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The pole whose contextual panel belongs to `pathname`, or `null` for screens
 * that sit outside the four poles (`/home`, `/settings`, `/login`).
 */
export function activeGroupForPath(pathname: string): NavGroup | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (covers(item.to, pathname)) return group;
      if (item.alsoMatches?.some((prefix) => covers(prefix, pathname))) {
        return group;
      }
    }
  }
  return null;
}

/** Whether a sub-panel item covers `pathname`, including its extra prefixes. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (covers(item.to, pathname)) return true;
  return item.alsoMatches?.some((prefix) => covers(prefix, pathname)) ?? false;
}
