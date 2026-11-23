import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Crosshair, Maximize2, Minus, Plus } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";
import { createMarker, markerErrorMessage } from "@/lib/api/markers";
import { markersChanged } from "@/hooks/use-markers-sync";
import type { PlanetLive } from "@/hooks/use-planet-live";
import {
  altitudeAt,
  loadAltitude,
  formatDistance,
  formatLatLon,
  groundDistance,
  headingTo,
  planetMapUrl,
  pointOfGeo,
  wrapLon,
  type AltitudeGrid,
  type LatLon,
} from "@/lib/planet-map-geometry";
import { cn } from "@/lib/utils";
import { MARKER_KINDS, type MarkerKind } from "@/types/markers";
import type { PlanetMap as PlanetMapData, PlanetMapPoint } from "@/types/planet-maps";

type Spot = LatLon & { alt: number | null };
type Menu = Spot & { x: number; y: number };
type Kinds = Record<PlanetMapPoint["kind"], boolean>;

const PANEL = "rounded-nexus-sm border border-nexus-accent/12 bg-nexus-card/92";
const PLAYER_COLOR = "#6ee7b7";

/**
 * La carte de surface d'une planète ou d'une lune, comme sur le site : le
 * relief en tuiles, les lieux, les lieux privés et les marqueurs du joueur.
 * L'app y ajoute le joueur lui-même, d'après le NPS, et la destination qu'il
 * suit.
 *
 * Même géométrie que le site (`lib/planet-map-geometry.ts`, une copie) :
 * Leaflet en `CRS.EPSG4326`, une position se pose en latitude et longitude.
 *
 * `compact` : la version de l'overlay en jeu, sans barre d'outils, qui suit le
 * joueur.
 */
