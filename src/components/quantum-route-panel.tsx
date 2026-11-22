import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "use-intl";
import { Compass } from "lucide-react";
import { getNpsData } from "@/lib/api/nps";
import {
  onDestinationChange,
  readNpsDestination,
  setDestination,
  type NpsDestination,
} from "@/lib/nps-destination";
import { parseGameCoordinates, systemOfZones, type Fix } from "@/lib/nps";
import {
  CUT_ERROR_MAX,
  CUT_ERROR_SHARE,
  findQtBeacon,
  planQuantumRoute,
  qtDistance,
  qtTarget,
  qtUnits,
  quantumSystem,
  type QtCandidate,
} from "@/lib/quantum-route";
import { showOverlay } from "@/lib/windows";
import { cn } from "@/lib/utils";
import type { NpsBody, NpsPlace, PlacePosition } from "@/types/nexus";
import type { Marker } from "@/types/markers";

const SELECT =
  "min-w-0 w-full rounded-lg border border-white/15 bg-black/40 px-1.5 py-1 text-[12px] text-slate-100 focus:border-sky-300/50 focus:outline-none disabled:opacity-40";

/** The orbital stations turn with their body: recomputed now and then. */
const REFRESH_MS = 60 * 1000;

/** How many other routes are offered under the chosen one. */
const OTHERS = 4;

/** The departure: the NPS reading, the best pair of beacons, or a beacon. */
const ME = "me";

type Aim = {
  name: string;
  systemSlug?: string;
  position: PlacePosition;
};

/** What the NPS destination designates, as `GET /api/lieux/nps` knows it. */
function aimOf(
  destination: NpsDestination | null,
  places: NpsPlace[],
  markers: Marker[],
  bodies: NpsBody[],
  manualName: string,
): Aim | null {
  if (!destination) return null;
  const systemOfBody = (position: PlacePosition) =>
    bodies.find((body) => body.slug === position.body)?.systemSlug;
  if ("slug" in destination) {
    const place = places.find((one) => one.slug === destination.slug);
    return place
      ? {
          name: place.name,
          systemSlug: place.systemSlug ?? systemOfBody(place.position),
          position: place.position,
        }
      : null;
  }
  if ("marker" in destination) {
    const kept = destination.marker;
    const found = markers.find((one) => one.id === kept.id);
    const position = found?.position ?? kept.position;
    return {
      name: found?.name ?? kept.name,
      systemSlug:
        found?.systemSlug ?? kept.systemSlug ?? systemOfBody(position),
      position,
    };
  }
  if ("player" in destination) {
    const kept = destination.player;
    return {
      name: kept.name,
      systemSlug: kept.systemSlug ?? systemOfBody(kept.position),
      position: kept.position,
    };
  }
  const { name, systemSlug, position } = destination.point;
  return {
    name: name || manualName,
    systemSlug: systemSlug ?? systemOfBody(position),
    position,
  };
}

function candidateKey(candidate: QtCandidate) {
  return `${candidate.from?.id ?? ME}>${candidate.to.id}>${candidate.cut}`;
}

/**
 * The « Point » tab of the quantum navigation overlay: from the NPS
 * destination (a marker, a place, coordinates), the jump whose line passes
 * closest to it and the remaining distance at which to cut it — the same
 * computation as the site's /saut-quantique (`src/lib/quantum-route.ts`).
 */
