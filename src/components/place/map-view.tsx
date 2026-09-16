import { useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { PLACE_ACCENT } from "@/components/place-card";
import { useImageViewport } from "@/hooks/use-image-viewport";
import {
  isDrawnPlan,
  PLACE_SERVICE_LABELS,
  planImage,
  type PlacePlan,
  type PlacePlanMarker,
  type PlaceSummary,
} from "@/types/nexus";
import { cn } from "@/lib/utils";

/** La couleur d'un repère se déduit de ce qu'il ouvre, elle n'est pas stockée. */
function markerAccent(
  marker: PlacePlanMarker,
  targets: PlaceSummary[],
): string {
  if (marker.targetSlug) {
    const target = targets.find((entry) => entry.slug === marker.targetSlug);
    if (target) return PLACE_ACCENT[target.type];
  }
  return "#9ED0FF";
}

/** Ce qu'un repère dit de lui-même, en une ligne. */
export function markerLabel(
  marker: PlacePlanMarker,
  targets: PlaceSummary[],
): string {
  if (marker.label) return marker.label;
  if (marker.targetSlug) {
    const target = targets.find((entry) => entry.slug === marker.targetSlug);
    if (target) return target.name;
  }
  if (marker.service) return PLACE_SERVICE_LABELS[marker.service];
  return "Repère";
}

/**
 * La carte d'un lieu : une image, des repères posés dessus, et de quoi s'y
 * déplacer.
 *
 * Le piège est dans la géométrie. Les repères sont en fractions de l'image, pas
 * en pixels — mais avec `object-contain`, `x = 0.5` est le centre de la
 * **scène**, pas de l'**image**, dès que les rapports d'aspect diffèrent, et
 * tous les repères dérivent. La parade est structurelle : la couche transformée
 * contient une boîte portant le rapport d'aspect de l'image, centrée, que
 * l'image remplit exactement. Les pourcentages deviennent relatifs à l'image
 * par construction, et non par calcul qu'il faudrait tenir à jour.
 *
 * `interactive` est coupé quand la fenêtre est verrouillée : un overlay qui
 * prendrait la souris la prendrait au jeu.
 */
export function MapView({
  plan,
  targets,
  onOpenTarget,
  interactive = true,
  className,
}: {
  plan: PlacePlan;
  targets: PlaceSummary[];
  /** Descendre dans le lieu qu'un repère ouvre. Absent : le repère informe seulement. */
  onOpenTarget?: (slug: string) => void;
  interactive?: boolean;
  className?: string;
}) {
  const {
    containerRef,
    imageRef,
    view,
    isPanning,
    zoomBy,
    reset,
    stageProps,
    keyboardProps,
  } = useImageViewport({ enabled: interactive });
  const [selected, setSelected] = useState<string | null>(null);

  const active = plan.markers.find((marker) => marker.id === selected);
  /**
   * L'image de la carte, et les proportions du cadre. Un relevé dessiné dont
   * l'aperçu n'a pas abouti n'a pas d'image : on garde son emprise, pour que
   * les repères — qui sont des fractions — tombent quand même au bon endroit.
   */
  const image = planImage(plan);
  const frame = image
    ? { width: image.width, height: image.height }
    : isDrawnPlan(plan)
      ? { width: plan.widthCm, height: plan.heightCm }
      : { width: 16, height: 9 };

  return (
    <div
      ref={containerRef}
      // Le cadre lui-même prend le clavier : flèches pour déplacer, + et − pour
      // zoomer, Origine pour recentrer. Sans cela, la carte ne se lit qu'à la
      // souris — et les repères, eux, sont déjà atteignables par Tab.
      {...(interactive ? keyboardProps : null)}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "group" : undefined}
      aria-label={interactive ? `Carte : ${plan.name}` : undefined}
      className={cn(
        "relative overflow-hidden rounded-lg bg-nexus-abyss/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-nexus-accent/40",
        interactive && (isPanning ? "cursor-grabbing" : "cursor-grab"),
        className,
      )}
    >
      <div
        {...stageProps}
        className="absolute inset-0 flex items-center justify-center"
      >
        <div
          ref={imageRef}
          className="relative max-h-full max-w-full"
          style={{
            aspectRatio: `${frame.width} / ${frame.height}`,
            height: "100%",
          }}
        >
          {image ? (
            <img
              src={image.url}
              alt={plan.name}
              draggable={false}
              className="h-full w-full select-none object-contain"
            />
          ) : null}

          {plan.markers.map((marker) => {
            const accent = markerAccent(marker, targets);
            const opens = marker.targetSlug && onOpenTarget;

            return (
              <button
                key={marker.id}
                type="button"
                disabled={!interactive}
                title={markerLabel(marker, targets)}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setSelected(marker.id);
                  if (opens) onOpenTarget(marker.targetSlug!);
                }}
                className={cn(
                  // La cible de touche fait 44 px à l'écran quel que soit le
                  // zoom, sans que la pastille elle-même grossisse.
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 before:absolute before:-inset-[var(--hit)] before:content-['']",
                  marker.id === selected && "ring-2 ring-white/70",
                )}
                style={{
                  left: `${marker.x * 100}%`,
                  top: `${marker.y * 100}%`,
                  // Contre-échelle : la pastille garde sa taille à l'écran
                  // pendant que la carte grandit sous elle.
                  width: `${14 / view.scale}px`,
                  height: `${14 / view.scale}px`,
                  // Le halo de touche aussi, sinon il enfle avec le zoom et
                  // finit par avaler le déplacement de la carte. 14 px de
                  // pastille et 15 de chaque côté font les 44 promis.
                  "--hit": `${15 / view.scale}px`,
                  borderColor: accent,
                  backgroundColor: `${accent}55`,
                  // La propriété personnalisée n'est pas dans `CSSProperties`.
                } as React.CSSProperties}
              >
                <span className="sr-only">
                  {markerLabel(marker, targets)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {interactive ? (
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <ViewportButton label="Zoomer" onClick={() => zoomBy(1.2)}>
            <ZoomIn className="h-3.5 w-3.5" />
          </ViewportButton>
          <ViewportButton label="Dézoomer" onClick={() => zoomBy(1 / 1.2)}>
            <ZoomOut className="h-3.5 w-3.5" />
          </ViewportButton>
          <ViewportButton label="Recentrer" onClick={reset}>
            <Maximize2 className="h-3.5 w-3.5" />
          </ViewportButton>
        </div>
      ) : null}

      {active ? (
        <div className="absolute inset-x-2 bottom-2 rounded-md bg-nexus-abyss/85 px-3 py-2 text-xs text-nexus-accent/80 backdrop-blur-sm">
          <p className="font-medium text-nexus-bright">
            {markerLabel(active, targets)}
          </p>
          {active.note ? <p className="mt-0.5">{active.note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ViewportButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className="rounded-md border border-nexus-accent/20 bg-nexus-abyss/80 p-1.5 text-nexus-accent/70 transition-colors hover:border-nexus-accent/40 hover:text-nexus-bright"
    >
      {children}
    </button>
  );
}

/**
 * Les repères sous la carte, en liste.
 *
 * Une disposition spatiale n'apprend rien à un lecteur d'écran ; cette liste
 * si. Elle sert aussi de légende à qui cherche un service sans vouloir balayer
 * l'image du regard.
 */
export function MapLegend({
  plan,
  targets,
  onOpenTarget,
}: {
  plan: PlacePlan;
  targets: PlaceSummary[];
  onOpenTarget?: (slug: string) => void;
}) {
  if (plan.markers.length === 0) {
    return (
      <p className="text-xs text-nexus-accent/50">
        Aucun repère posé sur cette carte.
      </p>
    );
  }

  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {plan.markers.map((marker) => {
        const accent = markerAccent(marker, targets);
        const label = markerLabel(marker, targets);
        const opens = marker.targetSlug && onOpenTarget;

        return (
          <li key={marker.id}>
            <button
              type="button"
              disabled={!opens}
              onClick={() => opens && onOpenTarget(marker.targetSlug!)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs",
                opens
                  ? "text-nexus-accent/80 transition-colors hover:bg-white/5 hover:text-nexus-bright"
                  : "text-nexus-accent/60",
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border"
                style={{ borderColor: accent, backgroundColor: `${accent}55` }}
              />
              <span className="truncate">{label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
