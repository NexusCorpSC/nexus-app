import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";
import {
  Building,
  Building2,
  Globe,
  LayoutGrid,
  Moon,
  Orbit,
  Rocket,
  ShoppingBag,
  Sun,
  Warehouse,
} from "lucide-react";
import { type PlaceSummary, type PlaceType } from "@/types/nexus";
import { translator } from "@/i18n/translate";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Une couleur par type. Les corps célestes tirent vers le chaud, ce qu'on
 * habite vers le bleu de l'application, et le magasin garde l'ambre qu'il a
 * sur le site — c'est ce qui rend une pastille de carte lisible d'un coup
 * d'œil sans qu'on ait à lire son libellé.
 */
export const PLACE_ACCENT: Record<PlaceType, string> = {
  star: "#F2C14E",
  planet: "#E58F65",
  moon: "#C9C2B6",
  city: "#9ED0FF",
  station: "#7FD4FF",
  outpost: "#8FB8A8",
  spaceport: "#7FA9FF",
  district: "#B4A7E8",
  building: "#A9C4D9",
  shop: "#D9A441",
};

const PLACE_ICONS: Record<PlaceType, typeof Globe> = {
  star: Sun,
  planet: Globe,
  moon: Moon,
  city: Building2,
  station: Orbit,
  outpost: Warehouse,
  spaceport: Rocket,
  district: LayoutGrid,
  building: Building,
  shop: ShoppingBag,
};

export function PlaceTypeBadge({ type }: { type: PlaceType }) {
  const t = useTranslations("Places");
  const accent = PLACE_ACCENT[type];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        color: accent,
        borderColor: `${accent}55`,
        backgroundColor: `${accent}1a`,
      }}
    >
      {t(`types.${type}`)}
    </span>
  );
}

/**
 * La vignette d'un lieu, ou l'icône de son type à défaut — et aussi quand
 * l'image refuse de se charger : elles viennent du wiki, et une image cassée
 * est pire que pas d'image.
 */
export function PlaceThumbnail({
  place,
  className,
}: {
  place: Pick<PlaceSummary, "name" | "type" | "imageUrl">;
  className?: string;
}) {
  const Icon = PLACE_ICONS[place.type];
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-nexus-abyss/60",
        className,
      )}
    >
      {place.imageUrl && !failed ? (
        <img
          src={place.imageUrl}
          alt={place.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Icon
          className="h-5 w-5"
          style={{ color: `${PLACE_ACCENT[place.type]}99` }}
        />
      )}
    </div>
  );
}

/** « Stanton › Hurston › Lorville » : d'où vient le lieu, en une ligne. */
export function placeTrail(place: PlaceSummary): string {
  return [place.systemName, place.bodyName, place.parentName]
    .filter((name, index, all) => !!name && all.indexOf(name) === index)
    .join(" › ");
}

/** Ce qu'un lieu contient, dit en clair plutôt qu'en compteurs bruts. */
function placeHoldings(place: PlaceSummary): string {
  const t = translator("Places");
  const parts: string[] = [];
  if (place.childCount) parts.push(t("holdings.places", { count: place.childCount }));
  if (place.shopCount) parts.push(t("holdings.shops", { count: place.shopCount }));
  if (place.planCount) parts.push(t("holdings.maps", { count: place.planCount }));
  return parts.join(" · ");
}

/**
 * Un lieu dans une grille (`tile`, l'image en haut) ou une liste (`row`,
 * l'image à côté). `current` marque celui dont la fiche est ouverte : montré
 * comme les autres, mais pas en lien vers lui-même.
 *
 * La vignette est partagée avec l'overlay de la carte : son allure par défaut
 * reste la sienne, on ne la retouche ici que par `className`.
 */
export function PlaceCard({
  place,
  current = false,
  trailing,
  layout = "tile",
}: {
  place: PlaceSummary;
  current?: boolean;
  trailing?: ReactNode;
  layout?: "tile" | "row";
}) {
  const t = useTranslations("Places");
  const trail = placeTrail(place);
  const holdings = placeHoldings(place);
  const detail = place.shopCategory || holdings;

  const content =
    layout === "tile" ? (
      <Card
        className={cn(
          "flex h-full flex-col overflow-hidden",
          current
            ? "border-nexus-accent/35"
            : "transition-colors hover:border-nexus-accent/35",
        )}
      >
        <PlaceThumbnail
          place={place}
          className="h-26 w-full rounded-none bg-[#08243a]"
        />
        <div className="flex min-w-0 flex-1 flex-col p-3.5">
          <p
            className="truncate text-[10.5px] font-semibold tracking-wider uppercase"
            style={{ color: `${PLACE_ACCENT[place.type]}cc` }}
          >
            {t(`types.${place.type}`)}
          </p>
          <p
            className="mt-1 truncate text-sm font-semibold text-nexus-white"
            title={place.name}
          >
            {place.name}
          </p>
          {trail ? (
            <p className="mt-0.5 truncate text-xs text-nexus-muted">{trail}</p>
          ) : null}
          {detail || trailing ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="truncate text-xs text-nexus-dim">{detail}</p>
              {trailing}
            </div>
          ) : null}
        </div>
      </Card>
    ) : (
      <Card
        className={cn(
          "flex h-full items-center gap-3 p-3",
          current
            ? "border-nexus-accent/35"
            : "transition-colors hover:border-nexus-accent/35",
        )}
      >
        <PlaceThumbnail place={place} className="h-14 w-14 bg-[#08243a]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold text-nexus-white">
              {place.name}
            </p>
            <PlaceTypeBadge type={place.type} />
          </div>
          {trail ? (
            <p className="mt-0.5 truncate text-xs text-nexus-dim">{trail}</p>
          ) : null}
          {detail ? (
            <p className="mt-0.5 truncate text-xs text-nexus-muted">
              {detail}
            </p>
          ) : null}
        </div>
        {trailing}
      </Card>
    );

  if (current) return <div className="h-full">{content}</div>;

  return (
    <Link to={`/places/${place.slug}`} className="block h-full">
      {content}
    </Link>
  );
}
