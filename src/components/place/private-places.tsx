import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";
import { Compass, Lock, Users } from "lucide-react";
import { setDestination } from "@/lib/nps-destination";
import { showOverlay } from "@/lib/windows";
import { PlaceThumbnail } from "@/components/place-card";
import { Button } from "@/components/ui";
import type { PrivatePlaceSummary } from "@/types/nexus";

/** La couleur de tout ce qui est privé, comme sur le site. */
export const PRIVATE_ACCENT = "#c4b2ff";

/** « NXS » quand l'organisation le voit, « Moi seul » sinon. */
export function PrivatePlaceBadge({
  org,
}: {
  org?: PrivatePlaceSummary["org"];
}) {
  const t = useTranslations("Places.private");
  const Icon = org ? Users : Lock;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{
        color: PRIVATE_ACCENT,
        borderColor: `${PRIVATE_ACCENT}55`,
        backgroundColor: `${PRIVATE_ACCENT}14`,
      }}
      title={org ? t("sharedWith", { org: org.name }) : t("onlyMe")}
    >
      <Icon className="size-3" />
      {org ? (org.tag ?? org.name) : t("onlyMe")}
    </span>
  );
}

/** Choisir un lieu comme destination affiche la fenêtre qui y guide. */
export function guideTo(slug: string) {
  void setDestination({ slug }).then(() => showOverlay("nps"));
}

/**
 * « Mes lieux privés », au-dessus du catalogue : les siens et ceux de ses
 * organisations, avec de quoi s'y faire guider quand ils ont une position.
 */
export function PrivatePlacesSection({
  places,
}: {
  places: PrivatePlaceSummary[];
}) {
  const t = useTranslations("Places");
  if (places.length === 0) return null;

  return (
    <section className="mb-6">
      <p
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: PRIVATE_ACCENT }}
      >
        {t("private.section", { count: places.length })}
      </p>
      <ul
        className="divide-y overflow-hidden rounded-xl border bg-nexus-card/60"
        style={{ borderColor: `${PRIVATE_ACCENT}40` }}
      >
        {places.map((place) => (
          <li
            key={place.slug}
            className="flex items-center gap-3 px-3 py-2.5"
            // Les séparateurs suivent la bordure.
            style={{ borderColor: `${PRIVATE_ACCENT}26` }}
          >
            <Link
              to={`/places/${place.slug}`}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition-colors hover:text-nexus-accent"
            >
              <PlaceThumbnail
                place={place}
                className="h-10 w-12 border border-dashed"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-nexus-white">
                  {place.name}
                </span>
                <span className="block truncate text-xs text-nexus-dim">
                  {[t(`types.${place.type}`), place.parentName]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </Link>
            <PrivatePlaceBadge org={place.org} />
            {place.position ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => guideTo(place.slug)}
              >
                <Compass className="h-3.5 w-3.5" />
                {t("private.guide")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
