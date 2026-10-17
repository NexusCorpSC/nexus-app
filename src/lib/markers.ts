import { emit } from "@tauri-apps/api/event";
import {
  bodyAt,
  positionOf,
  systemPositionOf,
  type Fix,
} from "@/lib/nps";
import { showOverlay } from "@/lib/windows";
import type { NpsBody, NpsPlace } from "@/types/nexus";
import {
  DEFAULT_MARKER_COLOR,
  MARKER_COLORS,
  type Marker,
  type MarkerCollection,
  type MarkerColor,
  type MarkerInput,
} from "@/types/markers";

/**
 * Au-delà, un relevé ne dit plus où l'on est : on en demande un nouveau avant
 * de marquer. Sur une planète qui tourne, trente secondes à pied ou en vol
 * suffisent à s'éloigner des rochers qu'on voulait garder.
 */
export const MARKER_FRESH_MS = 30_000;

/** Plus près, on est arrivé au marqueur : le NPS propose de le supprimer. */
export const MARKER_ARRIVAL_M = 50;

/** La page Marqueurs demande le formulaire à la fenêtre du NPS. */
export const MARK_FORM_EVENT = "nps://mark-form";

/**
 * « Marquer ma position » depuis la fenêtre principale : le relevé vit dans
 * la superposition du NPS, c'est donc elle qui s'affiche, formulaire ouvert.
 */
export async function openMarkForm(): Promise<void> {
  await showOverlay("nps");
  await emit(MARK_FORM_EVENT);
}

/** Un relevé assez récent pour y poser un marqueur. */
export function isFresh(fix: Fix | null, now: number): fix is Fix {
  return fix !== null && now - fix.at <= MARKER_FRESH_MS;
}

/**
 * Le nom proposé : le corps où l'on est, sinon le système, et l'heure
 * locale du relevé, `Daymar 14:32`.
 */
export function defaultMarkerName(where: string, at: number): string {
  const date = new Date(at);
  const time = [date.getHours(), date.getMinutes()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return `${where} ${time}`.trim();
}

/** Où se trouve un relevé, pour le nom proposé et le formulaire. */
export function whereOf(
  fix: Fix,
  { bodies, places }: { bodies: NpsBody[]; places: NpsPlace[] },
  system: string | null,
): { body: NpsBody | null; systemSlug: string | null; systemName?: string } {
  const body = bodyAt(fix, bodies);
  const systemSlug = fix.system ?? body?.systemSlug ?? system;
  return {
    body,
    systemSlug,
    // Les lieux aussi : Nyx n'a pas encore de corps décrits.
    systemName: [...bodies, ...places].find(
      (one) => one.systemSlug === systemSlug,
    )?.systemName,
  };
}

/**
 * La position d'un relevé comme le site garde celle d'un marqueur : la même
 * que pour la position d'un lieu, dans le repère du corps quand on est sur
 * une planète ou une lune, sinon dans celui du système, que `systemSlug`
 * nomme alors.
 */
export function markerPositionOf(
  fix: Fix,
  bodies: NpsBody[],
  system: string | null,
): Pick<MarkerInput, "position" | "systemSlug" | "source"> {
  const systemSlug =
    fix.system ?? bodyAt(fix, bodies)?.systemSlug ?? system ?? undefined;
  return {
    position: positionOf(fix, bodies),
    systemSlug,
    source: fix.source === "screen" ? "screen" : "showlocation",
  };
}

/**
 * La couleur d'une nouvelle collection : la première que le joueur n'a pas
 * encore prise, hors celle des marqueurs sans collection.
 */
export function nextCollectionColor(
  collections: Pick<MarkerCollection, "color" | "isOwner">[],
): MarkerColor {
  const taken = new Set(
    collections.filter((one) => one.isOwner).map((one) => one.color),
  );
  const choices = MARKER_COLORS.filter(
    (color) => color !== DEFAULT_MARKER_COLOR,
  );
  return (
    choices.find((color) => !taken.has(color)) ??
    choices[taken.size % choices.length]
  );
}

/** Un marqueur et sa distance au relevé, quand elle se calcule. */
export type MarkerDistance = { marker: Marker; distance: number | null };

/**
 * Les marqueurs avec leur distance au relevé, les plus proches d'abord, puis
 * ceux qu'on ne sait pas situer (un autre système, pas de relevé), les plus
 * récents d'abord. Chaque système a son repère : d'un autre, la distance ne
 * veut rien dire.
 */
export function withDistances(
  markers: Marker[],
  fix: Fix | null,
  bodies: NpsBody[],
  system: string | null,
): MarkerDistance[] {
  return markers
    .map((marker) => {
      if (!fix || (system && marker.systemSlug !== system)) {
        return { marker, distance: null };
      }
      const point = systemPositionOf(marker.position, bodies, fix.at);
      return {
        marker,
        distance: point
          ? Math.hypot(point.x - fix.x, point.y - fix.y, point.z - fix.z)
          : null,
      };
    })
    .sort((a, b) =>
      a.distance !== null && b.distance !== null
        ? a.distance - b.distance
        : a.distance !== null
          ? -1
          : b.distance !== null
            ? 1
            : b.marker.createdAt.localeCompare(a.marker.createdAt),
    );
}
