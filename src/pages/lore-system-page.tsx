import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { BackLink } from "@/components/layout/back-link";
import {
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import {
  LoreArticleCard,
  lorePath,
  SensorRatings,
  systemPath,
} from "@/components/lore/lore-parts";
import { getStarSystem } from "@/lib/api/lore";

/** Un système de la starmap de RSI : description, points de saut, corps. */
export default function LoreSystemPage() {
  const t = useTranslations("Lore");
  const { code = "" } = useParams();
  const systemQuery = useQuery({
    queryKey: ["lore-system", code],
    queryFn: () => getStarSystem(code),
    enabled: Boolean(code),
  });

  if (systemQuery.isPending) return <LoadingState />;
  if (systemQuery.isError) {
    return (
      <>
        <BackLink to="/lore">{t("back")}</BackLink>
        <ErrorState
          error={systemQuery.error}
          onRetry={() => void systemQuery.refetch()}
        />
      </>
    );
  }

  const system = systemQuery.data;
  const status = t(
    system.status === "P"
      ? "statusP"
      : system.status === "M"
        ? "statusM"
        : "statusN",
  );

  return (
    <>
      <BackLink to="/lore">{t("back")}</BackLink>
      <PageHeader
        title={t("systemTitle", { name: system.name })}
        description={[system.affiliations.join("/"), status]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="space-y-4">
        <Card className="space-y-3 p-5">
          <SensorRatings sensor={system.sensor} />
          {system.description ? (
            <p lang="en" className="text-sm leading-relaxed text-nexus-muted">
              {system.description}
            </p>
          ) : null}
          {system.placeSlug ? (
            <Link
              to={`/places/${system.placeSlug}`}
              className="inline-block text-sm text-sky-300 hover:underline"
            >
              {t("placeLink")}
            </Link>
          ) : null}
        </Card>

        {system.article ? (
          <section>
            <SectionTitle>{t("galactapedia")}</SectionTitle>
            <LoreArticleCard article={system.article} />
          </section>
        ) : null}

        {system.jumpPoints && system.jumpPoints.length > 0 ? (
          <section>
            <SectionTitle>{t("jumpPointsTitle")}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {system.jumpPoints.map((jump) => (
                <Link
                  key={jump.to}
                  to={systemPath(jump.to)}
                  className="rounded-lg border border-nexus-accent/20 bg-nexus-card px-2.5 py-1 text-[13px] text-nexus-white hover:border-nexus-accent/40"
                >
                  {jump.toName ?? jump.to}
                  {jump.size ? (
                    <span className="ml-1.5 text-xs text-nexus-dim">
                      {jump.size}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <SectionTitle aside={system.bodies.length || undefined}>
            {t("bodiesTitle")}
          </SectionTitle>
          {system.bodies.length === 0 ? (
            <p className="text-sm text-nexus-dim">{t("noBodies")}</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {system.bodies.map((body) => (
                <Card key={body.code} className="space-y-1.5 p-4">
                  <p className="font-semibold text-nexus-white">
                    {body.name}
                    {body.designation ? (
                      <span className="ml-1.5 text-sm font-normal text-nexus-dim">
                        {body.designation}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-sky-300/80">
                    {[
                      body.subType ?? body.type,
                      body.habitable ? t("habitable") : "",
                      body.affiliations.join("/"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {body.description ? (
                    <p
                      lang="en"
                      className="text-sm leading-relaxed text-nexus-muted"
                    >
                      {body.description}
                    </p>
                  ) : null}
                  {body.articleId || body.placeSlug ? (
                    <p className="flex gap-3 text-sm">
                      {body.articleId ? (
                        <Link
                          to={lorePath(body.articleId)}
                          className="text-sky-300 hover:underline"
                        >
                          {t("articleLink")}
                        </Link>
                      ) : null}
                      {body.placeSlug ? (
                        <Link
                          to={`/places/${body.placeSlug}`}
                          className="text-sky-300 hover:underline"
                        >
                          {t("placeLink")}
                        </Link>
                      ) : null}
                    </p>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
