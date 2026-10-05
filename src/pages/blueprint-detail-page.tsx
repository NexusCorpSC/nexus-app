import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { BackLink } from "@/components/layout/back-link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getBlueprint } from "@/lib/api/blueprints";
import { BlueprintOrgOwners } from "@/components/blueprint-org-owners";
import {
  BlueprintAddButton,
  BlueprintRemoveButton,
} from "@/components/blueprint-ownership-buttons";
import { getApiBaseUrl } from "@/lib/settings";
import {
  Button,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import { formatDuration } from "@/lib/utils";

export default function BlueprintDetailPage() {
  const t = useTranslations("Blueprints.detail");
  const { slug = "" } = useParams();

  const blueprintQuery = useQuery({
    queryKey: ["blueprint", slug],
    queryFn: () => getBlueprint(slug),
    enabled: Boolean(slug),
  });

  async function openOnWeb() {
    const baseUrl = await getApiBaseUrl();
    await openUrl(`${baseUrl}/crafting/blueprints/${slug}`);
  }

  if (blueprintQuery.isPending) return <LoadingState />;

  if (blueprintQuery.isError) {
    return (
      <>
        <BackLink to="/blueprints">{t("back")}</BackLink>
        <ErrorState
          error={blueprintQuery.error}
          onRetry={() => void blueprintQuery.refetch()}
        />
      </>
    );
  }

  const blueprint = blueprintQuery.data;

  const craftingTime = blueprint.craftingTime ?? blueprint.recipe?.craftingTime;
  const statistics = blueprint.statistics
    ? Object.entries(blueprint.statistics)
    : [];

  return (
    <>
      <BackLink to="/blueprints">{t("back")}</BackLink>

      <PageHeader
        title={blueprint.name}
        description={[blueprint.category, blueprint.subcategory]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {/* `owned` only comes back for a signed-in caller, so its absence
                is «nobody to change it for». A default blueprint is owned by
                everyone: nothing to add, and nothing to take back. */}
            {blueprint.owned === false ? (
              <BlueprintAddButton blueprintId={blueprint.id} />
            ) : blueprint.owned === true && !blueprint.isDefault ? (
              <BlueprintRemoveButton blueprintId={blueprint.id} />
            ) : null}

            <Button
              variant="outline"
              size="sm"
              onClick={() => void openOnWeb()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("openOnWeb")}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FactTile label={t("craftingTime")} value={formatDuration(craftingTime)} />
        {blueprint.tier !== undefined ? (
          <FactTile label={t("tier")} value={blueprint.tier} />
        ) : null}
        {blueprint.owned !== undefined ? (
          <FactTile
            label={t("ownership")}
            value={
              blueprint.owned ? (
                <span className="text-emerald-300">{t("owned")}</span>
              ) : (
                t("notOwned")
              )
            }
          />
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {blueprint.imageUrl || blueprint.description ? (
            <Card className="overflow-hidden">
              {blueprint.imageUrl ? (
                <div className="h-48 bg-[#08243a]">
                  <img
                    src={blueprint.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : null}
              {blueprint.description ? (
                <div className="p-5">
                  <SectionTitle>{t("description")}</SectionTitle>
                  <p className="text-sm leading-relaxed text-nexus-muted">
                    {blueprint.description}
                  </p>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card className="p-5">
            <SectionTitle>{t("recipe")}</SectionTitle>

            {blueprint.recipe?.components?.length ? (
              <ul className="divide-y divide-nexus-accent/8">
                {blueprint.recipe.components.map((component, index) => (
                  <li
                    key={`${component.name}-${index}`}
                    className="py-3 first:pt-0 last:pb-0"
                  >
                    <p className="text-sm font-semibold text-nexus-white">
                      {component.name}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {component.options.map((option, optionIndex) => (
                        <li
                          key={`${option.name}-${optionIndex}`}
                          className="flex items-center justify-between gap-3 text-xs text-nexus-muted"
                        >
                          <span>{option.name}</span>
                          <span className="font-mono text-nexus-dim">
                            ×{option.quantity}
                            {option.minQuality
                              ? ` · ${t("minQuality", { quality: option.minQuality })}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-nexus-dim">
                {t("noRecipe")}
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {statistics.length > 0 ? (
            <Card className="p-5">
              <SectionTitle>{t("statistics")}</SectionTitle>
              <dl className="divide-y divide-nexus-accent/8 text-xs">
                {statistics.map(([name, stat]) => (
                  <div
                    key={name}
                    className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <dt className="text-nexus-dim">{name}</dt>
                    <dd className="text-nexus-white">
                      {stat.value}
                      {stat.unit ? ` ${stat.unit}` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}

          {blueprint.obtention ? (
            <Card className="p-5">
              <SectionTitle>{t("obtention")}</SectionTitle>
              <p className="text-xs leading-relaxed text-nexus-muted">
                {blueprint.obtention}
              </p>
            </Card>
          ) : null}

          <BlueprintOrgOwners blueprintId={blueprint.id} />
        </div>
      </div>
    </>
  );
}

/** One key fact of the blueprint: a small label over its value. */
function FactTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="px-3.5 py-3">
      <p className="text-[10.5px] font-semibold tracking-wider text-nexus-dim uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-nexus-white">{value}</p>
    </Card>
  );
}
