import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Crosshair, Gem, Package, Plane } from "lucide-react";
import {
  ITEM_KIND_LABELS,
  type ItemKind,
  type ItemSummary,
} from "@/types/nexus";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

/** One colour per kind, the same ones the website gives its fiches. */
export const KIND_ACCENT: Record<ItemKind, string> = {
  item: "#9ED0FF",
  vehicle: "#7FD4FF",
  weapon: "#E8472B",
  resource: "#D9A441",
};

const KIND_ICONS: Record<ItemKind, typeof Package> = {
  item: Package,
  vehicle: Plane,
  weapon: Crosshair,
  resource: Gem,
};

export function KindBadge({ kind }: { kind: ItemKind }) {
  const accent = KIND_ACCENT[kind];
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        color: accent,
        borderColor: `${accent}55`,
        backgroundColor: `${accent}1a`,
      }}
    >
      {ITEM_KIND_LABELS[kind]}
    </span>
  );
}

/**
 * The picture of an object, or the icon of its kind when it has none — or when
 * the picture cannot be fetched: most of them live on the sources' own CDNs,
 * and a broken image is worse than no image.
 */
export function ItemThumbnail({
  item,
  className,
}: {
  item: Pick<ItemSummary, "name" | "kind" | "imageUrl">;
  className?: string;
}) {
  const Icon = KIND_ICONS[item.kind];
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-nexus-abyss/60",
        className,
      )}
    >
      {item.imageUrl && !failed ? (
        <img
          src={item.imageUrl}
          alt={item.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Icon
          className="h-5 w-5"
          style={{ color: `${KIND_ACCENT[item.kind]}99` }}
        />
      )}
    </div>
  );
}

/** The picture at the top of a fiche; nothing at all when it cannot load. */
export function ItemHeroImage({
  item,
}: {
  item: Pick<ItemSummary, "name" | "imageUrl">;
}) {
  const [failed, setFailed] = useState(false);
  if (!item.imageUrl || failed) return null;
  return (
    <Card className="overflow-hidden">
      <img
        src={item.imageUrl}
        alt={item.name}
        onError={() => setFailed(true)}
        className="max-h-80 w-full object-cover"
      />
    </Card>
  );
}

/**
 * A catalogue object in a grid or a related-objects list. `current` marks the
 * one whose fiche is open: shown like the others, but not a link to itself.
 */
export function ItemCard({
  item,
  current = false,
  trailing,
}: {
  item: ItemSummary;
  current?: boolean;
  trailing?: ReactNode;
}) {
  const subtitle = [item.category, item.subcategory]
    .filter(Boolean)
    .join(" · ");
  const detail = item.variantName
    ? `Variante : ${item.variantName}`
    : item.setName
      ? `Ensemble : ${item.setName}`
      : item.manufacturer;

  const content = (
    <Card
      className={cn(
        "flex h-full items-center gap-3 p-3",
        current
          ? "border-nexus-accent/40"
          : "transition-colors hover:border-nexus-accent/40",
      )}
    >
      <ItemThumbnail item={item} className="h-14 w-14" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-medium text-nexus-bright">{item.name}</p>
          <KindBadge kind={item.kind} />
        </div>
        {subtitle ? (
          <p className="mt-0.5 truncate text-xs text-nexus-accent/50">
            {subtitle}
          </p>
        ) : null}
        {detail ? (
          <p className="mt-0.5 truncate text-xs text-nexus-accent/70">
            {detail}
          </p>
        ) : null}
      </div>
      {trailing}
    </Card>
  );

  if (current) {
    return <div className="h-full">{content}</div>;
  }

  return (
    <Link to={`/items/${item.slug}`} className="block h-full">
      {content}
    </Link>
  );
}
