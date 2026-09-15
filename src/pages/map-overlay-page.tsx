import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Map as MapIcon, Search, X } from "lucide-react";

import { OverlayLockButton } from "@/components/overlay-lock-button";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { MapView } from "@/components/place/map-view";
import { PlaceThumbnail } from "@/components/place-card";
import { useDebounced } from "@/hooks/use-debounced";
import { useOverlayLocked } from "@/hooks/use-overlay-lock";
import { useOverlayMode } from "@/hooks/use-overlay-opacity";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { getPlacePlans, listPlaces } from "@/lib/api/places";
import { overlaySkin } from "@/lib/overlay-opacity";
import { onPinnedMapChange, pinMap, readPinnedMap } from "@/lib/pinned-map";
import { cn } from "@/lib/utils";
import { PLACE_TYPE_LABELS } from "@/types/nexus";

/**
 * La carte d'un lieu, par-dessus le jeu.
 *
 * « Carte » et non « plan » : le site appelle plan le relevé d'un lieu, mais ce
 * mot désigne déjà ici le plan de vol d'une escouade. Le libellé de fenêtre
 * reste `map`, comme ses voisines ; c'est l'utilisateur qui lit « Carte ».
 *
 * Le lieu montré ne se choisit pas seulement d'ici. Taper une recherche
 * par-dessus le jeu est pénible, et verrouillée cette fenêtre ne prend même
 * plus la souris : on épingle au calme depuis la fiche d'un lieu, et la
 * fenêtre suit. Le sélecteur reste là pour le cas où l'on est déjà dedans.
 *
 * Verrouillée, c'est une image que le curseur traverse — donc le visualiseur
 * est coupé et le sélecteur fermé : une fenêtre qui prendrait la souris la
 * prendrait au jeu.
 *
 * Ce que la v1 ne fait pas : descendre dans le lieu qu'un repère ouvre. La
 * fiche le fait, et ici cela demanderait de savoir repère par repère si la
 * cible a une carte — sans quoi on offrirait un bouton qui ne fait rien.
 */
