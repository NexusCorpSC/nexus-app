import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "use-intl";
import { Radar, ScanText, X } from "lucide-react";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { useOverlayMode } from "@/hooks/use-overlay-opacity";
import { useOverlayLocked } from "@/hooks/use-overlay-lock";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { OverlayLockButton } from "@/components/overlay-lock-button";
import { overlaySkin } from "@/lib/overlay-opacity";
import { listRadarSignatures } from "@/lib/api/radar-signatures";
import {
  DEFAULT_RADAR_SCREEN,
  getRadarContext,
  getRadarScreen,
  setRadarContext,
  setRadarScreen,
  type NpsScreenRegion,
  type RadarScreenSettings,
} from "@/lib/settings";
import {
  DEFAULT_RADAR_SIGNATURES,
  RADAR_CONTEXTS,
  identifyRadarSignature,
  parseRadarReading,
  type RadarContext,
  type RadarMatch,
} from "@/lib/radar";
import { cn } from "@/lib/utils";

/** A signature read off the screen, from `src-tauri/src/radar_screen.rs`. */
const READING_EVENT = "radar://reading";

/** How the reading off the screen goes, each time it changes. */
const STATUS_EVENT = "radar://status";

/** The box drawn around the signature, and what was read in it. */
const CALIBRATED_EVENT = "radar://calibrated";

/** The intervals offered for reading the screen, in milliseconds. */
const SCREEN_INTERVALS = [500, 1000, 2000, 5000];

/** How many past signatures stay at hand, to go back to one. */
const HISTORY_SIZE = 6;

/** How often the age of the reading is redrawn. */
const TICK_MS = 1000;

type ScreenStatus =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "unreadable" }
  | { state: "failed"; message: string };

type Calibration =
  | { state: "found"; value: number }
  | { state: "empty" }
  | { state: "tooSmall" };

type Reading = { value: number; at: number };

type Translator = ReturnType<typeof useTranslations<"RadarOverlay">>;

function formatAge(ms: number, t: Translator): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t("seconds", { count: seconds });
  return t("minutes", { count: Math.floor(seconds / 60) });
}

/**
 * The radar signature scanner over the game: the number the scan shows, read
 * off the screen in a box the player drew once (or typed), and what it most
 * likely is — which ore, asteroid or wreck, and how many rocks make it up.
 *
 * The known signatures come from the site, and are cached for when the game
 * is all there is.
 */
