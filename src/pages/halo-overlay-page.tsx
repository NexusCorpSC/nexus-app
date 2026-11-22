import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "use-intl";
import { ArrowLeftRight, Compass, Orbit, X } from "lucide-react";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { useOverlayMode } from "@/hooks/use-overlay-opacity";
import { useOverlayLocked } from "@/hooks/use-overlay-lock";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { OverlayLockButton } from "@/components/overlay-lock-button";
import { overlaySkin } from "@/lib/overlay-opacity";
import { getHaloData } from "@/lib/api/aaron-halo";
import { getHaloRoute, setHaloRoute } from "@/lib/settings";
import { setDestination } from "@/lib/nps-destination";
import { showOverlay } from "@/lib/windows";
import { onQuantumPoint } from "@/lib/quantum-navigation";
import { QuantumRoutePanel } from "@/components/quantum-route-panel";
import { systemOfZones, type Fix } from "@/lib/nps";
import {
  DEFAULT_HALO_BAND,
  DEFAULT_HALO_BANDS,
  HALO_POINTS,
  findHaloPoint,
  haloBandRoutes,
  haloGigametres,
  haloMegametres,
  haloPlacement,
  haloRoute,
  haloWindowSize,
  type HaloPass,
  type HaloPoint,
} from "@/lib/aaron-halo";
import { cn } from "@/lib/utils";

/** The NPS readings, which Rust sends to every window (`nps.rs`). */
const POSITION_EVENT = "nps://position";

/** Past this, a reading no longer says where one is. */
const POSITION_MAX_AGE_MS = 10 * 60 * 1000;

/** How often the age of the reading is redrawn. */
const TICK_MS = 1000;

/** How many other destinations are offered under the chosen one. */
const OTHERS = 4;

const WINDOW_TONE = {
  narrow: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  normal: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  wide: "border-emerald-300/40 bg-emerald-300/10 text-emerald-100",
} as const;

const SELECT =
  "min-w-0 w-full rounded-lg border border-white/15 bg-black/40 px-1.5 py-1 text-[12px] text-slate-100 focus:border-sky-300/50 focus:outline-none disabled:opacity-40";

/**
 * Whether a reading can be in Stanton: coordinates alone do not tell one
 * system from another, but the zones read on screen do when there are any.
 */
function isStanton(fix: Fix): boolean {
  const system =
    fix.system ?? systemOfZones(fix.zones, ["stanton", "pyro", "nyx"]);
  return !system || system === "stanton";
}

type Translator = ReturnType<typeof useTranslations<"HaloOverlay">>;

function formatAge(ms: number, t: Translator): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t("seconds", { count: seconds });
  return t("minutes", { count: Math.floor(seconds / 60) });
}

function PointOptions({
  points,
  exclude,
}: {
  points: HaloPoint[];
  exclude?: string;
}) {
  const bodies = [...new Set(points.map((point) => point.body))];
  return bodies.map((body) => (
    <optgroup key={body} label={body}>
      {points
        .filter((point) => point.body === body && point.id !== exclude)
        .map((point) => (
          <option key={point.id} value={point.id}>
            {point.label}
          </option>
        ))}
    </optgroup>
  ));
}

/**
 * The Aaron Halo navigator over the game: from a departure and a band, the
 * remaining distance at which to cut the quantum jump to land in that band —
 * the number to watch on the HUD during the jump. The same computation as
 * the site's /industry/aaron-halo (`src/lib/aaron-halo.ts`).
 *
 * After the drop, the NPS readings say which band one is in.
 */
