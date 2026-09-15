import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
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
import {
  PLACE_TYPE_LABELS,
  type PlaceSummary,
  type PlaceType,
} from "@/types/nexus";
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
      {PLACE_TYPE_LABELS[type]}
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
  const parts: string[] = [];
  if (place.childCount) parts.push(`${place.childCount} lieu${place.childCount > 1 ? "x" : ""}`);
  if (place.shopCount) parts.push(`${place.shopCount} magasin${place.shopCount > 1 ? "s" : ""}`);
  if (place.planCount) parts.push(`${place.planCount} carte${place.planCount > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

/**
 * Un lieu dans une grille ou une liste. `current` marque celui dont la fiche
 * est ouverte : montré comme les autres, mais pas en lien vers lui-même.
 */
export function PlaceCard({
  place,
  current = false,
  trailing,
}: {
  place: PlaceSummary;
  current?: boolean;
  trailing?: ReactNode;
}) {
  const trail = placeTrail(place);
  const holdings = placeHoldings(place);

  const content = (
    <Card
      className={cn(
        "flex h-full items-center gap-3 p-3",
        current
          ? "border-nexus-accent/40"
          : "transition-colors hover:border-nexus-accent/40",
      )}
    >
      <PlaceThumbnail place={place} className="h-14 w-14" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-medium text-nexus-bright">{place.name}</p>
          <PlaceTypeBadge type={place.type} />
        </div>
        {trail ? (
          <p className="mt-0.5 truncate text-xs text-nexus-accent/50">{trail}</p>
        ) : null}
        {place.shopCategory ? (
          <p className="mt-0.5 truncate text-xs text-nexus-accent/70">
            {place.shopCategory}
          </p>
        ) : holdings ? (
          <p className="mt-0.5 truncate text-xs text-nexus-accent/70">
            {holdings}
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