export default function MapOverlayPage() {
  useTransparentWindow();

  const mode = useOverlayMode("map");
  const locked = useOverlayLocked("map");

  const [slug, setSlug] = useState<string | null>(null);
  /** Tant que l'épingle n'est pas lue, « aucune carte » serait un mensonge. */
  const [read, setRead] = useState(false);
  const [picking, setPicking] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // L'épingle vit dans le magasin, et cette fenêtre est créée au démarrage :
  // sans l'événement elle montrerait, toute la session, ce qui était épinglé
  // à ce moment-là.
  useEffect(() => {
    let alive = true;

    function refresh() {
      void readPinnedMap()
        .then((pinned) => {
          if (!alive) return;
          setSlug(pinned);
          setRead(true);
        })
        .catch((error) => console.error("cannot read the pinned map", error));
    }

    refresh();
    const pending = onPinnedMapChange(refresh);

    return () => {
      alive = false;
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  const query = useQuery({
    queryKey: ["place-plans", slug],
    queryFn: () => getPlacePlans(slug ?? ""),
    enabled: Boolean(slug),
  });

  const plans = query.data?.plans ?? [];
  // Un identifiant qui ne correspond plus — on a changé de lieu — retombe sur
  // la première carte de lui-même, sans effet à écrire ni à nettoyer.
  const active = plans.find((plan) => plan.id === activeId) ?? plans[0];

  // Verrouiller referme le sélecteur pour de bon. Le dériver de `locked`
  // seulement le cacherait : il reviendrait au déverrouillage, alors qu'on
  // avait verrouillé pour rendre la fenêtre au jeu.
  useEffect(() => {
    if (locked) setPicking(false);
  }, [locked]);

  const open = picking && !locked;

  function close() {
    void invoke("close_map_overlay");
  }

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden",
        overlaySkin(mode),
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();

        if (open) setPicking(false);
        else close();
      }}
    >
      {/* Sans décorations, l'en-tête tient lieu de barre de titre. */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex shrink-0 cursor-grab items-center gap-2 px-3 py-2",
          mode === "opaque" ? "border-b border-white/10" : null,
        )}
      >
        <MapIcon className="pointer-events-none size-4 shrink-0 text-slate-400" />

        <div className="pointer-events-none min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">
            {query.data?.name ?? "Carte"}
          </p>
          {query.data && query.data.ancestors.length > 0 ? (
            <p className="truncate text-[11px] text-slate-400">
              {query.data.ancestors.map((one) => one.name).join(" › ")}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setPicking(!open)}
          title="Choisir un lieu"
          aria-pressed={open}
          className={cn(
            "shrink-0 rounded p-1 transition hover:bg-white/10",
            open
              ? "bg-white/10 text-slate-100"
              : "text-slate-400 hover:text-slate-100",
          )}
        >
          <span className="sr-only">Choisir un lieu</span>
          <Search className="size-4" />
        </button>

        <OverlayOpacityButton label="map" mode={mode} />
        <OverlayLockButton label="map" locked={locked} />

        <button
          type="button"
          onClick={close}
          title="Fermer"
          className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        >
          <span className="sr-only">Fermer</span>
          <X className="size-4" />
        </button>
      </div>

      {plans.length > 1 && !open ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto px-3 pb-2">
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setActiveId(plan.id)}
              className={cn(
                "shrink-0 rounded px-2 py-0.5 text-[11px] transition",
                plan.id === active?.id
                  ? "bg-white/10 text-slate-100"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
              )}
            >
              {plan.name}
            </button>
          ))}
        </div>
      ) : null}

      {open ? (
        <PlacePicker
          onPick={(picked) => {
            setPicking(false);
            void pinMap(picked);
          }}
        />
      ) : !read || (slug && query.isPending) ? (
        <Note>…</Note>
      ) : !slug ? (
        <Note>
          Aucune carte épinglée. Épinglez-en une depuis la fiche d'un lieu, ou
          choisissez ici.
        </Note>
      ) : query.isError ? (
        <Note>
          La carte n'a pas pu être chargée.
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="ml-1 underline underline-offset-2 hover:text-slate-200"
          >
            Réessayer
          </button>
        </Note>
      ) : !active ? (
        <Note>Ce lieu n'a pas encore été relevé.</Note>
      ) : (
        <MapView
          plan={active}
          targets={query.data?.targets ?? []}
          interactive={!locked}
          className="min-h-0 flex-1"
        />
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-slate-400">
      <p>{children}</p>
    </div>
  );
}

/**
 * De quoi changer de lieu sans quitter la fenêtre.
 *
 * Les lieux sans relevé sont montrés mais éteints : les taire ferait d'une
 * recherche pourtant juste un résultat vide, ce qui ne s'explique pas.
 */
function PlacePicker({ onPick }: { onPick: (slug: string) => void }) {
  const [search, setSearch] = useState("");
  const query = useDebounced(search);

  const results = useQuery({
    queryKey: ["place-picker", query],
    queryFn: () => listPlaces({ query: query || undefined, limit: 8 }),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      <input
        autoFocus
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Nom d'un lieu…"
        className="shrink-0 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
      />

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {results.isPending ? (
          <p className="px-1 py-2 text-[12px] text-slate-500">…</p>
        ) : results.isError ? (
          <p className="px-1 py-2 text-[12px] text-slate-500">
            La recherche a échoué.
          </p>
        ) : results.data.places.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-slate-500">
            Aucun lieu trouvé.
          </p>
        ) : (
          results.data.places.map((place) => {
            const surveyed = Boolean(place.planCount);

            return (
              <button
                key={place.id}
                type="button"
                disabled={!surveyed}
                onClick={() => onPick(place.slug)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
                  surveyed
                    ? "hover:bg-white/10"
                    : "cursor-default opacity-40",
                )}
              >
                <PlaceThumbnail place={place} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-slate-100">
                    {place.name}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {surveyed
                      ? [place.systemName, place.bodyName, place.parentName]
                          .filter(
                            (name, index, all) =>
                              !!name && all.indexOf(name) === index,
                          )
                          .join(" › ") || PLACE_TYPE_LABELS[place.type]
                      : "Pas encore relevé"}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