export default function RadarOverlayPage() {
  const t = useTranslations("RadarOverlay");
  const format = useFormatter();

  useTransparentWindow();
  const mode = useOverlayMode("radar");
  const locked = useOverlayLocked("radar");

  const [screen, setScreen] =
    useState<RadarScreenSettings>(DEFAULT_RADAR_SCREEN);
  const [screenLoaded, setScreenLoaded] = useState(false);
  const [status, setStatus] = useState<ScreenStatus>({ state: "idle" });
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [current, setCurrent] = useState<Reading | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [manual, setManual] = useState("");
  const [context, setContext] = useState<RadarContext>("all");
  const [now, setNow] = useState(() => Date.now());

  const signatures = useQuery({
    queryKey: ["radar-signatures"],
    queryFn: listRadarSignatures,
    staleTime: 60 * 60 * 1000,
  });
  const known = signatures.data?.signatures ?? DEFAULT_RADAR_SIGNATURES;

  // The last signature the screen gave: Rust sends it again at every
  // reading while it stays on screen, which must not take the place of one
  // typed or picked from the history in the meantime.
  const lastFromScreen = useRef<number | null>(null);

  function show(value: number, at: number) {
    setCurrent({ value, at });
    setHistory((last) =>
      last[0] === value
        ? last
        : [value, ...last.filter((one) => one !== value)].slice(
            0,
            HISTORY_SIZE,
          ),
    );
  }

  useEffect(() => {
    let alive = true;
    void getRadarScreen()
      .then((stored) => {
        if (!alive) return;
        setScreen(stored);
        setScreenLoaded(true);
      })
      .catch((error) => console.error("cannot read the radar settings", error));

    const reading = listen<Reading>(READING_EVENT, (event) => {
      const { value, at } = event.payload;
      if (value === lastFromScreen.current) {
        // The same scan still on screen: it only gets younger, and only if
        // it is the one shown.
        setCurrent((shown) =>
          shown && shown.value === value ? { value, at } : shown,
        );
        return;
      }
      lastFromScreen.current = value;
      show(value, at);
    });
    const statusChange = listen<ScreenStatus>(STATUS_EVENT, (event) => {
      setStatus(event.payload);
      if (event.payload.state !== "idle") setCalibration(null);
    });
    const calibrated = listen<{
      region: NpsScreenRegion | null;
      value: number | null;
    }>(CALIBRATED_EVENT, (event) => {
      const { region, value } = event.payload;
      if (!region) {
        setCalibration({ state: "tooSmall" });
        return;
      }
      setCalibration(
        value === null ? { state: "empty" } : { state: "found", value },
      );
      if (value !== null) {
        lastFromScreen.current = value;
        show(value, Date.now());
      }
      // A box that reads turns the reading on: that is what it was drawn for.
      setScreen((last) => ({
        ...last,
        region,
        enabled: last.enabled || value !== null,
      }));
    });

    return () => {
      alive = false;
      void reading.then((stop) => stop()).catch(() => {});
      void statusChange.then((stop) => stop()).catch(() => {});
      void calibrated.then((stop) => stop()).catch(() => {});
    };
  }, []);

  // Rust reads the screen; the settings live here, in the store.
  useEffect(() => {
    if (!screenLoaded) return;
    void invoke("radar_screen_configure", { settings: screen }).catch((error) =>
      console.error("cannot apply the radar settings", error),
    );
    void setRadarScreen(screen).catch((error) =>
      console.error("cannot save the radar settings", error),
    );
  }, [screen, screenLoaded]);

  useEffect(() => {
    void getRadarContext()
      .then(setContext)
      .catch((error) => console.error("cannot read the radar context", error));
  }, []);

  function pickContext(next: RadarContext) {
    setContext(next);
    void setRadarContext(next).catch((error) =>
      console.error("cannot save the radar context", error),
    );
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const identification = useMemo(
    () =>
      current
        ? identifyRadarSignature(current.value, known, { context })
        : null,
    [current, known, context],
  );

  function close() {
    void invoke("close_radar_overlay");
  }

  function calibrate() {
    setCalibration(null);
    void invoke("radar_calibrate").catch((error) =>
      console.error("cannot start the radar calibration", error),
    );
  }

  function submitManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = parseRadarReading(manual);
    if (value === null) return;
    show(value, Date.now());
    setManual("");
  }

  const number = (value: number) => format.number(value);
  const [best, ...others] = identification?.matches ?? [];

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
        <Radar className="pointer-events-none size-4 text-slate-400" />
        <p className="pointer-events-none flex-1 truncate text-sm font-medium text-slate-200">
          {t("title")}
        </p>
        <OverlayOpacityButton label="radar" mode={mode} />
        <OverlayLockButton label="radar" locked={locked} />
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
        <div
          role="radiogroup"
          aria-label={t("context.label")}
          title={t("context.hint")}
          className="flex gap-1"
        >
          {RADAR_CONTEXTS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={context === option}
              disabled={locked}
              onClick={() => pickContext(option)}
              className={cn(
                "flex-1 rounded border px-1.5 py-0.5 text-[11px] transition disabled:opacity-40",
                context === option
                  ? "border-sky-300/40 bg-sky-300/10 text-sky-100"
                  : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10",
              )}
            >
              {t(`context.${option}`)}
            </button>
          ))}
        </div>

        {current && identification ? (
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-mono text-3xl font-semibold tracking-wide text-sky-100">
                {number(current.value)}
              </p>
              <p className="text-[11px] text-slate-400">
                {t("age", { age: formatAge(now - current.at, t) })}
              </p>
            </div>

            {best ? (
              <>
                <MatchCard match={best} number={number} t={t} highlight />
                {others.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      {t("more")}
                    </p>
                    {others.map((match) => (
                      <MatchCard
                        key={match.signature.id}
                        match={match}
                        number={number}
                        t={t}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="space-y-1">
                <p className="text-[12px] text-amber-200">
                  {t("noMatch", { value: number(current.value) })}
                </p>
                {identification.approximate.length > 0 ? (
                  <>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      {t("approximate")}
                    </p>
                    {identification.approximate.map((match) => (
                      <MatchCard
                        key={match.signature.id}
                        match={match}
                        number={number}
                        t={t}
                      />
                    ))}
                  </>
                ) : null}
              </div>
            )}
          </section>
        ) : (
          <p className="text-[12px] text-slate-400">{t("waiting")}</p>
        )}

        {history.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-slate-400">{t("history")}</span>
            {history.map((value) => (
              <button
                key={value}
                type="button"
                disabled={locked}
                onClick={() => show(value, Date.now())}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[11px] transition disabled:opacity-40",
                  value === current?.value
                    ? "border-sky-300/40 bg-sky-300/10 text-sky-100"
                    : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10",
                )}
              >
                {number(value)}
              </button>
            ))}
          </div>
        ) : null}

        <form onSubmit={submitManual} className="flex gap-1.5">
          <input
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            disabled={locked}
            inputMode="numeric"
            aria-label={t("manual")}
            placeholder={t("manualPlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-mono text-[13px] text-slate-100 placeholder:text-slate-500 focus:border-sky-300/50 focus:outline-none disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={locked || parseRadarReading(manual) === null}
            className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[12px] transition hover:bg-white/10 disabled:opacity-40"
          >
            {t("manual")}
          </button>
        </form>

        <ScreenReading
          settings={screen}
          status={status}
          calibration={calibration}
          locked={locked}
          onChange={setScreen}
          onCalibrate={calibrate}
          number={number}
        />

        {signatures.data ? (
          <p className="text-[10px] text-slate-500">
            {t(`source.${signatures.data.source}`)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MatchCard({
  match,
  number,
  t,
  highlight = false,
}: {
  match: RadarMatch;
  number: (value: number) => string;
  t: Translator;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5",
        highlight
          ? "border-sky-300/40 bg-sky-300/10"
          : "border-white/10 bg-white/5",
      )}
    >
      <div className="min-w-0">
        <p
          className={cn(
            "truncate font-medium",
            highlight
              ? "text-[15px] text-sky-50"
              : "text-[13px] text-slate-200",
          )}
        >
          {match.signature.name}
        </p>
        <p className="truncate text-[11px] text-slate-400">
          {t(`categories.${match.signature.category}`)} ·{" "}
          {t("base", { value: number(match.signature.value) })}
          {match.exact
            ? null
            : ` · ${t("difference", {
                value: `${match.difference > 0 ? "+" : ""}${number(match.difference)}`,
              })}`}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[12px]",
          highlight
            ? "bg-sky-300/20 text-sky-50"
            : "bg-white/10 text-slate-200",
        )}
      >
        {t("count", { count: match.count })}
      </span>
    </div>
  );
}

/**
 * Reading the signature off the screen: the box the player drew around it,
 * read every second or so.
 */
function ScreenReading({
  settings,
  status,
  calibration,
  locked,
  onChange,
  onCalibrate,
  number,
}: {
  settings: RadarScreenSettings;
  status: ScreenStatus;
  calibration: Calibration | null;
  locked: boolean;
  onChange: (settings: RadarScreenSettings) => void;
  onCalibrate: () => void;
  number: (value: number) => string;
}) {
  const t = useTranslations("RadarOverlay");
  const format = useFormatter();
  const calibrated = settings.region !== null;

  const message =
    calibration?.state === "tooSmall"
      ? { tone: "text-amber-200", text: t("screen.tooSmall") }
      : !calibrated
        ? { tone: "text-slate-400", text: t("screen.setup") }
        : calibration?.state === "empty"
          ? { tone: "text-amber-200", text: t("screen.calibrationEmpty") }
          : calibration?.state === "found"
            ? {
                tone: "text-sky-200",
                text: t("screen.calibrationFound", {
                  value: number(calibration.value),
                }),
              }
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