export function PlanetMap({
  map,
  points,
  live,
  compact = false,
  className,
}: {
  map: PlanetMapData;
  points: PlanetMapPoint[];
  live: PlanetLive;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("PlanetMap");
  const locale = useLocale();
  const navigate = useNavigate();
  const { manifest, baseUrl } = map;

  const container = useRef<HTMLDivElement>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const instance = useRef<Leaflet.Map | null>(null);
  const contours = useRef<Leaflet.TileLayer | null>(null);
  const pointsLayer = useRef<Leaflet.LayerGroup | null>(null);
  const liveLayer = useRef<Leaflet.LayerGroup | null>(null);
  const altitude = useRef<AltitudeGrid | null>(null);
  const follow = useRef(compact);

  const [ready, setReady] = useState(false);
  const [kinds, setKinds] = useState<Kinds>({ place: true, private: true, marker: true });
  const [showContours, setShowContours] = useState(!compact);
  const [following, setFollowing] = useState(compact);
  const [cursor, setCursor] = useState<Spot | null>(null);
  const [selected, setSelected] = useState<PlanetMapPoint | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [adding, setAdding] = useState<Spot | null>(null);
  /** L'altitude se charge après la carte : sans elle, pas de marqueur posé au sol. */
  const [altitudeStatus, setAltitudeStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    follow.current = following;
  }, [following]);

  const counts = useMemo(
    () => ({
      place: points.filter((p) => p.kind === "place").length,
      private: points.filter((p) => p.kind === "private").length,
      marker: points.filter((p) => p.kind === "marker").length,
    }),
    [points],
  );

  useEffect(() => {
    let cancelled = false;
    let created: Leaflet.Map | null = null;
    const spotAt = (lat: number, lon: number): Spot => {
      const at = { lat, lon: wrapLon(lon) };
      return { ...at, alt: altitude.current ? altitudeAt(altitude.current, at) : null };
    };
    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !container.current) return;
      leaflet.current = L;
      const { tiles } = manifest;
      const bounds = L.latLngBounds([-90, -180], [90, 180]);
      created = L.map(container.current, {
        crs: L.CRS.EPSG4326,
        minZoom: tiles.minZoom,
        maxZoom: tiles.maxNativeZoom + 3,
        maxBounds: bounds.pad(0.05),
        maxBoundsViscosity: 0.8,
        zoomControl: false,
        attributionControl: false,
        center: [0, 0],
        zoom: compact ? 2 : 1,
      });
      const options = {
        tileSize: tiles.tileSize,
        noWrap: true,
        bounds,
        maxNativeZoom: tiles.maxNativeZoom,
        minZoom: tiles.minZoom,
      };
      L.tileLayer(planetMapUrl(baseUrl, tiles.base), options).addTo(created);
      contours.current = L.tileLayer(planetMapUrl(baseUrl, tiles.contours), options);
      pointsLayer.current = L.layerGroup().addTo(created);
      liveLayer.current = L.layerGroup().addTo(created);

      created.on("mousemove", (event) => setCursor(spotAt(event.latlng.lat, event.latlng.lng)));
      created.on("mouseout", () => setCursor(null));
      // Déplacer la carte à la main, c'est cesser de suivre le joueur.
      created.on("dragstart", () => setFollowing(false));
      created.on("movestart", () => setMenu(null));
      if (!compact) {
        created.on("contextmenu", (event) => {
          const size = created!.getSize();
          setMenu({
            ...spotAt(event.latlng.lat, event.latlng.lng),
            x: Math.max(8, Math.min(event.containerPoint.x, size.x - 232)),
            y: Math.max(8, Math.min(event.containerPoint.y, size.y - 120)),
          });
        });
      }
      instance.current = created;
      setReady(true);

      loadAltitude(planetMapUrl(baseUrl, manifest.altitude.url), manifest)
        .then((grid) => {
          if (cancelled) return;
          altitude.current = grid;
          setAltitudeStatus("ready");
        })
        .catch((error) => {
          console.error("cannot load the altitude map", error);
          if (!cancelled) setAltitudeStatus("failed");
        });
    })();
    return () => {
      cancelled = true;
      created?.remove();
      instance.current = null;
    };
    // Une carte par corps : ceux qui l'affichent lui donnent `key={slug}`,
    // et un autre corps remonte donc le composant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const current = instance.current;
    const layer = contours.current;
    if (!ready || !current || !layer) return;
    if (showContours && !current.hasLayer(layer)) layer.addTo(current);
    if (!showContours && current.hasLayer(layer)) layer.remove();
  }, [ready, showContours]);

  // Les points du catalogue et du joueur, un rond et son nom.
  useEffect(() => {
    const L = leaflet.current;
    const group = pointsLayer.current;
    if (!ready || !L || !group) return;
    group.clearLayers();
    for (const point of points) {
      if (!kinds[point.kind]) continue;
      const shape =
        point.kind === "marker"
          ? "width:10px;height:10px;transform:rotate(45deg);border-radius:2px"
          : point.kind === "private"
            ? "width:9px;height:9px;border-radius:2px"
            : "width:8px;height:8px;border-radius:50%";
      const marker = L.marker([point.lat, point.lon], {
        title: point.name,
        icon: L.divIcon({
          className: "planet-map-point",
          iconSize: [0, 0],
          html: `<span class="planet-map-point-dot" style="${shape};background:${point.color}"></span>${
            compact ? "" : `<span class="planet-map-point-label" style="color:${point.kind === "place" ? "#e6f2ff" : point.color}"></span>`
          }`,
        }),
      });
      marker.on("add", () => {
        // Le nom en texte, jamais en HTML : il vient des joueurs.
        const label = marker.getElement()?.querySelector(".planet-map-point-label");
        if (label) label.textContent = point.name;
      });
      marker.on("click", () => {
        setMenu(null);
        setAdding(null);
        setSelected(point);
      });
      marker.addTo(group);
    }
  }, [ready, points, kinds, compact]);

  // Le joueur, sa direction, et le trait vers sa destination.
  useEffect(() => {
    const L = leaflet.current;
    const group = liveLayer.current;
    const current = instance.current;
    if (!ready || !L || !group || !current) return;
    group.clearLayers();
    const { player, destination } = live;
    if (destination) {
      L.circleMarker([destination.lat, destination.lon], {
        radius: 6,
        color: "#e6f2ff",
        weight: 2,
        fillColor: "#9ed0ff",
        fillOpacity: 1,
      })
        // Un nœud texte, jamais une chaîne : Leaflet poserait le nom en HTML,
        // et ce nom vient d'un joueur (lieu privé d'orga, point, marqueur).
        .bindTooltip(
          Object.assign(document.createElement("span"), { textContent: destination.name }),
          { direction: "right", offset: [8, 0] },
        )
        .addTo(group);
    }
    if (player && destination) {
      // Par le plus court, comme la distance et le cap : à travers
      // l'antiméridien plutôt que tout le tour de la carte.
      let lon = destination.lon;
      if (lon - player.lon > 180) lon -= 360;
      if (player.lon - lon > 180) lon += 360;
      L.polyline(
        [
          [player.lat, player.lon],
          [destination.lat, lon],
        ],
        { color: "#9ed0ff", weight: 2.5, dashArray: "8 6", interactive: false },
      ).addTo(group);
    }
    if (player) {
      const rotate = player.heading === null ? "" : `transform:rotate(${player.heading}deg);`;
      const arrow =
        player.heading === null
          ? `<span class="planet-map-point-dot" style="width:14px;height:14px;border-radius:50%;background:${PLAYER_COLOR};border:2px solid #041827"></span>`
          : `<svg width="26" height="26" viewBox="0 0 30 30" style="position:absolute;left:-13px;top:-13px;${rotate}"><path d="M15 2 L26 27 L15 21 L4 27 Z" fill="${PLAYER_COLOR}" stroke="#041827" stroke-width="2"/></svg>`;
      L.marker([player.lat, player.lon], {
        interactive: false,
        zIndexOffset: 1000,
        icon: L.divIcon({ className: "planet-map-point", iconSize: [0, 0], html: arrow }),
      }).addTo(group);
      if (follow.current) current.panTo([player.lat, player.lon], { animate: true });
    }
  }, [ready, live]);

  const zoomBy = (delta: number) => instance.current?.setZoom(instance.current.getZoom() + delta);

  const toward =
    live.player && live.destination
      ? {
          metres: groundDistance(live.player, live.destination, manifest.radius),
          heading: headingTo(live.player, live.destination),
        }
      : null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {!compact && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(["place", "marker", "private"] as const).map((kind) =>
            counts[kind] > 0 || kind === "place" ? (
              <button
                key={kind}
                type="button"
                aria-pressed={kinds[kind]}
                onClick={() => setKinds((last) => ({ ...last, [kind]: !last[kind] }))}
                className="rounded-full border border-nexus-accent/12 px-2.5 py-1 text-xs text-nexus-dim transition-colors aria-pressed:border-transparent aria-pressed:bg-nexus-accent/10 aria-pressed:text-nexus-bright"
              >
                {t(`kinds.${kind}`)} · {counts[kind]}
              </button>
            ) : null,
          )}
          <button
            type="button"
            aria-pressed={showContours}
            onClick={() => setShowContours(!showContours)}
            className="rounded-full border border-nexus-accent/12 px-2.5 py-1 text-xs text-nexus-dim transition-colors aria-pressed:border-transparent aria-pressed:bg-nexus-accent/10 aria-pressed:text-nexus-bright"
          >
            {t("contours")}
          </button>
        </div>
      )}

      <div
        className={cn(
          "relative overflow-hidden rounded-nexus-sm border border-nexus-accent/8 bg-[#030912]",
          compact ? "min-h-0 flex-1" : "h-[420px]",
        )}
      >
        <div ref={container} className="planet-map size-full" role="application" aria-label={t("mapLabel")} />

        {(live.destination || live.player) && !compact && (
          <div className={cn("absolute top-2.5 left-2.5 z-[500] flex flex-col gap-0.5 px-3 py-2.5", PANEL)}>
            {live.destination ? (
              <>
                <span className="font-display text-[10.5px] font-semibold tracking-[0.14em] text-nexus-dim uppercase">
                  {t("destination")}
                </span>
                <span className="font-semibold text-nexus-white">{live.destination.name}</span>
              </>
            ) : null}
            {toward ? (
              <span className="font-mono text-xs text-nexus-bright">
                {formatDistance(toward.metres, locale)} · {t("heading", { heading: Math.round(toward.heading) % 360 })}
              </span>
            ) : null}
            {live.player && !live.destination ? (
              <span className="font-mono text-xs text-nexus-bright">{t("youAreHere")}</span>
            ) : null}
          </div>
        )}

        <div className={cn("absolute top-2.5 right-2.5 z-[500] flex flex-col overflow-hidden", PANEL)}>
          <button type="button" aria-label={t("zoomIn")} onClick={() => zoomBy(1)} className="grid size-8 place-items-center text-nexus-bright hover:bg-nexus-accent/10">
            <Plus className="size-4" />
          </button>
          <button type="button" aria-label={t("zoomOut")} onClick={() => zoomBy(-1)} className="grid size-8 place-items-center border-t border-nexus-accent/12 text-nexus-bright hover:bg-nexus-accent/10">
            <Minus className="size-4" />
          </button>
          {!compact && (
            <button type="button" aria-label={t("fit")} onClick={() => instance.current?.setView([0, 0], 1)} className="grid size-8 place-items-center border-t border-nexus-accent/12 text-nexus-bright hover:bg-nexus-accent/10">
              <Maximize2 className="size-3.5" />
            </button>
          )}
        </div>

        {selected && (
          <div className={cn("absolute top-2.5 left-2.5 z-[600] w-64 max-w-[calc(100%-4rem)] p-3.5", PANEL, "bg-nexus-card")}>
            <p className="font-display text-[10.5px] font-semibold tracking-[0.14em] text-nexus-dim uppercase">
              {t(`kinds.${selected.kind}`)}
              {selected.org ? ` · ${selected.org}` : ""}
            </p>
            <p className="mt-1 font-semibold text-nexus-white">{selected.name}</p>
            <p className="mt-1 font-mono text-[11.5px] text-nexus-muted">{formatLatLon(selected, locale)}</p>
            {live.player ? (
              <p className="mt-1 font-mono text-[11.5px] text-nexus-bright">
                {formatDistance(groundDistance(live.player, selected, manifest.radius), locale)} ·{" "}
                {t("heading", { heading: Math.round(headingTo(live.player, selected)) % 360 })}
              </p>
            ) : null}
            {selected.note ? <p className="mt-2 text-xs whitespace-pre-line text-nexus-muted">{selected.note}</p> : null}
            <div className="mt-3 flex gap-2">
              {!compact && (
                <button
                  type="button"
                  onClick={() => navigate(selected.kind === "marker" ? "/markers" : `/places/${selected.id}`)}
                  className="h-8 rounded-nexus-sm border border-nexus-accent/25 px-3 text-xs font-medium text-nexus-bright hover:bg-nexus-accent/8"
                >
                  {selected.kind === "marker" ? t("openMarkers") : t("openPlace")}
                </button>
              )}
              <button type="button" onClick={() => setSelected(null)} className="ml-auto h-8 px-2 text-xs text-nexus-dim hover:text-nexus-bright">
                {t("close")}
              </button>
            </div>
          </div>
        )}

        {menu && (
          <div role="menu" aria-label={t("menuLabel")} className={cn("absolute z-[600] flex w-56 flex-col gap-0.5 p-1.5", PANEL, "bg-nexus-card")} style={{ left: menu.x, top: menu.y }}>
            <span className="px-2.5 py-1.5 font-mono text-[11px] text-nexus-muted">{formatLatLon(menu, locale)}</span>
            <button
              type="button"
              role="menuitem"
              disabled={altitudeStatus !== "ready"}
              title={altitudeStatus === "ready" ? undefined : t(altitudeStatus === "failed" ? "altitudeFailed" : "altitudeLoading")}
              onClick={() => {
                setSelected(null);
                setAdding(menu);
                setMenu(null);
              }}
              className="rounded-md px-2.5 py-1.5 text-left text-[13px] text-nexus-bright hover:bg-nexus-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("addMarker")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void navigator.clipboard?.writeText(`${menu.lat.toFixed(4)}, ${menu.lon.toFixed(4)}`).catch(() => {});
                setMenu(null);
              }}
              className="rounded-md px-2.5 py-1.5 text-left text-[13px] text-nexus-bright hover:bg-nexus-accent/10"
            >
              {t("copyCoordinates")}
            </button>
          </div>
        )}

        {adding && (
          <AddMarkerForm
            spot={adding}
            slug={manifest.slug}
            radius={manifest.radius}
            altitudeOf={(spot) => (altitude.current ? altitudeAt(altitude.current, spot) : null)}
            onClose={() => setAdding(null)}
          />
        )}

        {!compact && (
          <span className={cn("absolute bottom-2.5 left-2.5 z-[500] px-2 py-1 font-mono text-[11.5px] text-nexus-bright", PANEL)}>
            {cursor
              ? `${formatLatLon(cursor, locale)}${cursor.alt !== null ? ` · ${formatDistance(Math.max(0, cursor.alt), locale)}` : ""}`
              : live.player
                ? `${t("you")} : ${formatLatLon(live.player, locale)}`
                : t("hint")}
          </span>
        )}
        {compact && !following && live.player && (
          <button
            type="button"
            aria-label={t("recenter")}
            title={t("recenter")}
            onClick={() => {
              setFollowing(true);
              instance.current?.panTo([live.player!.lat, live.player!.lon]);
            }}
            className={cn("absolute bottom-2.5 right-2.5 z-[500] grid size-8 place-items-center text-nexus-bright hover:bg-nexus-accent/10", PANEL)}
          >
            <Crosshair className="size-4" />
          </button>
        )}
        {!compact && (
          <span className="pointer-events-none absolute right-2.5 bottom-2.5 z-[500] rounded bg-[#030912]/60 px-1.5 py-0.5 text-[10px] text-nexus-dim">
            {manifest.attribution}
          </span>
        )}
      </div>

      {compact ? (
        toward ? (
          <div className="flex justify-between px-1 font-mono text-xs text-nexus-bright">
            <span>{formatDistance(toward.metres, locale)}</span>
            <span>{t("heading", { heading: Math.round(toward.heading) % 360 })}</span>
          </div>
        ) : null
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={following}
            disabled={!live.player}
            onClick={() => {
              setFollowing(!following);
              if (!following && live.player) instance.current?.panTo([live.player.lat, live.player.lon]);
            }}
            className="inline-flex h-8 items-center rounded-nexus-sm border border-nexus-accent/25 px-3 text-xs font-medium text-nexus-bright transition-colors hover:bg-nexus-accent/8 disabled:opacity-50 aria-pressed:border-nexus-accent aria-pressed:bg-nexus-accent aria-pressed:text-nexus-abyss"
          >
            {t("follow")}
          </button>
          {!live.player ? <span className="text-xs text-nexus-dim">{t("noFix")}</span> : null}
        </div>
      )}
    </div>
  );
}

/** Poser un marqueur au point cliqué, à l'altitude du sol lue sur la carte. */
function AddMarkerForm({
  spot,
  slug,
  radius,
  altitudeOf,
  onClose,
}: {
  spot: Spot;
  slug: string;
  radius: number;
  /** L'altitude du sol lue sur la carte ; `null` tant qu'elle n'est pas chargée. */
  altitudeOf: (spot: LatLon) => number | null;
  onClose: () => void;
}) {
  const t = useTranslations("PlanetMap");
  const tm = useTranslations("Markers");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MarkerKind>("poi");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    // Jamais au rayon nu : sans le relief, le marqueur serait sous le sol.
    const alt = altitudeOf(spot);
    if (alt === null) {
      setError(t("altitudeLoading"));
      return;
    }
    setPending(true);
    try {
      await createMarker({
        name,
        kind,
        position: { body: slug, ...pointOfGeo(spot, alt, radius) },
        source: "map",
      });
      // Toutes les fenêtres relisent, cartes de surface comprises.
      markersChanged(queryClient);
      onClose();
    } catch (failure) {
      setError(markerErrorMessage(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className={cn("absolute top-2.5 left-2.5 z-[600] grid w-64 max-w-[calc(100%-4rem)] gap-2.5 p-3.5", PANEL, "bg-nexus-card")}>
      <div>
        <p className="font-semibold text-nexus-white">{t("addMarker")}</p>
        <p className="font-mono text-[11px] text-nexus-muted">{formatLatLon(spot, locale)}</p>
      </div>
      <label className="grid gap-1 text-xs text-nexus-dim">
        {tm("form.name")}
        <input
          required
          autoFocus
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-8 rounded-nexus-sm border border-nexus-accent/12 bg-nexus-abyss px-2.5 text-[13px] text-nexus-bright"
        />
      </label>
      <label className="grid gap-1 text-xs text-nexus-dim">
        {tm("form.kind")}
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as MarkerKind)}
          className="h-8 rounded-nexus-sm border border-nexus-accent/12 bg-nexus-abyss px-2 text-[13px] text-nexus-bright"
        >
          {MARKER_KINDS.map((one) => (
            <option key={one} value={one}>
              {tm(`kinds.${one}`)}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-8 px-2 text-xs text-nexus-dim hover:text-nexus-bright">
          {t("cancel")}
        </button>
        <button type="submit" disabled={pending || !name.trim()} className="h-8 rounded-nexus-sm bg-nexus-accent px-3 text-xs font-semibold text-nexus-abyss disabled:opacity-50">
          {t("save")}
        </button>
      </div>
    </form>
  );
}
