import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { getNpsData } from "@/lib/api/nps";
import {
  onDestinationChange,
  readNpsDestination,
  type NpsDestination,
} from "@/lib/nps-destination";
import { bodyAt, MIN_TRAVEL_M, toBodyFrame, type Fix } from "@/lib/nps";
import {
  geoOfPoint,
  groundDistance,
  headingTo,
  type LatLon,
} from "@/lib/planet-map-geometry";

/** Les relevés du NPS, que Rust envoie à toutes les fenêtres (`nps.rs`). */
const POSITION_EVENT = "nps://position";

/** Au-delà, un relevé ne dit plus où l'on est. */
const LIVE_MAX_AGE_MS = 10 * 60 * 1000;

export type PlanetLive = {
  /** Le joueur, s'il est sur ce corps et que son dernier relevé est récent. */
  player: (LatLon & { alt: number; heading: number | null }) | null;
  /** La destination du NPS, si elle est sur ce corps. */
  destination: (LatLon & { name: string }) | null;
};

/**
 * Où en est le joueur sur une planète ou une lune : son dernier relevé de
 * `/showlocation`, ramené dans le repère du corps, et la destination du NPS
 * quand elle s'y trouve. Le cap vient des deux derniers relevés, s'ils sont
 * assez éloignés pour dire dans quel sens on va.
 */
export function usePlanetLive(slug: string, radius: number): PlanetLive {
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [destination, setDestination] = useState<NpsDestination | null>(null);
  const nps = useQuery({ queryKey: ["nps"], queryFn: getNpsData });

  useEffect(() => {
    const pending = listen<Fix>(POSITION_EVENT, (event) => {
      setFixes((last) => [...last.slice(-1), event.payload]);
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
      const before = fixes.length > 1 ? geoOn(fixes[0]) : null;
      if (here) {
        const moved = before ? groundDistance(before, here, radius) : 0;
        player = {
          ...here,
          heading: before && moved >= MIN_TRAVEL_M ? headingTo(before, here) : null,
        };
      }
    }

    let target: PlanetLive["destination"] = null;
    if (destination && "slug" in destination) {
      const place = nps.data?.places.find((one) => one.slug === destination.slug);
      if (place?.position.body === slug) {
        target = { ...geoOfPoint(place.position, radius), name: place.name };
      }
    } else if (destination && "point" in destination) {
      const { position, name } = destination.point;
      if (position.body === slug) {
        target = { ...geoOfPoint(position, radius), name: name ?? "" };
      }
    }
    return { player, destination: target };
  }, [fixes, destination, nps.data, slug, radius]);
}