export default function HaloOverlayPage() {
  const t = useTranslations("HaloOverlay");
  const format = useFormatter();

  useTransparentWindow();
  const mode = useOverlayMode("halo");
  const locked = useOverlayLocked("halo");

  const data = useQuery({
    queryKey: ["aaron-halo"],
    queryFn: getHaloData,
    staleTime: 60 * 60 * 1000,
  });
  const bands = data.data?.bands ?? DEFAULT_HALO_BANDS;
  const points = data.data?.points ?? HALO_POINTS;

  const [fromId, setFromId] = useState("arc-l1");
  const [toId, setToId] = useState<string | null>(null);
  const [bandId, setBandId] = useState(DEFAULT_HALO_BAND);
  const [tab, setTab] = useState<"band" | "point">("band");
  const [pointFrom, setPointFrom] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  /** The route whose crossing was last set as the NPS destination. */
  const [guidedRoute, setGuidedRoute] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    void getHaloRoute()
      .then((stored) => {
        if (!alive) return;
        if (stored.from) setFromId(stored.from);
        if (stored.to !== undefined) setToId(stored.to);
        if (stored.band) setBandId(stored.band);
        if (stored.mode) setTab(stored.mode);
        if (stored.pointFrom !== undefined) setPointFrom(stored.pointFrom);
      })
      .catch((error) => console.error("cannot read the halo route", error))
      .finally(() => alive && setLoaded(true));

    const position = listen<Fix>(POSITION_EVENT, (event) =>
      setFix(event.payload),
    );
    // « Y aller » depuis un marqueur : l'onglet du point.
    const point = onQuantumPoint(() => setTab("point"));
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
      void position.then((stop) => stop()).catch(() => {});
      void point.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void setHaloRoute({
      from: fromId,
      to: toId,
      band: bandId,
      mode: tab,
      pointFrom,
    }).catch((error) => console.error("cannot save the halo route", error));
  }, [fromId, toId, bandId, tab, pointFrom, loaded]);

  const from = findHaloPoint(fromId, points) ?? points[0];
  const band =
    bands.find((one) => one.id === bandId) ??
    bands.find((one) => one.id === DEFAULT_HALO_BAND) ??
    bands[0];
  const candidates = useMemo(
    () => haloBandRoutes(from, band.id, points, bands),
    [from, band, points, bands],
  );
  const to =
    findHaloPoint(toId && toId !== from.id ? toId : null, points) ??
    candidates[0]?.to ??
    null;
  const route = useMemo(
    () => (to ? haloRoute(from, to, [band]) : null),
    [from, to, band],
  );
  const passes = route?.passes ?? [];
  const pass = passes.reduce<HaloPass | null>(
    (best, one) => (!best || one.width > best.width ? one : best),
    null,
  );

  const gm = (meters: number) =>
    `${format.number(haloGigametres(meters), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} Gm`;
  const mm = (meters: number) => `${format.number(haloMegametres(meters))} Mm`;

  // The halo is Stanton's: a reading known to be elsewhere says nothing.
  const recent =
    fix && now - fix.at < POSITION_MAX_AGE_MS && isStanton(fix) ? fix : null;
  const placement = recent ? haloPlacement(recent, bands) : null;
  // Vers un point, la lecture compte dans tous les systèmes.
  const recentAnywhere = fix && now - fix.at < POSITION_MAX_AGE_MS ? fix : null;

  function close() {
    void invoke("close_halo_overlay");
  }

  function swap() {
    if (!to) return;
    setFromId(to.id);
    setToId(from.id);
  }

  const routeKey = `${from.id}|${to?.id ?? ""}|${band.id}`;
  const guided = guidedRoute === routeKey;

  function guide() {
    if (!pass) return;
    const { x, y, z } = pass.target;
    void setDestination({
      point: {
        name: t("pointName", { band: band.id }),
        // The halo is Stanton's: from another system, the NPS says so
        // rather than guiding to these coordinates in the wrong frame.
        systemSlug: "stanton",
        position: { x, y, z },
      },
    })
      // As from a place's page: the destination is only of use with the
      // NPS on screen, which also sends the readings back here.
      .then(() => showOverlay("nps"))
      .then(() => setGuidedRoute(routeKey))
      .catch((error) => console.error("cannot set the NPS destination", error));
  }

  const others = candidates
    .filter((candidate) => candidate.to.id !== to?.id)
    .slice(0, OTHERS);

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden",
        overlaySkin(mode),
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close();
      }}
    >
      {/* No decorations, so the header doubles as the title bar. */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex shrink-0 cursor-grab items-center gap-2 px-3 py-2",
          mode === "opaque" ? "border-b border-white/10" : null,
        )}
      >
        <Orbit className="pointer-events-none size-4 text-slate-400" />
        <p className="pointer-events-none flex-1 truncate text-sm font-medium text-slate-200">
          {t("title")}
        </p>
        <OverlayOpacityButton label="halo" mode={mode} />
        <OverlayLockButton label="halo" locked={locked} />
        <button
          type="button"
          onClick={close}
          title={t("close")}
          className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        >
          <span className="sr-only">{t("close")}</span>
          <X className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-slate-100">
        <div role="tablist" className="grid grid-cols-2 gap-1">
          {(["band", "point"] as const).map((one) => (
            <button
              key={one}
              type="button"
              role="tab"
              aria-selected={tab === one}
              disabled={locked}
              onClick={() => setTab(one)}
              className={cn(
                "rounded-lg border px-2 py-1 text-[12px] transition disabled:opacity-60",
                tab === one
                  ? "border-sky-300/40 bg-sky-300/10 text-sky-100"
                  : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10",
              )}
            >
              {t(`tabs.${one}`)}
            </button>
          ))}
        </div>

        {tab === "point" ? (
          <QuantumRoutePanel
            locked={locked}
            fix={recentAnywhere}
            pointFrom={pointFrom}
            onPointFromChange={setPointFrom}
          />
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
              <label className="min-w-0 space-y-0.5">
                <span className="text-[11px] text-slate-400">{t("from")}</span>
                <select
                  value={from.id}
                  disabled={locked}
                  onChange={(event) => {
                    setFromId(event.target.value);
                    if (event.target.value === toId) setToId(null);
                  }}
                  className={SELECT}
                >
                  <PointOptions points={points} />
                </select>
              </label>
              <button
                type="button"
                onClick={swap}
                disabled={locked || !to}
                title={t("swap")}
                className="rounded-lg border border-white/15 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
              >
                <span className="sr-only">{t("swap")}</span>
                <ArrowLeftRight className="size-3.5" />
              </button>
              <label className="min-w-0 space-y-0.5">
                <span className="text-[11px] text-slate-400">{t("to")}</span>
                <select
                  value={toId && toId !== from.id ? toId : ""}
                  disabled={locked}
                  onChange={(event) => setToId(event.target.value || null)}
                  className={SELECT}
                >
                  <option value="">{t("bestTo")}</option>
                  <PointOptions points={points} exclude={from.id} />
                </select>
              </label>
            </div>

            <div
              role="radiogroup"
              aria-label={t("band")}
              className="grid grid-cols-10 gap-0.5"
            >
              {bands.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  role="radio"
                  aria-checked={band.id === one.id}
                  disabled={locked}
                  title={t("bandDensity", {
                    density: Math.round(one.density * 100),
                  })}
                  onClick={() => setBandId(one.id)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded border px-0.5 pt-0.5 pb-1 font-mono text-[11px] transition disabled:opacity-40",
                    band.id === one.id
                      ? "border-sky-300/40 bg-sky-300/10 text-sky-100"
                      : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10",
                  )}
                >
                  {one.id}
                  <span className="h-0.5 w-full rounded-full bg-white/10">
                    <span
                      className="block h-full rounded-full bg-sky-300"
                      style={{ width: `${Math.max(6, one.density * 100)}%` }}
                    />
                  </span>
                </button>
              ))}
            </div>

            {to && pass ? (
              <section className="space-y-1.5 rounded-lg border border-sky-300/30 bg-sky-300/5 p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  {t("cutAt")}
                </p>
                <p className="font-mono text-4xl font-semibold tracking-wide text-sky-50">
                  {gm(pass.targetRemaining)}
                </p>
                <p className="text-[12px] text-slate-300">
                  {t("remaining", { to: to.label })}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono",
                      WINDOW_TONE[haloWindowSize(pass.width)],
                    )}
                  >
                    {t(`window.${haloWindowSize(pass.width)}`, {
                      width: mm(pass.width),
                    })}
                  </span>
                  <span className="text-slate-400">
                    {t("between", {
                      enter: gm(pass.enterRemaining),
                      exit: gm(pass.exitRemaining),
                    })}
                  </span>
                </div>
                {passes.length > 1 ? (
                  <p className="text-[11px] text-slate-400">{t("twice")}</p>
                ) : null}
                <button
                  type="button"
                  onClick={guide}
                  disabled={locked}
                  title={t("guideHint")}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[12px] transition hover:bg-white/10 disabled:opacity-40"
                >
                  <Compass className="size-3.5" />
                  {guided ? t("guided") : t("guide")}
                </button>
              </section>
            ) : (
              <p className="text-[12px] text-amber-200">
                {to
                  ? t("noCrossing", {
                      from: from.label,
                      to: to.label,
                      band: band.id,
                    })
                  : t("noCandidate", { from: from.label, band: band.id })}
              </p>
            )}

            {others.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  {t("others", { band: band.id })}
                </p>
                {others.map((candidate) => (
                  <button
                    key={candidate.to.id}
                    type="button"
                    disabled={locked}
                    onClick={() => setToId(candidate.to.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-left text-[12px] transition hover:bg-white/10 disabled:opacity-40"
                  >
                    <span className="truncate text-slate-200">
                      {candidate.to.label}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-300">
                      {gm(candidate.pass.targetRemaining)} ·{" "}
                      {mm(candidate.pass.width)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="rounded-lg border border-white/10 px-2 py-1.5 text-[12px]">
              {placement && recent ? (
                <>
                  <p
                    className={
                      placement.inside ? "text-emerald-200" : "text-slate-200"
                    }
                  >
                    {placement.inside
                      ? t("position.inBand", { band: placement.band.id })
                      : t(
                          placement.towards === "out"
                            ? "position.before"
                            : "position.after",
                          {
                            band: placement.nearest.id,
                            gap: mm(placement.gap),
                          },
                        )}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {t("position.age", { age: formatAge(now - recent.at, t) })}
                  </p>
                </>
              ) : (
                <p className="text-slate-400">{t("position.none")}</p>
              )}
            </div>

            {data.data ? (
              <p className="text-[10px] text-slate-500">
                {t(`source.${data.data.source}`)}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
