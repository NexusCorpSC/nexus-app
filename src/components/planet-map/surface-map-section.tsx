import { useEffect, useState } from "react";
import { Map as MapIcon, Pin } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button, Card, SectionTitle } from "@/components/ui";
import { PlanetMap } from "@/components/planet-map/planet-map";
import { usePlanetLive } from "@/hooks/use-planet-live";
import {
  onPinnedMapChange,
  pinMap,
  readPinnedMap,
  showMapOverlay,
} from "@/lib/pinned-map";
import type { PlanetMapResponse } from "@/types/planet-maps";

/**
 * La carte de surface dans la fiche d'une planète ou d'une lune : le relief,
 * les lieux, les marqueurs, le joueur s'il y est. « Afficher en overlay »
 * l'épingle comme un plan : l'overlay Carte la montre alors en jeu, en mode
 * planète.
 */
export function SurfaceMapSection({
  slug,
  data,
}: {
  slug: string;
  data: PlanetMapResponse;
}) {
  const t = useTranslations("PlanetMap");
  const live = usePlanetLive(slug, data.manifest.radius);
  const [pinned, setPinned] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void readPinnedMap().then((value) => {
        if (alive) setPinned(value);
      });
    refresh();
    const pending = onPinnedMapChange(refresh);
    return () => {
      alive = false;
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  const isPinned = pinned === slug;

  return (
    <Card className="p-5">
      <SectionTitle
        aside={t("relief", {
          min: data.manifest.reliefMin,
          max: data.manifest.reliefMax,
        })}
      >
        {t("title")}
      </SectionTitle>
      <PlanetMap map={data} points={data.points} live={live} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const next = isPinned ? null : slug;
            setPinned(next);
            void pinMap(next);
            if (next) void showMapOverlay();
          }}
        >
          {isPinned ? (
            <>
              <Pin className="h-3.5 w-3.5" />
              {t("unpin")}
            </>
          ) : (
            <>
              <MapIcon className="h-3.5 w-3.5" />
              {t("pin")}
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
