import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getBlueprint } from "@/lib/api/blueprints";
import { BlueprintOrgOwners } from "@/components/blueprint-org-owners";
import {
  BlueprintAddButton,
  BlueprintRemoveButton,
} from "@/components/blueprint-ownership-buttons";
import { getApiBaseUrl } from "@/lib/settings";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { formatDuration } from "@/lib/utils";

export default function BlueprintDetailPage() {
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
      <ErrorState
        error={blueprintQuery.error}
        onRetry={() => void blueprintQuery.refetch()}
      />
    );
  }

  const blueprint = blueprintQuery.data;

  return (
    <>
      <Link
        to="/blueprints"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-nexus-accent/60 transition-colors hover:text-nexus-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Retour aux blueprints
      </Link>

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

            <Button variant="ghost" size="sm" onClick={() => void openOnWeb()}>
              <ExternalLink className="h-3.5 w-3.5" />
              Ouvrir sur le web
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {blueprint.description ? (
            <Card className="p-5">
              <h2 className="mb-2 text-sm font-semibold text-nexus-bright">
                Description
              </h2>
              <p className="text-sm leading-relaxed text-nexus-accent/75">
                {blueprint.description}
              </p>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-nexus-bright">
              Recette
            </h2>

            {blueprint.recipe?.components?.length ? (
              <ul className="space-y-3">
                {blueprint.recipe.components.map((component, index) => (
                  <li
                    key={`${component.name}-${index}`}
                    className="rounded-lg border border-nexus-accent/10 bg-nexus-abyss/40 p-3"
                  >
                    <p className="text-sm font-medium text-nexus-bright">
                      {component.name}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {component.options.map((option, optionIndex) => (
                        <li
                          key={`${option.name}-${optionIndex}`}
                          className="flex items-center justify-between text-xs text-nexus-accent/70"
                        >
                          <span>{option.name}</span>
                          <span className="text-nexus-accent/50">
                            ×{option.quantity}
                            {option.minQuality
                              ? ` · qualité ≥ ${option.minQuality}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-nexus-accent/50">
                Aucune recette renseignée pour ce blueprint.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-nexus-bright">
              Fiche
            </h2>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-nexus-accent/50">Temps de fabrication</dt>
                <dd className="text-nexus-bright/85">
                  {formatDuration(
                    blueprint.craftingTime ?? blueprint.recipe?.craftingTime,
                  )}
                </dd>
              </div>
              {blueprint.tier !== undefined ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-nexus-accent/50">Tier</dt>
                  <dd className="text-nexus-bright/85">{blueprint.tier}</dd>
                </div>
              ) : null}
              {blueprint.owned !== undefined ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-nexus-accent/50">Possession</dt>
                  <dd>
                    <Badge tone={blueprint.owned ? "success" : "default"}>
                      {blueprint.owned ? "Possédé" : "Non possédé"}
                    </Badge>
                  </dd>
                </div>
              ) : null}
            </dl>
          </Card>

          {blueprint.statistics &&
          Object.keys(blueprint.statistics).length > 0 ? (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-nexus-bright">
                Statistiques
              </h2>
              <dl className="space-y-2 text-xs">
                {Object.entries(blueprint.statistics).map(([name, stat]) => (
                  <div key={name} className="flex justify-between gap-3">
                    <dt className="text-nexus-accent/50">{name}</dt>
                    <dd className="text-nexus-bright/85">
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
              <h2 className="mb-2 text-sm font-semibold text-nexus-bright">
                Obtention
              </h2>
              <p className="text-xs leading-relaxed text-nexus-accent/70">
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