export function QuantumRoutePanel({
  locked,
  fix,
  pointFrom,
  onPointFromChange,
}: {
  locked: boolean;
  /** The latest NPS reading, still recent, if any. */
  fix: Fix | null;
  pointFrom: string | null;
  onPointFromChange: (value: string | null) => void;
}) {
  const t = useTranslations("HaloOverlay.point");
  const format = useFormatter();

  const data = useQuery({
    queryKey: ["nps"],
    queryFn: getNpsData,
    staleTime: 5 * 60 * 1000,
  });
  const [destination, setStoredDestination] = useState<NpsDestination | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());
  const [chosen, setChosen] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pastedSystem, setPastedSystem] = useState<string | null>(null);

  useEffect(() => {
    const read = () =>
      void readNpsDestination()
        .then((value) => {
          setStoredDestination(value);
          setChosen(null);
        })
        .catch((error) =>
          console.error("cannot read the NPS destination", error),
        );
    read();
    const stop = onDestinationChange(read);
    const timer = window.setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      void stop.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const bodies = useMemo(() => data.data?.bodies ?? [], [data.data]);
  const places = useMemo(() => data.data?.places ?? [], [data.data]);
  const markers = useMemo(() => data.data?.markers ?? [], [data.data]);
  const systems = useMemo(() => {
    const found = new Map<string, string>();
    for (const body of bodies)
      if (body.systemSlug)
        found.set(body.systemSlug, body.systemName ?? body.systemSlug);
    return [...found].map(([slug, name]) => ({ slug, name }));
  }, [bodies]);

  const fixSystem = fix
    ? (fix.system ??
      systemOfZones(
        fix.zones,
        systems.map((one) => one.slug),
      ))
    : null;

  const aim = useMemo(
    () => aimOf(destination, places, markers, bodies, t("manualName")),
    [destination, places, markers, bodies, t],
  );
  const systemSlug = aim?.systemSlug ?? fixSystem ?? null;
  const qtSystem = useMemo(
    () => (systemSlug ? quantumSystem(bodies, places, systemSlug, now) : null),
    [bodies, places, systemSlug, now],
  );
  const target = useMemo(
    () => (aim && qtSystem ? qtTarget(aim.position, qtSystem, aim.name) : null),
    [aim, qtSystem],
  );

  // The reading is a departure only in the target's system; unknown, it is
  // taken to be there, as the halo does.
  const here =
    fix && (!fixSystem || fixSystem === systemSlug)
      ? { x: fix.x, y: fix.y, z: fix.z }
      : null;
  const fromBeacon =
    qtSystem && pointFrom && pointFrom !== ME
      ? findQtBeacon(qtSystem, pointFrom)
      : undefined;
  const useHere = (pointFrom === ME || pointFrom === null) && here !== null;
  const departure = fromBeacon ?? (useHere ? here : null);
  const departureKey = fromBeacon
    ? fromBeacon.id
    : useHere && here
      ? `${Math.round(here.x / 1e4)}|${Math.round(here.y / 1e4)}|${Math.round(here.z / 1e4)}`
      : "";
  const plan = useMemo(
    () =>
      target && qtSystem
        ? planQuantumRoute(target, qtSystem, { from: departure })
        : null,
    // The reading changes every second; a departure 10 km off is the same:
    // `departureKey` stands for `departure`.
    [target, qtSystem, departureKey],
  );

  const candidates = plan?.kind === "space" ? plan.candidates : [];
  const selected =
    candidates.find((one) => candidateKey(one) === chosen) ?? candidates[0];
  const others = candidates.filter((one) => one !== selected).slice(0, OTHERS);
  const distanceNow = here && target ? qtDistance(here, target) : null;

  const distance = (meters: number) => {
    const { value, unit, digits } = qtUnits(meters);
    return `${format.number(value, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })} ${unit}`;
  };

  const pastedPoint = pasted.trim() ? parseGameCoordinates(pasted) : null;
  const pasteSystem =
    pastedSystem ?? fixSystem ?? systemSlug ?? systems[0]?.slug ?? "stanton";

  function applyPasted() {
    if (!pastedPoint) return;
    void setDestination({
      point: { systemSlug: pasteSystem, position: pastedPoint },
    })
      .then(() => setPasted(""))
      .catch((error) => console.error("cannot set the NPS destination", error));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-white/10 px-2 py-1.5 text-[12px]">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">
          {t("target")}
        </p>
        {aim ? (
          <p className="truncate text-slate-100">{aim.name}</p>
        ) : (
          <p className="text-slate-400">{t("noTarget")}</p>
        )}
        {aim && !target && data.data ? (
          <p className="text-[11px] text-amber-200">{t("unknownBody")}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className="flex gap-1">
          <input
            value={pasted}
            disabled={locked}
            onChange={(event) => setPasted(event.target.value)}
            placeholder={t("pastePlaceholder")}
            className={cn(SELECT, "flex-1 font-mono")}
          />
          <select
            value={pasteSystem}
            disabled={locked}
            onChange={(event) => setPastedSystem(event.target.value)}
            className={cn(SELECT, "w-24 flex-none")}
            aria-label={t("system")}
          >
            {(systems.length > 0
              ? systems
              : [{ slug: pasteSystem, name: pasteSystem }]
            ).map((one) => (
              <option key={one.slug} value={one.slug}>
                {one.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyPasted}
            disabled={locked || !pastedPoint}
            className="rounded-lg border border-white/15 bg-white/5 px-2 text-[12px] transition hover:bg-white/10 disabled:opacity-40"
          >
            {t("pasteUse")}
          </button>
        </div>
        {pasted.trim() && !pastedPoint ? (
          <p className="text-[11px] text-amber-200">{t("pasteInvalid")}</p>
        ) : null}
      </div>

      {target && qtSystem && plan?.kind !== "surface" ? (
        <label className="min-w-0 space-y-0.5">
          <span className="text-[11px] text-slate-400">{t("from")}</span>
          <select
            value={fromBeacon ? fromBeacon.id : useHere ? ME : ""}
            disabled={locked}
            onChange={(event) => {
              onPointFromChange(event.target.value || null);
              setChosen(null);
            }}
            className={SELECT}
          >
            <option value={ME} disabled={!here}>
              {here ? t("fromMe") : t("fromMeNone")}
            </option>
            <option value="">{t("anyFrom")}</option>
            {qtSystem.beacons.map((beacon) => (
              <option key={beacon.id} value={beacon.id}>
                {beacon.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {plan?.kind === "surface" ? (
        <section className="space-y-1.5 rounded-lg border border-sky-300/30 bg-sky-300/5 p-2.5 text-[12px]">
          <p className="text-slate-300">
            {t("surface.intro", {
              body: plan.surface.body.name,
              altitude: distance(Math.max(0, plan.surface.altitude)),
            })}
          </p>
          {plan.surface.places.length > 0 ? (
            <>
              <p className="text-slate-100">
                {t("surface.jumpTo", {
                  place: plan.surface.places[0].place.name,
                  distance: distance(plan.surface.places[0].distance),
                })}
              </p>
              {plan.surface.places.slice(1, 3).map(({ place, distance: d }) => (
                <p key={place.slug} className="text-[11px] text-slate-400">
                  {t("surface.other", {
                    place: place.name,
                    distance: distance(d),
                  })}
                </p>
              ))}
            </>
          ) : (
            <p className="text-slate-100">
              {t("surface.jumpToBody", {
                body: plan.surface.body.name,
                distance: distance(plan.surface.fromOrbit),
              })}
            </p>
          )}
        </section>
      ) : null}

      {plan?.kind === "space" ? (
        selected ? (
          <section className="space-y-1.5 rounded-lg border border-sky-300/30 bg-sky-300/5 p-2.5">
            <p className="text-[12px] text-slate-300">
              {selected.from
                ? t("routeLine", {
                    from: selected.from.name,
                    to: selected.to.name,
                  })
                : t("routeFromHere", { to: selected.to.name })}
            </p>
            {selected.cut ? (
              <>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  {t("cutAt")}
                </p>
                <p className="font-mono text-4xl font-semibold tracking-wide text-sky-50">
                  {distance(selected.remaining)}
                </p>
                <p className="text-[12px] text-slate-300">
                  {t("remaining", { to: selected.to.name })}
                </p>
              </>
            ) : (
              <p className="text-[13px] font-medium text-sky-50">
                {t("goToEnd", { to: selected.to.name })}
              </p>
            )}
            <p className="text-[11px] text-slate-400">
              {t("expected", {
                error: distance(selected.error),
                offset: distance(selected.offset),
              })}
            </p>
            {selected.from && !fromBeacon && selected.cut ? (
              <p className="text-[11px] text-slate-400">
                {t("goFirst", { from: selected.from.name })}
              </p>
            ) : null}
          </section>
        ) : (
          <p className="text-[12px] text-amber-200">{t("noRoute")}</p>
        )
      ) : null}

      {others.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            {t("others")}
          </p>
          {others.map((candidate) => (
            <button
              key={candidateKey(candidate)}
              type="button"
              disabled={locked}
              onClick={() => setChosen(candidateKey(candidate))}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-left text-[12px] transition hover:bg-white/10 disabled:opacity-40"
            >
              <span className="truncate text-slate-200">
                {candidate.cut && candidate.from
                  ? `${candidate.from.name} → ${candidate.to.name}`
                  : candidate.to.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-slate-300">
                {candidate.cut ? distance(candidate.remaining) : t("end")} · ±
                {distance(candidate.error)}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {target ? (
        <div className="space-y-1 rounded-lg border border-white/10 px-2 py-1.5 text-[12px]">
          <p className="text-slate-200">
            {distanceNow !== null
              ? t("distanceNow", { distance: distance(distanceNow) })
              : t("noPosition")}
          </p>
          <button
            type="button"
            onClick={() =>
              void showOverlay("nps").catch((error) =>
                console.error("cannot open the NPS", error),
              )
            }
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[12px] transition hover:bg-white/10"
          >
            <Compass className="size-3.5" />
            {t("openNps")}
          </button>
        </div>
      ) : null}

      <p className="text-[10px] text-slate-500">
        {t("precision", {
          share: Math.round(CUT_ERROR_SHARE * 100),
          max: distance(CUT_ERROR_MAX),
        })}
      </p>
    </div>
  );
}
