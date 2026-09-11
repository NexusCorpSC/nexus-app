import {
  Anchor,
  BatteryCharging,
  Bell,
  Bomb,
  Box,
  Coins,
  Cog,
  Compass,
  Cross,
  Crosshair,
  Diamond,
  Eye,
  Flag,
  Flame,
  Fuel,
  Gauge,
  Ghost,
  HardHat,
  Hammer,
  HeartPulse,
  Hexagon,
  KeyRound,
  LifeBuoy,
  Map,
  MapPin,
  Minus,
  Navigation,
  Orbit,
  Pill,
  Plane,
  Radio,
  Rocket,
  Search,
  Shield,
  ShieldHalf,
  Skull,
  Star,
  Sword,
  Target,
  Triangle,
  Truck,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Squad, SquadRole, SquadRoleIcon } from "@/types/nexus";
import { cn } from "@/lib/utils";

/**
 * The glyph half of a role.
 *
 * The API stores a name, not a drawing: a role travels between clients as
 * `"heart-pulse"`, and each of them decides what that looks like. This table is
 * the whole of that decision — it has to hold every name in `ROLE_ICON_GROUPS`,
 * and the picker in the overlay is built from that list rather than from here,
 * so a name added there without a line here would render as «no role» instead
 * of as a hole.
 *
 * Monochrome on purpose, everywhere it is used: on a member's row the colour is
 * already saying whether they are ready, alive or down, and a second colour
 * competing with that one is how a glance stops being enough. The shape says
 * the role; the colour says the state.
 */
const GLYPHS: Record<SquadRoleIcon, LucideIcon> = {
  crosshair: Crosshair,
  target: Target,
  sword: Sword,
  shield: Shield,
  "shield-half": ShieldHalf,
  bomb: Bomb,
  flame: Flame,
  zap: Zap,
  skull: Skull,
  navigation: Navigation,
  rocket: Rocket,
  plane: Plane,
  compass: Compass,
  anchor: Anchor,
  fuel: Fuel,
  gauge: Gauge,
  orbit: Orbit,
  cross: Cross,
  "heart-pulse": HeartPulse,
  pill: Pill,
  "life-buoy": LifeBuoy,
  battery: BatteryCharging,
  users: Users,
  bell: Bell,
  radio: Radio,
  wrench: Wrench,
  hammer: Hammer,
  cog: Cog,
  box: Box,
  truck: Truck,
  "hard-hat": HardHat,
  coins: Coins,
  key: KeyRound,
  eye: Eye,
  search: Search,
  map: Map,
  "map-pin": MapPin,
  flag: Flag,
  star: Star,
  hexagon: Hexagon,
  triangle: Triangle,
  diamond: Diamond,
  ghost: Ghost,
};

export function RoleIcon({
  icon,
  className,
}: {
  /** Absent, or a name this build does not know: the dash that means «none». */
  icon: SquadRoleIcon | undefined;
  className?: string;
}) {
  const Glyph = (icon && GLYPHS[icon]) || Minus;

  return <Glyph className={cn("size-3.5", className)} />;
}

/**
 * The seven a squad starts with, as this client would draw them.
 *
 * Only ever used for a squad the server answered without a `roles` field — one
 * created before roles existed. The first write that touches its list
 * materialises the same seven server-side, so this is a reading convenience and
 * never a source of truth.
 */
const BASE_ROLES: SquadRole[] = [
  { id: "assaut", label: "Assaut", icon: "crosshair", base: true },
  { id: "artilleur", label: "Artilleur", icon: "target", base: true },
  { id: "medic", label: "Médic", icon: "cross", base: true },
  { id: "ingenieur", label: "Ingénieur", icon: "wrench", base: true },
  { id: "pilote", label: "Pilote", icon: "navigation", base: true },
  { id: "eclaireur", label: "Éclaireur", icon: "eye", base: true },
  { id: "logistique", label: "Logistique", icon: "box", base: true },
];

export function rolesOf(squad: Squad): SquadRole[] {
  return squad.roles ?? BASE_ROLES;
}

/**
 * The role a member is wearing, or `null`.
 *
 * `null` covers both «none chosen» and «an id that resolves to nothing», which
 * is a role someone deleted between this poll and the last. The two look the
 * same on the row on purpose: there is nothing useful to say about a role that
 * no longer exists.
 */
export function roleOf(squad: Squad, roleId: string | undefined) {
  if (!roleId) return null;

  return rolesOf(squad).find((role) => role.id === roleId) ?? null;
}
