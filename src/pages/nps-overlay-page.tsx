import {
  useEffect,
  useMemo,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Compass,
  Crosshair,
  Keyboard,
  MapPinPlus,
  Navigation,
  Radar,
  Search,
  ScanText,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

import { AHEAD_DEGREES, NpsCompass } from "@/components/nps-compass";
import { OverlayLockButton } from "@/components/overlay-lock-button";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { useDebounced } from "@/hooks/use-debounced";
import { useOverlayLocked } from "@/hooks/use-overlay-lock";
import { useOverlayMode } from "@/hooks/use-overlay-opacity";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import {
  getNpsData,
  positionErrorMessage,
  submitPlacePosition,
} from "@/lib/api/nps";
import { listPlaces } from "@/lib/api/places";
import {
  bodyAt,
  compassPoint,
  fromGeo,
  geoOf,
  guide,
  inSystem,
  MIN_CLOSING_SPEED,
  nearestPlaces,
  MAX_TRAVEL_AGE_MS,
  parseGameCoordinates,
  parseNumber,
  positionOf,
  previousFor,
  toBodyFrame,
  type Fix,
} from "@/lib/nps";
import {
  onDestinationChange,
  readNpsDestination,
  setDestination,
  type NpsDestination,
} from "@/lib/nps-destination";
import { overlaySkin } from "@/lib/overlay-opacity";
import {
  DEFAULT_NPS_SCREEN,
  getNpsScreen,
  getNpsSystem,
  setNpsScreen,
  setNpsSystem,
  type NpsScreenRegion,
  type NpsScreenSettings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { NpsBody, NpsPlace, PlacePosition } from "@/types/nexus";

/**
 * Carries a reading of `/showlocation`, from `src-tauri/src/nps.rs`, or one
 * read off the screen, from `src-tauri/src/nps_screen.rs`.
 */
const POSITION_EVENT = "nps://position";

/** How the reading off the screen goes, each time it changes. */
const SCREEN_STATUS_EVENT = "nps://screen-status";

/** The box drawn around the game's debug lines, and whether it read. */
const CALIBRATED_EVENT = "nps://calibrated";

/** Ten minutes of readings off the screen, at the shortest interval. */
const MAX_HISTORY = 1200;

/** The intervals offered for reading the screen, in milliseconds. */
const SCREEN_INTERVALS = [500, 1000, 2000, 5000];

type ScreenStatus =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "unreadable" }
  | { state: "failed"; message: string };

/** How often the age of the reading is redrawn. */
const TICK_MS = 1000;

type Panel = "guide" | "destination" | "coordinates" | "record";

/** What the overlay guides to: a recorded place, or a point typed in. */
type Target = {
  name: string;
  /** Typed in by hand, not a place of the catalogue. */
  manual: boolean;
  systemSlug?: string;
  systemName?: string;
  bodyName?: string;
  position: PlacePosition;
};

/**
 * The NPS — Nexus Positioning System — over the game.
 *
 * The game gives a position, never an orientation: `/showlocation` copies the
 * player's coordinates to the clipboard, and that is all. So the window says
 * how far the destination is and which bearing leads there, and — once two
 * readings are a few metres apart — how far to turn from the way one is
 * going. The button puts `/showlocation` on the clipboard; pasting it in the
 * chat is the player's part, and the answer is picked up on its own
 * (`src-tauri/src/nps.rs`). Typing the command by hand works just as well.
 *
 * Places have no position until players record one, from here, standing on
 * the spot: the position goes to the site as a contribution.
 */
export default function NpsOverlayPage() {
  useTransparentWindow();
  const t = useTranslations("NpsOverlay");
  const format = useFormatter();

  const mode = useOverlayMode("nps");
  const locked = useOverlayLocked("nps");

  // The readings of the last minutes, oldest first: the latest says where one
  // is, an earlier one far enough behind which way one is going.
  const [history, setHistory] = useState<Fix[]>([]);
  const fix = history.length > 0 ? history[history.length - 1] : null;
  const [screen, setScreen] = useState<NpsScreenSettings>(DEFAULT_NPS_SCREEN);
  const [screenLoaded, setScreenLoaded] = useState(false);
  const [screenStatus, setScreenStatus] = useState<ScreenStatus>({
    state: "idle",
  });
  // Set once a box has been drawn: whether a position was read in it, or
  // whether it was too small to keep.
  const [calibration, setCalibration] = useState<
    "found" | "empty" | "tooSmall" | null
  >(null);
  const [waiting, setWaiting] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [panel, setPanel] = useState<Panel>("guide");
  const [destination, setDestinationState] = useState<NpsDestination | null>(
    null,
  );
  // Where the player was last seen near a body: in open space, a reading does
  // not tell Stanton from Pyro, each centred on its own star.
  const [lastSystem, setLastSystem] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ["nps"],
    queryFn: getNpsData,
    staleTime: 5 * 60 * 1000,
  });
  const bodies = useMemo(() => data.data?.bodies ?? [], [data.data]);
  const places = useMemo(() => data.data?.places ?? [], [data.data]);

  useEffect(() => {
    const pending = listen<Fix>(POSITION_EVENT, (event) => {
      const reading = event.payload;
      setHistory((last) =>
        [...last, reading]
          .filter((one) => reading.at - one.at <= MAX_TRAVEL_AGE_MS)
          .slice(-MAX_HISTORY),
      );
      if (reading.source !== "screen") setWaiting(false);
    });
    return () => {
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getNpsScreen()
      .then((stored) => {
        if (!alive) return;
        setScreen(stored);
        setScreenLoaded(true);
      })
      .catch((error) => console.error("cannot read the NPS tracking", error));
    const status = listen<ScreenStatus>(SCREEN_STATUS_EVENT, (event) => {
      setScreenStatus(event.payload);
      // Once the reading says how it goes, that is what to show.
      if (event.payload.state !== "idle") setCalibration(null);
    });
    const calibrated = listen<{
      region: NpsScreenRegion | null;
      found: boolean;
    }>(CALIBRATED_EVENT, (event) => {
      const { region, found } = event.payload;
      if (!region) {
        setCalibration("tooSmall");
        return;
      }
      setCalibration(found ? "found" : "empty");
      // A box that reads turns the tracking on: that is what it was drawn
      // for.
      setScreen((last) => ({
        ...last,
        region,
        enabled: last.enabled || found,
      }));
    });
    return () => {
      alive = false;
      void status.then((stop) => stop()).catch(() => {});
      void calibrated.then((stop) => stop()).catch(() => {});
    };
  }, []);

  // Rust reads the screen; the settings live here, in the store.
  useEffect(() => {
    if (!screenLoaded) return;
    void invoke("nps_screen_configure", { settings: screen }).catch((error) =>
      console.error("cannot apply the NPS tracking", error),
    );
    void setNpsScreen(screen).catch((error) =>
      console.error("cannot save the NPS tracking", error),
    );
  }, [screen, screenLoaded]);

  // The destination lives in the store: the main window can set it from a
  // place's page, and this window outlives any hide and show.
  useEffect(() => {
    let alive = true;
    function refresh() {
      void readNpsDestination()
        .then((stored) => {
          if (alive) setDestinationState(stored);
        })
        .catch((error) =>
          console.error("cannot read the NPS destination", error),
        );
    }
    refresh();
    const pending = onDestinationChange(refresh);
    return () => {
      alive = false;
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getNpsSystem()
      .then((slug) => {
        if (alive && slug) setLastSystem((seen) => seen ?? slug);
      })
      .catch((error) => console.error("cannot read the NPS system", error));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Locked, the window does not take the mouse: no list to pick from.
  useEffect(() => {
    if (locked) setPanel("guide");
  }, [locked]);

  const target = useMemo(
    () => targetOf(destination, places, bodies, t("manualName")),
    [destination, places, bodies, t],
  );
  const body = fix ? bodyAt(fix, bodies) : null;
  const system = body?.systemSlug ?? lastSystem;
  const systemName = bodies.find(
    (one) => one.systemSlug === system,
  )?.systemName;
  const geo = fix && body ? geoOf(toBodyFrame(fix, body), body) : null;
  const elsewhere = target ? !inSystem(target, system) : false;
  const previous = useMemo(
    () => (fix ? previousFor(fix, history, bodies) : null),
    [fix, history, bodies],
  );
  const guidance =
    fix && target && !elsewhere
      ? guide(fix, previous, target.position, bodies)
      : null;
  const live = screen.enabled && screen.region !== null;
  const nearest = fix
    ? nearestPlaces(fix, places, bodies, system, 1)[0]
    : undefined;

  useEffect(() => {
    const seen = body?.systemSlug;
    if (!seen || seen === lastSystem) return;
    setLastSystem(seen);
    void setNpsSystem(seen).catch((error) =>
      console.error("cannot save the NPS system", error),
    );
  }, [body?.systemSlug, lastSystem]);

  async function refreshPosition() {
    setCopyError(false);
    try {
      await invoke("nps_copy_command");
      setWaiting(true);
    } catch (error) {
      console.error("cannot copy /showlocation", error);
      setCopyError(true);
    }
  }

  function calibrate() {
    setCalibration(null);
    void invoke("nps_calibrate").catch((error) =>
      console.error("cannot start the NPS calibration", error),
    );
  }

  function close() {
    void invoke("close_nps_overlay");
  }

  const open = panel !== "guide" && !locked;

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden text-slate-200",
        overlaySkin(mode),
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (open) setPanel("guide");
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
        <Compass className="pointer-events-none size-4 shrink-0 text-slate-400" />
        <p className="pointer-events-none min-w-0 flex-1 truncate text-sm font-medium">
          {t("title")}
        </p>
        <OverlayOpacityButton label="nps" mode={mode} />
        <OverlayLockButton label="nps" locked={locked} />
        <button
          type="button"
          onClick={close}
          title={t("close")}
          className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        >
          <span className="sr-only">{t("close")}</span>
          <X className="size-4" />
        </button>
      </div>

      {open && panel === "destination" ? (
        <DestinationPicker
          places={places}
          onPick={(slug) => {
            setPanel("guide");
            void setDestination({ slug });
          }}
          onCancel={() => setPanel("guide")}
        />
      ) : open && panel === "coordinates" ? (
        <CoordinatesPanel
          bodies={bodies}
          system={system}
          currentBody={body}
          onPick={(point) => {
            setPanel("guide");
            void setDestination({ point });
          }}
          onCancel={() => setPanel("guide")}
        />
      ) : open && panel === "record" && fix ? (
        <RecordPanel
          fix={fix}
          system={system}
          onDone={() => setPanel("guide")}
          positionFor={() => positionOf(fix, bodies)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
          <section className="space-y-1.5">
            <button
              type="button"
              onClick={() => void refreshPosition()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-medium transition hover:bg-white/10"
            >
              <Crosshair className="size-4" />
              {t("refresh")}
            </button>
            <ScreenTracking
              settings={screen}
              status={screenStatus}
              calibration={calibration}
              locked={locked}
              onChange={setScreen}
              onCalibrate={calibrate}
            />
            {copyError ? (
              <p className="text-[11px] text-red-300">{t("copyFailed")}</p>
            ) : waiting ? (
              <p className="text-[11px] text-sky-200">{t("waiting")}</p>
            ) : !fix && !live ? (
              <p className="text-[11px] text-slate-400">{t("hint")}</p>
            ) : null}
          </section>

          {fix ? (
            <section className="space-y-0.5 text-[12px]">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                {t("here")}
              </p>
              <p className="font-medium">
                {body ? body.name : t("space")}
                {systemName ? (
                  <span className="font-normal text-slate-400">
                    {" · "}
                    {systemName}
                  </span>
                ) : null}
                <span className="ml-2 font-normal text-slate-400">
                  {t("age", { age: formatAge(now - fix.at, t) })}
                </span>
              </p>
              {geo ? (
                <p className="text-slate-400">
                  {t("geo", {
                    altitude: formatDistance(geo.altitude, format),
                    latitude: format.number(geo.latitude, {
                      maximumFractionDigits: 2,
                    }),
                    longitude: format.number(geo.longitude, {
                      maximumFractionDigits: 2,
                    }),
                  })}
                </p>
              ) : null}
              {nearest ? (
                <p className="text-slate-400">
                  {t("nearest", {
                    name: nearest.place.name,
                    distance: formatDistance(nearest.distance, format),
                  })}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[11px] uppercase tracking-wide text-slate-500">
                {t("destination")}
              </p>
              <button
                type="button"
                onClick={() => setPanel("destination")}
                disabled={locked}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
              >
                <Search className="size-3" />
                {t("choose")}
              </button>
              <button
                type="button"
                onClick={() => setPanel("coordinates")}
                disabled={locked || bodies.length === 0}
                title={t("coordinatesHint")}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
              >
                <Keyboard className="size-3" />
                {t("coordinates")}
              </button>
              {destination ? (
                <button
                  type="button"
                  onClick={() => void setDestination(null)}
                  disabled={locked}
                  title={t("clearDestination")}
                  className="rounded p-0.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
                >
                  <span className="sr-only">{t("clearDestination")}</span>
                  <X className="size-3" />
                </button>
              ) : null}
            </div>

            {data.isPending ? (
              <p className="text-[12px] text-slate-500">…</p>
            ) : data.isError ? (
              <p className="text-[12px] text-slate-400">
                {t("loadFailed")}
                <button
                  type="button"
                  onClick={() => void data.refetch()}
                  className="ml-1 underline underline-offset-2 hover:text-slate-200"
                >
                  {t("retry")}
                </button>
              </p>
            ) : !target ? (
              <p className="text-[12px] text-slate-400">
                {places.length === 0 ? t("noPlaces") : t("noDestination")}
              </p>
            ) : (
              <>
                <p className="truncate text-[13px] font-medium">
                  {target.name}
                </p>
                {target.manual ? (
                  <p className="truncate text-[11px] text-slate-500">
                    {t("manualWhere", {
                      where: target.bodyName ?? target.systemName ?? t("space"),
                    })}
                  </p>
                ) : null}
                {elsewhere ? (
                  <p className="text-[12px] text-slate-400">
                    {t("otherSystem", {
                      system: target.systemName ?? "?",
                    })}
                  </p>
                ) : !fix ? (
                  <p className="text-[12px] text-slate-400">{t("needFix")}</p>
                ) : !guidance ? (
                  <p className="text-[12px] text-slate-400">
                    {t("unknownBody")}
                  </p>
                ) : (
                  <Guidance
                    guidance={guidance}
                    hasPrevious={Boolean(previous)}
                    live={fix.source === "screen"}
                  />
                )}
              </>
            )}
          </section>

          {fix ? (
            <button
              type="button"
              onClick={() => setPanel("record")}
              disabled={locked}
              className="mt-auto flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-slate-400 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
            >
              <MapPinPlus className="size-4" />
              {t("record")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The destination as stored, with what the overlay shows of it. */
function targetOf(
  destination: NpsDestination | null,
  places: NpsPlace[],
  bodies: NpsBody[],
  manualName: string,
): Target | null {
  if (!destination) return null;
  if ("slug" in destination) {
    const place = places.find((one) => one.slug === destination.slug);
    return place
      ? {
          name: place.name,
          manual: false,
          systemSlug: place.systemSlug,
          systemName: place.systemName,
          bodyName: place.bodyName,
          position: place.position,
        }
      : null;
  }
  const { name, systemSlug, position } = destination.point;
  return {
    name: name || manualName,
    manual: true,
    systemSlug,
    systemName: bodies.find((one) => one.systemSlug === systemSlug)?.systemName,
    bodyName: bodies.find((one) => one.slug === position.body)?.name,
    position,
  };
}

type Formatter = ReturnType<typeof useFormatter>;

/** As the game writes distances: metres, kilometres, then Mm and Gm. */
function formatDistance(meters: number, format: Formatter): string {
  const abs = Math.abs(meters);
  const [value, unit, digits] =
    abs < 1_000
      ? [meters, "m", 0]
      : abs < 100_000
        ? [meters / 1_000, "km", 1]
        : abs < 10_000_000
          ? [meters / 1_000, "km", 0]
          : abs < 1_000_000_000
            ? [meters / 1_000_000, "Mm", 1]
            : [meters / 1_000_000_000, "Gm", 2];
  return `${format.number(value, { maximumFractionDigits: digits })} ${unit}`;
}

function formatAge(
  ms: number,
  t: ReturnType<typeof useTranslations<"NpsOverlay">>,
): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t("seconds", { count: seconds });
  return t("minutes", { count: Math.floor(seconds / 60) });
}

function formatDuration(
  seconds: number,
  t: ReturnType<typeof useTranslations<"NpsOverlay">>,
): string {
  const total = Math.round(seconds);
  if (total < 60) return t("seconds", { count: total });
  if (total < 3600) {
    return t("minutesSeconds", {
      minutes: Math.floor(total / 60),
      seconds: total % 60,
    });
  }
  return t("hoursMinutes", {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
  });
}

function Guidance({
  guidance,
  hasPrevious,
  live,
}: {
  guidance: NonNullable<ReturnType<typeof guide>>;
  hasPrevious: boolean;
  /** Followed off the screen: no need to refresh by hand. */
  live: boolean;
}) {
  const t = useTranslations("NpsOverlay");
  const format = useFormatter();
  const { surface, turn } = guidance;

  const TurnIcon = !turn
    ? null
    : !turn.signed || Math.abs(turn.degrees) < AHEAD_DEGREES
      ? ArrowUp
      : turn.degrees < 0
        ? ArrowLeft
        : ArrowRight;

  return (
    <div className="space-y-1.5">
      <NpsCompass guidance={guidance} />
      <p className="text-2xl font-semibold tabular-nums">
        {formatDistance(surface?.distance ?? guidance.distance, format)}
      </p>
      {surface ? (
        <p className="flex items-center gap-1.5 text-[13px]">
          <Navigation
            className="size-3.5 text-sky-300"
            style={{ transform: `rotate(${surface.heading - 45}deg)` }}
          />
          {t("heading", {
            degrees: Math.round(surface.heading),
            point: t(`compass.${compassPoint(surface.heading)}`),
          })}
          <span className="text-slate-400">
            ·{" "}
            {t("straight", {
              distance: formatDistance(guidance.distance, format),
            })}
          </span>
        </p>
      ) : null}

      {turn && TurnIcon ? (
        <p className="flex items-center gap-1.5 text-[13px]">
          <TurnIcon className="size-4 text-sky-300" />
          {!turn.signed
            ? t("offCourse", { degrees: Math.round(turn.degrees) })
            : Math.abs(turn.degrees) < AHEAD_DEGREES
              ? t("ahead")
              : turn.degrees < 0
                ? t("turnLeft", { degrees: Math.round(-turn.degrees) })
                : t("turnRight", { degrees: Math.round(turn.degrees) })}
        </p>
      ) : (
        <p className="text-[11px] text-slate-400">
          {live
            ? t("moveLive")
            : hasPrevious
              ? t("moveMore")
              : t("moveThenRefresh")}
        </p>
      )}

      {guidance.closingSpeed !== undefined ? (
        <p className="text-[12px] text-slate-400">
          {guidance.closingSpeed > MIN_CLOSING_SPEED
            ? t("closing", {
                speed: format.number(guidance.closingSpeed, {
                  maximumFractionDigits: 0,
                }),
                eta: formatDuration(guidance.eta ?? 0, t),
              })
            : guidance.closingSpeed < -MIN_CLOSING_SPEED
              ? t("receding")
              : t("steady")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Following the player off the screen: the game's debug lines, read every
 * second or so in the box the player drew around them.
 */
function ScreenTracking({
  settings,
  status,
  calibration,
  locked,
  onChange,
  onCalibrate,
}: {
  settings: NpsScreenSettings;
  status: ScreenStatus;
  calibration: "found" | "empty" | "tooSmall" | null;
  locked: boolean;
  onChange: (settings: NpsScreenSettings) => void;
  onCalibrate: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  const format = useFormatter();
  const calibrated = settings.region !== null;

  const message =
    calibration === "tooSmall"
      ? { tone: "text-amber-200", text: t("screen.tooSmall") }
      : !calibrated
        ? { tone: "text-slate-400", text: t("screen.setup") }
        : calibration === "empty"
          ? { tone: "text-amber-200", text: t("screen.calibrationEmpty") }
          : !settings.enabled
            ? null
            : status.state === "unreadable"
              ? { tone: "text-amber-200", text: t("screen.unreadable") }
              : status.state === "failed"
                ? {
                    tone: "text-red-300",
                    text: t("screen.failed", { message: status.message }),
                  }
                : status.state === "reading"
                  ? { tone: "text-sky-200", text: t("screen.reading") }
                  : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={locked || !calibrated}
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          aria-pressed={settings.enabled}
          title={settings.enabled ? t("screen.stop") : t("screen.start")}
          className={cn(
            "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition disabled:opacity-40",
            settings.enabled && calibrated
              ? "border-sky-300/40 bg-sky-300/10 text-sky-100 hover:bg-sky-300/20"
              : "border-white/15 bg-white/5 hover:bg-white/10",
          )}
        >
          <Radar className="size-3.5 shrink-0" />
          <span className="truncate">
            {settings.enabled && calibrated ? t("screen.on") : t("screen.off")}
          </span>
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={onCalibrate}
          title={t("screen.calibrateHint")}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[12px] transition hover:bg-white/10 disabled:opacity-40"
        >
          <ScanText className="size-3.5" />
          {calibrated ? t("screen.recalibrate") : t("screen.calibrate")}
        </button>
        <select
          value={settings.intervalMs}
          disabled={locked}
          onChange={(event) =>
            onChange({ ...settings, intervalMs: Number(event.target.value) })
          }
          title={t("screen.interval")}
          aria-label={t("screen.interval")}
          className="shrink-0 rounded-lg border border-white/15 bg-black/40 px-1 py-1 text-[12px] text-slate-200 focus:outline-none disabled:opacity-40"
        >
          {SCREEN_INTERVALS.map((ms) => (
            <option key={ms} value={ms}>
              {t("screen.every", {
                seconds: format.number(ms / 1000, {
                  maximumFractionDigits: 1,
                }),
              })}
            </option>
          ))}
        </select>
      </div>
      {message ? (
        <p className={cn("text-[11px]", message.tone)}>{message.text}</p>
      ) : null}
    </div>
  );
}

/** The recorded places, filtered as one types: there are hundreds, not more. */
function DestinationPicker({
  places,
  onPick,
  onCancel,
}: {
  places: NpsPlace[];
  onPick: (slug: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const shown = places
    .filter(
      (place) =>
        !needle ||
        [place.name, place.parentName, place.bodyName, place.systemName].some(
          (name) => name?.toLowerCase().includes(needle),
        ),
    )
    .slice(0, 30);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      <PickerHeader title={t("chooseTitle")} onCancel={onCancel} />
      <input
        autoFocus
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("searchPlaceholder")}
        className="shrink-0 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
      />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {places.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-slate-400">
            {t("noPlaces")}
          </p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-slate-500">
            {t("noResults")}
          </p>
        ) : (
          shown.map((place) => (
            <button
              key={place.slug}
              type="button"
              onClick={() => onPick(place.slug)}
              className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10"
            >
              <span className="block truncate text-[13px] text-slate-100">
                {place.name}
              </span>
              <span className="block truncate text-[11px] text-slate-400">
                {[place.systemName, place.bodyName, place.parentName]
                  .filter(
                    (name, index, all) => !!name && all.indexOf(name) === index,
                  )
                  .join(" › ")}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Proposes the latest reading as the position of a place. Any place of the
 * catalogue, recorded or not: correcting a position is a contribution too.
 */
function RecordPanel({
  fix,
  system,
  positionFor,
  onDone,
}: {
  fix: Fix;
  /** Where the player is, if known: a place of another system is refused. */
  system: string | null;
  positionFor: () => ReturnType<typeof positionOf>;
  onDone: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const [picked, setPicked] = useState<{
    slug: string;
    name: string;
    systemSlug?: string;
    systemName?: string;
  } | null>(null);
  const elsewhere = picked ? !inSystem(picked, system) : false;
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<
    { ok: true; published: boolean } | { ok: false; message: string } | null
  >(null);

  const results = useQuery({
    queryKey: ["nps-record-picker", query],
    queryFn: () => listPlaces({ query: query || undefined, limit: 8 }),
    enabled: !picked,
  });

  async function send() {
    if (!picked || elsewhere) return;
    setSending(true);
    try {
      const answer = await submitPlacePosition(picked.slug, positionFor());
      setResult({
        ok: true,
        published: answer.contribution.status === "published",
      });
      void queryClient.invalidateQueries({ queryKey: ["nps"] });
    } catch (error) {
      setResult({ ok: false, message: positionErrorMessage(error) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      <PickerHeader title={t("recordTitle")} onCancel={onDone} />

      {result?.ok ? (
        <div className="space-y-2 text-[13px]">
          <p>{result.published ? t("recordPublished") : t("recordPending")}</p>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-white/15 px-3 py-1 text-[12px] transition hover:bg-white/10"
          >
            {t("back")}
          </button>
        </div>
      ) : picked ? (
        <div className="space-y-2 text-[13px]">
          <p>{t("recordConfirm", { name: picked.name })}</p>
          <p className="text-[11px] text-slate-400">
            {t("recordHint", { age: Math.round((Date.now() - fix.at) / 1000) })}
          </p>
          {elsewhere ? (
            <p className="text-[12px] text-red-300">
              {t("recordOtherSystem", { system: picked.systemName ?? "?" })}
            </p>
          ) : null}
          {result && !result.ok ? (
            <p className="text-[12px] text-red-300">{result.message}</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={sending || elsewhere}
              onClick={() => void send()}
              className="rounded-lg border border-sky-300/40 bg-sky-300/10 px-3 py-1 text-[12px] font-medium transition hover:bg-sky-300/20 disabled:opacity-50"
            >
              {sending ? "…" : t("recordSend")}
            </button>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setResult(null);
              }}
              className="rounded-lg px-3 py-1 text-[12px] text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
            >
              {t("recordOther")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="shrink-0 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {results.isPending ? (
              <p className="px-1 py-2 text-[12px] text-slate-500">…</p>
            ) : results.isError ? (
              <p className="px-1 py-2 text-[12px] text-slate-500">
                {t("searchFailed")}
              </p>
            ) : results.data.places.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-slate-500">
                {t("noResults")}
              </p>
            ) : (
              results.data.places.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() =>
                    setPicked({
                      slug: place.slug,
                      name: place.name,
                      systemSlug: place.systemSlug,
                      systemName: place.systemName,
                    })
                  }
                  className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10"
                >
                  <span className="block truncate text-[13px] text-slate-100">
                    {place.name}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {[place.systemName, place.bodyName, place.parentName]
                      .filter(
                        (name, index, all) =>
                          !!name && all.indexOf(name) === index,
                      )
                      .join(" › ")}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PickerHeader({
  title,
  onCancel,
}: {
  title: string;
  onCancel: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        title={t("back")}
        className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
      >
        <span className="sr-only">{t("back")}</span>
        <ArrowLeft className="size-4" />
      </button>
      <p className="text-[13px] font-medium">{title}</p>
    </div>
  );
}

type ManualPoint = Extract<NpsDestination, { point: unknown }>["point"];

/**
 * A destination typed in by hand. On a planet or a moon, by latitude,
 * longitude and altitude, as the NPS shows them under « Ma position »: the
 * ground turns, so a position in the system frame would be wrong a minute
 * later. In space, by the system coordinates `/showlocation` gives, which
 * can be pasted whole.
 */
function CoordinatesPanel({
  bodies,
  system,
  currentBody,
  onPick,
  onCancel,
}: {
  bodies: NpsBody[];
  /** The system the player is in, if known: its bodies come first. */
  system: string | null;
  currentBody: NpsBody | null;
  onPick: (point: ManualPoint) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  const [mode, setMode] = useState<"body" | "space">(
    currentBody ? "body" : "space",
  );
  const [name, setName] = useState("");
  const [bodySlug, setBodySlug] = useState(
    () =>
      currentBody?.slug ??
      bodies.find((one) => inSystem(one, system))?.slug ??
      bodies[0]?.slug ??
      "",
  );
  const [geo, setGeo] = useState({ latitude: "", longitude: "", altitude: "" });
  const [xyz, setXyz] = useState({ x: "", y: "", z: "" });
  const [unit, setUnit] = useState<"m" | "km">("m");
  const [invalid, setInvalid] = useState(false);

  // By system, the player's own first, then by name.
  const groups = useMemo(() => {
    const bySystem = new Map<string, NpsBody[]>();
    for (const one of bodies) {
      const key = one.systemName ?? one.systemSlug ?? "";
      bySystem.set(key, [...(bySystem.get(key) ?? []), one]);
    }
    return [...bySystem.entries()]
      .map(([label, list]) => ({
        label,
        mine: list.some((one) => one.systemSlug === system),
        list: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort(
        (a, b) =>
          Number(b.mine) - Number(a.mine) || a.label.localeCompare(b.label),
      );
  }, [bodies, system]);

  function pasted(event: ClipboardEvent) {
    const point = parseGameCoordinates(event.clipboardData.getData("text"));
    if (!point) return;
    event.preventDefault();
    setUnit("m");
    setXyz({ x: String(point.x), y: String(point.y), z: String(point.z) });
    setInvalid(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const label = name.trim() || undefined;

    if (mode === "body") {
      const body = bodies.find((one) => one.slug === bodySlug);
      const latitude = parseNumber(geo.latitude);
      const longitude = parseNumber(geo.longitude);
      const altitude = geo.altitude.trim() ? parseNumber(geo.altitude) : 0;
      if (
        !body ||
        latitude === null ||
        longitude === null ||
        altitude === null ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 360
      ) {
        setInvalid(true);
        return;
      }
      const local = fromGeo({ latitude, longitude, altitude }, body);
      onPick({
        name: label,
        systemSlug: body.systemSlug,
        position: { body: body.slug, ...local },
      });
      return;
    }

    const factor = unit === "km" ? 1000 : 1;
    const [x, y, z] = [xyz.x, xyz.y, xyz.z].map(parseNumber);
    if (x === null || y === null || z === null) {
      setInvalid(true);
      return;
    }
    const point = { x: x * factor, y: y * factor, z: z * factor };
    // Close to a body, the point turns with it from now on.
    const position = positionOf({ ...point, at: Date.now() }, bodies);
    onPick({
      name: label,
      systemSlug: bodyAt(point, bodies)?.systemSlug ?? system ?? undefined,
      position,
    });
  }

  const field =
    "min-w-0 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[13px] text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none";

  return (
    <form
      onSubmit={submit}
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3"
    >
      <PickerHeader title={t("coordinatesTitle")} onCancel={onCancel} />

      <div className="flex shrink-0 gap-1 rounded-lg border border-white/10 p-0.5 text-[12px]">
        {(["body", "space"] as const).map((one) => (
          <button
            key={one}
            type="button"
            aria-pressed={mode === one}
            onClick={() => {
              setMode(one);
              setInvalid(false);
            }}
            className={cn(
              "flex-1 rounded-md px-2 py-1 transition",
              mode === one
                ? "bg-white/15 text-slate-100"
                : "text-slate-400 hover:bg-white/10",
            )}
          >
            {one === "body" ? t("manual.onBody") : t("manual.inSpace")}
          </button>
        ))}
      </div>

      {mode === "body" ? (
        <>
          <label className="space-y-0.5 text-[11px] text-slate-400">
            <span>{t("manual.body")}</span>
            <select
              value={bodySlug}
              onChange={(event) => {
                setBodySlug(event.target.value);
                setInvalid(false);
              }}
              className={cn(field, "block w-full")}
            >
              {groups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.list.map((one) => (
                    <option key={one.slug} value={one.slug}>
                      {one.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["latitude", "longitude", "altitude"] as const).map((key) => (
              <label
                key={key}
                className="space-y-0.5 text-[11px] text-slate-400"
              >
                <span>{t(`manual.${key}`)}</span>
                <input
                  value={geo[key]}
                  inputMode="decimal"
                  autoFocus={key === "latitude"}
                  placeholder={key === "altitude" ? "0" : undefined}
                  onChange={(event) => {
                    setGeo({ ...geo, [key]: event.target.value });
                    setInvalid(false);
                  }}
                  className={cn(field, "block w-full")}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">{t("manual.bodyHint")}</p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-1.5">
            {(["x", "y", "z"] as const).map((key) => (
              <label
                key={key}
                className="space-y-0.5 text-[11px] text-slate-400"
              >
                <span>{key.toUpperCase()}</span>
                <input
                  value={xyz[key]}
                  inputMode="decimal"
                  autoFocus={key === "x"}
                  onPaste={pasted}
                  onChange={(event) => {
                    setXyz({ ...xyz, [key]: event.target.value });
                    setInvalid(false);
                  }}
                  className={cn(field, "block w-full")}
                />
              </label>
            ))}
            <select
              value={unit}
              onChange={(event) => setUnit(event.target.value as "m" | "km")}
              aria-label={t("manual.unit")}
              className={cn(field, "px-1")}
            >
              <option value="m">m</option>
              <option value="km">km</option>
            </select>
          </div>
          <p className="text-[11px] text-slate-500">{t("manual.spaceHint")}</p>
        </>
      )}

      <label className="space-y-0.5 text-[11px] text-slate-400">
        <span>{t("manual.name")}</span>
        <input
          value={name}
          maxLength={60}
          placeholder={t("manualName")}
          onChange={(event) => setName(event.target.value)}
          className={cn(field, "block w-full")}
        />
      </label>

      {invalid ? (
        <p className="text-[12px] text-red-300">
          {mode === "body" ? t("manual.invalidGeo") : t("manual.invalidXyz")}
        </p>
      ) : null}

      <button
        type="submit"
        className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-sky-300/40 bg-sky-300/10 px-3 py-1.5 text-[12px] font-medium transition hover:bg-sky-300/20"
      >
        <Navigation className="size-3.5" />
        {t("manual.go")}
      </button>
    </form>
  );
}
