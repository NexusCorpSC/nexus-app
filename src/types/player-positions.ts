import type { PlacePosition } from "@/types/nexus";

/**
 * Le suivi de position, comme le site le décrit (`types/player-positions.ts`
 * de nexus-tools) : un joueur en jeu partage sa dernière position avec ses
 * amis et les membres des organisations qu'il coche. Le NPS envoie chaque
 * relevé ; la Star Map du site et le NPS les montrent.
 */

/** Sans nouveau relevé depuis, une position s'estompe et affiche son âge. */
export const POSITION_STALE_MS = 2 * 60 * 1000;

/** Le rythme auquel le NPS relit les positions des autres. */
export const PLAYERS_REFRESH_MS = 10_000;

/** D'où vient une position : suivi à l'écran, /showlocation, ou saisie. */
export type PositionSource = "screen" | "showlocation" | "paste";

/** Qui voit ma position : mes amis, et les organisations cochées. */
export type PositionSharing = {
  enabled: boolean;
  friends: boolean;
  orgIds: string[];
};

/** Une de mes organisations, à cocher. */
export type SharingOrg = {
  id: string;
  name: string;
  tag?: string;
  members: number;
};

/** Une position relevée, et ce qui la situe. */
export type PlayerPosition = {
  systemSlug: string;
  systemName?: string;
  bodySlug?: string;
  bodyName?: string;
  /** Sur un corps, dans son repère ; dans l'espace, dans celui du système. */
  position: PlacePosition;
  source: PositionSource;
  /** Heure du relevé, ISO. */
  at: string;
};

/** Mon réglage, de quoi le modifier, et ce que je partage en ce moment. */
export type MyPositionSharing = {
  sharing: PositionSharing;
  orgs: SharingOrg[];
  friends: number;
  playing: boolean;
  position: PlayerPosition | null;
};

/** Ce que le NPS envoie : `PUT /api/me/position`. */
export type PositionInput = {
  /** Requis dans l'espace ; sur un corps, c'est le sien. */
  systemSlug?: string;
  position: PlacePosition;
  source: PositionSource;
};

/** Un joueur en jeu qui partage sa position avec moi, ou moi-même. */
export type PlayerInGame = PlayerPosition & {
  userId: string;
  name: string;
  avatar: string | null;
  me: boolean;
  friend: boolean;
  /** Les organisations par lesquelles je le vois. */
  orgs: { id: string; name: string; tag?: string }[];
  activity: string | null;
  /** Depuis quand il joue, ISO. */
  since: string;
};
