import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Crosshair, Gem, Package, Plane } from "lucide-react";
import { useTranslations } from "use-intl";
import { type ItemKind, type ItemSummary } from "@/types/nexus";
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
  const tKinds = useTranslations("Items.kinds");
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
      {tKinds(kind)}
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
          className="size-6"
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
 * A catalogue object in a grid (`tile`, picture on top) or a related-objects
 * list (`row`, picture beside). `current` marks the one whose fiche is open:
 * shown like the others, but not a link to itself.
 */
export function ItemCard({
  item,
  current = false,
  trailing,
  layout = "tile",
}: {
  item: ItemSummary;
  current?: boolean;
  trailing?: ReactNode;
  layout?: "tile" | "row";
}) {
  const t = useTranslations("Items.card");
  const tKinds = useTranslations("Items.kinds");
  const subtitle = [item.category, item.subcategory]
    .filter(Boolean)
    .join(" · ");
  const detail = item.variantName
    ? t("variant", { name: item.variantName })
    : item.setName
      ? t("set", { name: item.setName })
      : item.manufacturer;

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
        <ItemThumbnail
          item={item}
          className="h-26 w-full rounded-none bg-[#08243a]"
        />
        <div className="flex min-w-0 flex-1 flex-col p-3.5">
          <p
            className="truncate text-[10.5px] font-semibold tracking-wider uppercase"
            style={{ color: `${KIND_ACCENT[item.kind]}cc` }}
          >
            {tKinds(item.kind)}
            {subtitle ? (
              <span className="text-sky-300/60"> · {subtitle}</span>
            ) : null}
          </p>
          <p
            className="mt-1 truncate text-sm font-semibold text-nexus-white"
            title={item.name}
          >
            {item.name}
          </p>
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
        <ItemThumbnail item={item} className="h-14 w-14 bg-[#08243a]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold text-nexus-white">
              {item.name}
            </p>
            <KindBadge kind={item.kind} />
          </div>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-nexus-dim">
              {subtitle}
            </p>
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

  if (current) {
    return <div className="h-full">{content}</div>;
  }

  return (
    <Link to={`/items/${item.slug}`} className="block h-full">
      {content}
    </Link>
  );
}
