import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";
import { Card, SectionTitle } from "@/components/ui";
import type { PlaceLore } from "@/types/lore";
import {
  LoreThumbnail,
  lorePath,
  SensorRatings,
  systemPath,
} from "./lore-parts";

/**
 * Le lore d'un lieu, sur sa fiche : sa description de la starmap et
 * l'article de la Galactapedia qui en parle. Textes de RSI, en anglais.
 */
export function PlaceLoreSection({ lore }: { lore: PlaceLore }) {
  const t = useTranslations("Lore");
  const { starmap, article } = lore;
  return (
    <Card className="p-5">
      <SectionTitle aside={t("englishNote")}>
        {t("placeLoreTitle")}
      </SectionTitle>
      <div className="space-y-3">
        {starmap ? (
          <div className="space-y-2">
            <p className="text-xs text-sky-300/80">
              {[
                starmap.designation,
                starmap.subType,
                starmap.affiliations.join("/"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {starmap.description ? (
              <p lang="en" className="text-sm leading-relaxed text-nexus-muted">
                {starmap.description}
              </p>
            ) : null}
            <SensorRatings sensor={starmap.sensor} />
          </div>
        ) : null}
        {article ? (
          <Link
            to={lorePath(article.id)}
            className="flex gap-3 rounded-lg border border-nexus-accent/12 bg-[#08243a] p-3 transition-colors hover:border-nexus-accent/35"
          >
            <LoreThumbnail
              src={article.thumbnailUrl}
              className="size-12 shrink-0 rounded-md object-cover"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-nexus-white">
                {article.title}
              </p>
              <p lang="en" className="line-clamp-2 text-xs text-nexus-dim">
                {article.excerpt}
              </p>
              <p className="mt-1 text-xs text-sky-300">{t("readArticle")}</p>
            </div>
          </Link>
        ) : null}
        {starmap ? (
          <Link
            to={systemPath(starmap.code.split(".")[0])}
            className="inline-block text-xs text-sky-300 hover:underline"
          >
            {t("seeSystem")}
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
