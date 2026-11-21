import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { getNpsData } from "@/lib/api/nps";
import {
  onDestinationChange,
  readNpsDestination,
  type NpsDestination,
} from "@/lib/nps-destination";
import {
  bodyAt,
  MAX_TRAVEL_AGE_MS,
  MIN_TRAVEL_M,
  previousFor,
  toBodyFrame,
  type Fix,
} from "@/lib/nps";
import {
  geoOfPoint,
  groundDistance,
  headingTo,
  type LatLon,
} from "@/lib/planet-map-geometry";
import type { PlacePosition } from "@/types/nexus";

/** Les relevés du NPS, que Rust envoie à toutes les fenêtres (`nps.rs`). */
const POSITION_EVENT = "nps://position";

/** Au-delà, un relevé ne dit plus où l'on est. */
const LIVE_MAX_AGE_MS = 10 * 60 * 1000;

/** De quoi trouver un relevé précédent qui dise dans quel sens on va. */
const MAX_HISTORY = 120;

export type PlanetLive = {
  /** Le joueur, s'il est sur ce corps et que son dernier relevé est récent. */
  player: (LatLon & { alt: number; heading: number | null }) | null;
  /** La destination du NPS, si elle est sur ce corps. */
  destination: (LatLon & { name: string }) | null;
};

/**
 * Où en est le joueur sur une planète ou une lune : son dernier relevé de
 * `/showlocation` (ou lu à l'écran), ramené dans le repère du corps, et la
 * destination du NPS quand elle s'y trouve, quelle qu'elle soit (lieu, point,
 * marqueur ou joueur suivi).
 *
 * Le cap se calcule comme dans l'overlay du NPS : contre un relevé assez
 * ancien et assez loin (`previousFor`), pas contre le tout dernier, qui en
 * lecture d'écran n'est qu'à une seconde et quelques mètres.
 */
export function usePlanetLive(slug: string, radius: number): PlanetLive {
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [destination, setDestination] = useState<NpsDestination | null>(null);
  /** Change quand le dernier relevé périme : la position cesse alors de s'afficher. */
  const [expired, setExpired] = useState(0);
  const nps = useQuery({ queryKey: ["nps"], queryFn: getNpsData });

  useEffect(() => {
    const pending = listen<Fix>(POSITION_EVENT, (event) => {
      const reading = event.payload;
      setFixes((last) =>
        [...last, reading]
          .filter((one) => reading.at - one.at <= MAX_TRAVEL_AGE_MS)
          .slice(-MAX_HISTORY),
      );
    });
    return () => {
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void readNpsDestination().then((value) => {
        if (alive) setDestination(value ?? null);
      });
    refresh();
    const pending = onDestinationChange(refresh);
    return () => {
      alive = false;
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  // Sans nouveau relevé, la position doit quand même disparaître à temps.
  const lastAt = fixes.length > 0 ? fixes[fixes.length - 1].at : null;
  useEffect(() => {
    if (lastAt === null) return;
    const left = lastAt + LIVE_MAX_AGE_MS - Date.now();
    const timer = setTimeout(() => setExpired((count) => count + 1), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [lastAt]);

  return useMemo(() => {
    const bodies = nps.data?.bodies ?? [];
    const body = bodies.find((one) => one.slug === slug);
    const geoOn = (fix: Fix) => {
      if (!body || bodyAt(fix, bodies)?.slug !== slug) return null;
      return geoOfPoint(toBodyFrame(fix, body), radius);
    };

    let player: PlanetLive["player"] = null;
    const last = fixes[fixes.length - 1];
    if (last && Date.now() - last.at < LIVE_MAX_AGE_MS) {
      const here = geoOn(last);
      const previous = previousFor(last, fixes, bodies);
      const before = previous ? geoOn(previous) : null;
      if (here) {
        const moved = before ? groundDistance(before, here, radius) : 0;
        player = {
          ...here,
          heading:
            before && moved >= MIN_TRAVEL_M ? headingTo(before, here) : null,
        };
      }
    }

    const onBody = (position: PlacePosition | undefined, name: string) =>
      position?.body === slug ? { ...geoOfPoint(position, radius), name } : null;

    let target: PlanetLive["destination"] = null;
    if (destination && "slug" in destination) {
      const place = nps.data?.places.find((one) => one.slug === destination.slug);
      if (place) target = onBody(place.position, place.name);
    } else if (destination && "point" in destination) {
      target = onBody(destination.point.position, destination.point.name ?? "");
    } else if (destination && "marker" in destination) {
      // Le marqueur tel que le site le donne passe devant la copie gardée.
      const kept = destination.marker;
      const fresh = nps.data?.markers?.find((one) => one.id === kept.id);
      target = onBody(fresh?.position ?? kept.position, fresh?.name ?? kept.name);
    } else if (destination && "player" in destination) {
      target = onBody(destination.player.position, destination.player.name);
    }
    return { player, destination: target };
    // `expired` ne sert qu'à relancer le calcul quand le relevé périme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixes, destination, nps.data, slug, radius, expired]);
}
