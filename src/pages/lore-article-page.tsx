import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BackLink } from "@/components/layout/back-link";
import {
  Button,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import {
  LoreMarkdown,
  LoreThumbnail,
  lorePath,
  systemPath,
} from "@/components/lore/lore-parts";
import { getLoreArticle } from "@/lib/api/lore";

export default function LoreArticlePage() {
  const t = useTranslations("Lore");
  const { id = "" } = useParams();
  const articleQuery = useQuery({
    queryKey: ["lore-article", id],
    queryFn: () => getLoreArticle(id),
    enabled: Boolean(id),
  });
  const known = useMemo(
    () => new Set(articleQuery.data?.linked.map((entry) => entry.id)),
    [articleQuery.data],
  );

  if (articleQuery.isPending) return <LoadingState />;
  if (articleQuery.isError) {
    return (
      <>
        <BackLink to="/lore">{t("back")}</BackLink>
        <ErrorState
          error={articleQuery.error}
          onRetry={() => void articleQuery.refetch()}
        />
      </>
    );
  }

  const article = articleQuery.data;
  const subtitle = [article.type, ...article.categories]
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join(" · ");

  return (
    <>
      <BackLink to="/lore">{t("back")}</BackLink>
      <PageHeader
        title={article.title}
        description={subtitle}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void openUrl(article.rsiUrl)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("readOnRsi")}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-5 lg:col-span-2">
          <p className="text-xs text-nexus-dim">{t("englishNote")}</p>
          {article.removedAt ? (
            <p className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {t("removed")}
            </p>
          ) : null}
          <LoreMarkdown content={article.body} known={known} />
          {article.tags.length > 0 ? (
            <p className="flex flex-wrap gap-1.5 pt-1">
              {article.tags.map((tag) => (
                <Link
                  key={tag}
                  to={`/lore?q=${encodeURIComponent(tag)}`}
                  className="rounded-full bg-nexus-accent/10 px-2 py-0.5 text-[11px] text-nexus-dim hover:text-nexus-white"
                >
                  #{tag}
                </Link>
              ))}
            </p>
          ) : null}
        </Card>

        <div className="space-y-4">
          <LoreThumbnail
            src={article.thumbnailUrl}
            className="w-full rounded-xl border border-nexus-accent/12 object-cover"
          />
          {article.starmap.length > 0 ? (
            <Card className="p-5">
              <SectionTitle>{t("starmapTitle")}</SectionTitle>
              <ul className="space-y-1.5 text-sm">
                {article.starmap.map((entry) => (
                  <li key={entry.code} className="flex items-center gap-3">
                    <Link
                      to={systemPath(entry.systemCode)}
                      className="text-nexus-white hover:text-nexus-accent"
                    >
                      {entry.name}
                    </Link>
                    {entry.placeSlug ? (
                      <Link
                        to={`/places/${entry.placeSlug}`}
                        className="text-xs text-sky-300 hover:underline"
                      >
                        {t("placeLink")}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {article.linked.length > 0 ? (
            <Card className="p-5">
              <SectionTitle>{t("linkedTitle")}</SectionTitle>
              <ul className="flex flex-wrap gap-2 text-[13px]">
                {article.linked.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      to={lorePath(entry.id)}
                      className="block rounded-lg border border-nexus-accent/15 bg-[#08243a] px-2.5 py-1 text-nexus-white hover:border-nexus-accent/40"
                    >
                      {entry.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
