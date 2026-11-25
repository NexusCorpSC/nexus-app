import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useFormatter, useTranslations } from "use-intl";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Pause,
  Pickaxe,
  Power,
  ScanText,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { useOverlayMode } from "@/hooks/use-overlay-opacity";
import { useOverlayLocked } from "@/hooks/use-overlay-lock";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { OverlayLockButton } from "@/components/overlay-lock-button";
import { overlaySkin } from "@/lib/overlay-opacity";
import {
  DEFAULT_MINING_SCREEN,
  getMiningScreen,
  setMiningScreen,
  type MiningScreenSettings,
  type NpsScreenRegion,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

/** A reading of the gauge, from `src-tauri/src/mining_screen.rs`. */
const READING_EVENT = "mining://reading";

/** How the reading off the screen goes, each time it changes. */
const STATUS_EVENT = "mining://status";

/** The box drawn around the gauge, and what was read in it. */
const CALIBRATED_EVENT = "mining://calibrated";

/** The intervals offered for reading the screen, in milliseconds. */
const SCREEN_INTERVALS = [100, 250, 500, 1000];

/** How long what the automatic mode did stays said. */
const ACTED_SHOWN_MS = 2500;

type ScreenStatus =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "unreadable" }
  | { state: "failed"; message: string };

/** Fractions of the box's height, from its top: smaller is higher. */
type Gauge = {
  charge: number | null;
  chargeBase: number | null;
  window: [number, number] | null;
  overcharge: number | null;
};

type Advice = "off" | "raise" | "hold" | "lower" | "cut";

type Act = "raised" | "lowered" | "cut" | "notFocused";

type Reading = {
  gauge: Gauge;
  advice: Advice;
  rising: boolean;
  acted: Act | null;
  at: number;
};

type Calibration = { state: "found" } | { state: "empty" } | { state: "tooSmall" };

const ADVICE_LOOK: Record<Advice, { icon: LucideIcon; tone: string }> = {
  off: { icon: Power, tone: "text-nexus-muted border-nexus-accent/15" },
  raise: { icon: ArrowUp, tone: "text-sky-300 border-sky-400/40 bg-sky-400/10" },
  hold: {
    icon: Pause,
    tone: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10",
  },
  lower: {
    icon: ArrowDown,
    tone: "text-amber-300 border-amber-400/40 bg-amber-400/10",
  },
  cut: { icon: Ban, tone: "text-red-300 border-red-400/50 bg-red-500/15" },
};

function detailKey(reading: Reading) {
  switch (reading.advice) {
    case "hold":
      if (!reading.gauge.window) return "detail.holdNoWindow" as const;
      if (
        reading.gauge.charge !== null &&
        reading.gauge.charge > reading.gauge.window[1]
      )
        return "detail.holdRising" as const;
      return "detail.holdWindow" as const;
    default:
      return `detail.${reading.advice}` as const;
  }
}

/**
 * Mining assistance over the game: the charge gauge of the mining HUD, read
 * off the screen in a box the player drew once, and what to do with the
 * laser — raise the power, hold, lower it, or cut it.
 *
 * The advice is only shown unless the player turns the automatic mode on,
 * after a warning: then Rust acts on it with the wheel and a click.
 */
export default function MiningOverlayPage() {
  const t = useTranslations("MiningOverlay");

  useTransparentWindow();
  const mode = useOverlayMode("mining");
  const locked = useOverlayLocked("mining");

  const [screen, setScreen] =
    useState<MiningScreenSettings>(DEFAULT_MINING_SCREEN);
  const [screenLoaded, setScreenLoaded] = useState(false);
  const [status, setStatus] = useState<ScreenStatus>({ state: "idle" });
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [acted, setActed] = useState<{ act: Act; at: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void getMiningScreen()
      .then((stored) => {
        if (!alive) return;
        setScreen(stored);
        setScreenLoaded(true);
      })
      .catch((error) => console.error("cannot read the mining settings", error));

    const readings = listen<Reading>(READING_EVENT, (event) => {
      setReading(event.payload);
      const act = event.payload.acted;
      if (act) setActed({ act, at: event.payload.at });
    });
    const statusChange = listen<ScreenStatus>(STATUS_EVENT, (event) => {
      setStatus(event.payload);
      if (event.payload.state !== "reading") setReading(null);
      if (event.payload.state !== "idle") setCalibration(null);
    });
    const calibrated = listen<{
      region: NpsScreenRegion | null;
      gauge: Gauge | null;
    }>(CALIBRATED_EVENT, (event) => {
      const { region, gauge } = event.payload;
      if (!region) {
        setCalibration({ state: "tooSmall" });
        return;
      }
      setCalibration(gauge ? { state: "found" } : { state: "empty" });
      // A box that reads turns the reading on: that is what it was drawn for.
      setScreen((last) => ({
        ...last,
        region,
        enabled: last.enabled || gauge !== null,
      }));
    });

    return () => {
      alive = false;
      void readings.then((stop) => stop()).catch(() => {});
      void statusChange.then((stop) => stop()).catch(() => {});
      void calibrated.then((stop) => stop()).catch(() => {});
    };
  }, []);

  // Rust reads the screen; the settings live here, in the store.
  useEffect(() => {
    if (!screenLoaded) return;
    void invoke("mining_screen_configure", { settings: screen }).catch(
      (error) => console.error("cannot apply the mining settings", error),
    );
    void setMiningScreen(screen).catch((error) =>
      console.error("cannot save the mining settings", error),
    );
  }, [screen, screenLoaded]);

  // What the automatic mode did fades after a moment.
  useEffect(() => {
    if (!acted) return;
    const timer = window.setTimeout(() => setActed(null), ACTED_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [acted]);

  function close() {
    void invoke("close_mining_overlay");
  }

  function calibrate() {
    setCalibration(null);
    void invoke("mining_calibrate").catch((error) =>
      console.error("cannot start the mining calibration", error),
    );
  }

  function setAuto(auto: boolean) {
    setConfirming(false);
    setScreen((last) => ({ ...last, auto }));
  }

  const look = reading ? ADVICE_LOOK[reading.advice] : null;
  const AdviceIcon = look?.icon;

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
          mode === "opaque" ? "border-b border-nexus-accent/10" : null,
        )}
      >
        <Pickaxe className="pointer-events-none size-4 text-nexus-muted" />
        <p className="pointer-events-none flex-1 truncate text-sm font-medium text-nexus-bright">
          {t("title")}
        </p>
        {screen.auto ? (
          <span className="pointer-events-none rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-200">
            {t("auto.on")}
          </span>
        ) : null}
        <OverlayOpacityButton label="mining" mode={mode} />
        <OverlayLockButton label="mining" locked={locked} />
        <button
          type="button"
          onClick={close}
          title={t("close")}
          className="rounded p-1 text-nexus-muted transition hover:bg-nexus-accent/10 hover:text-nexus-white"
        >
          <span className="sr-only">{t("close")}</span>
          <X className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-nexus-white">
        {reading && look && AdviceIcon ? (
          <section className="flex items-stretch gap-3">
            <GaugeBar gauge={reading.gauge} label={t("gauge")} />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-nexus-sm border px-2.5 py-2",
                  look.tone,
                )}
              >
                <AdviceIcon className="size-6 shrink-0" />
                <p className="text-lg font-semibold leading-tight">
                  {t(`advice.${reading.advice}`)}
                </p>
              </div>
              <p className="text-[12px] text-nexus-soft">
                {t(detailKey(reading))}
              </p>
              {acted ? (
                <p
                  className={cn(
                    "text-[11px]",
                    acted.act === "notFocused"
                      ? "text-amber-200"
                      : "text-nexus-muted",
                  )}
                >
                  {t(`acted.${acted.act}`)}
                </p>
              ) : null}
            </div>
          </section>
        ) : (
          <p className="text-[12px] text-nexus-muted">{t("waiting")}</p>
        )}

        <ScreenReading
          settings={screen}
          status={status}
          calibration={calibration}
          locked={locked}
          onChange={setScreen}
          onCalibrate={calibrate}
        />

        <section className="space-y-1.5 rounded-nexus-sm border border-nexus-accent/10 bg-nexus-accent/5 p-2">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[12px] font-medium text-nexus-bright">
              {t("auto.label")}
            </p>
            {screen.auto ? (
              <button
                type="button"
                disabled={locked}
                onClick={() => setAuto(false)}
                className="rounded-nexus-sm border border-red-400/40 bg-red-500/15 px-2 py-0.5 text-[12px] text-red-100 transition hover:bg-red-500/25 disabled:opacity-40"
              >
                {t("auto.disable")}
              </button>
            ) : (
              <button
                type="button"
                disabled={locked || screen.region === null}
                onClick={() => setConfirming((open) => !open)}
                aria-expanded={confirming}
                className="rounded-nexus-sm border border-nexus-accent/15 bg-nexus-accent/5 px-2 py-0.5 text-[12px] transition hover:bg-nexus-accent/10 disabled:opacity-40"
              >
                {t("auto.label")}
              </button>
            )}
          </div>

          {confirming && !screen.auto ? (
            <div className="space-y-1.5 rounded-nexus-sm border border-amber-400/30 bg-amber-400/10 p-2">
              <p className="flex gap-1.5 text-[11px] text-amber-100">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {t("auto.warning")}
              </p>
              <button
                type="button"
                disabled={locked}
                onClick={() => setAuto(true)}
                className="w-full rounded-nexus-sm border border-amber-400/40 bg-amber-400/15 px-2 py-1 text-[12px] text-amber-50 transition hover:bg-amber-400/25 disabled:opacity-40"
              >
                {t("auto.confirm")}
              </button>
            </div>
          ) : null}

          {screen.auto || confirming ? (
            <div className="space-y-1">
              <p className="text-[11px] text-nexus-muted">{t("auto.focus")}</p>
              <Toggle
                checked={screen.wheelUpRaises}
                disabled={locked}
                label={t("auto.wheelUpRaises")}
                onChange={(wheelUpRaises) =>
                  setScreen((last) => ({ ...last, wheelUpRaises }))
                }
              />
              <Toggle
                checked={screen.autoCut}
                disabled={locked}
                label={t("auto.autoCut")}
                onChange={(autoCut) =>
                  setScreen((last) => ({ ...last, autoCut }))
                }
              />
              <label className="flex items-center justify-between gap-2 text-[12px] text-nexus-soft">
                {t("auto.notches")}
                <select
                  value={screen.notches}
                  disabled={locked}
                  onChange={(event) =>
                    setScreen((last) => ({
                      ...last,
                      notches: Number(event.target.value),
                    }))
                  }
                  className="rounded-nexus-sm border border-nexus-accent/15 bg-black/40 px-1 py-0.5 text-[12px] text-nexus-bright focus:outline-none disabled:opacity-40"
                >
                  {[1, 2, 3, 5].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-nexus-soft">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-nexus-accent"
      />
      {label}
    </label>
  );
}

/**
 * The gauge as it was read, upright: the overcharge in red at the top, the
 * green window, and the charge climbing from the bottom.
 */
function GaugeBar({ gauge, label }: { gauge: Gauge; label: string }) {
  // The arc runs from its base to the top of the box; what is above the
  // overcharge block's edge is all overcharge.
  const base = gauge.chargeBase ?? 1;
  const height = (fraction: number) =>
    `${Math.max(0, Math.min(100, ((base - fraction) / base) * 100))}%`;

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className="relative w-4 shrink-0 overflow-hidden rounded-sm border border-nexus-accent/20 bg-black/40"
      style={{ minHeight: "6rem" }}
    >
      {gauge.overcharge !== null ? (
        <div
          className="absolute inset-x-0 top-0 bg-red-500/40"
          style={{ bottom: height(gauge.overcharge) }}
        />
      ) : null}
      {gauge.window ? (
        <div
          className="absolute inset-x-0 bg-emerald-500/35"
          style={{
            bottom: height(gauge.window[1]),
            top: `calc(100% - ${height(gauge.window[0])})`,
          }}
        />
      ) : null}
      {gauge.charge !== null ? (
        <div
          className="absolute inset-x-1 bottom-0 rounded-sm bg-emerald-300"
          style={{ height: height(gauge.charge) }}
        />
      ) : null}
    </div>
  );
}

/** Reading the gauge off the screen: the box drawn around the arc. */
function ScreenReading({
  settings,
  status,
  calibration,
  locked,
  onChange,
  onCalibrate,
}: {
  settings: MiningScreenSettings;
  status: ScreenStatus;
  calibration: Calibration | null;
  locked: boolean;
  onChange: (update: (last: MiningScreenSettings) => MiningScreenSettings) => void;
  onCalibrate: () => void;
}) {
  const t = useTranslations("MiningOverlay");
  const format = useFormatter();
  const calibrated = settings.region !== null;

  const message =
    calibration?.state === "tooSmall"
      ? { tone: "text-amber-200", text: t("screen.tooSmall") }
      : !calibrated
        ? { tone: "text-nexus-muted", text: t("screen.setup") }
        : calibration?.state === "empty"
          ? { tone: "text-amber-200", text: t("screen.calibrationEmpty") }
          : calibration?.state === "found"
            ? { tone: "text-nexus-soft", text: t("screen.calibrationFound") }
            : !settings.enabled
              ? null
              : status.state === "unreadable"
                ? { tone: "text-amber-200", text: t("screen.unreadable") }
                : status.state === "failed"
                  ? {
                      tone: "text-red-300",
                      text: t("screen.failed", { message: status.message }),
                    }
                  : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={locked || !calibrated}
          onClick={() => onChange((last) => ({ ...last, enabled: !last.enabled }))}
          aria-pressed={settings.enabled}
          title={settings.enabled ? t("screen.stop") : t("screen.start")}
          className={cn(
            "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-nexus-sm border px-2 py-1 text-[12px] transition disabled:opacity-40",
            settings.enabled && calibrated
              ? "border-nexus-accent/40 bg-nexus-accent/10 text-nexus-white hover:bg-nexus-accent/20"
              : "border-nexus-accent/15 bg-nexus-accent/5 hover:bg-nexus-accent/10",
          )}
        >
          <Pickaxe className="size-3.5 shrink-0" />
          <span className="truncate">
            {settings.enabled && calibrated ? t("screen.on") : t("screen.off")}
          </span>
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={onCalibrate}
          title={t("screen.calibrateHint")}
          className="flex shrink-0 items-center gap-1 rounded-nexus-sm border border-nexus-accent/15 bg-nexus-accent/5 px-2 py-1 text-[12px] transition hover:bg-nexus-accent/10 disabled:opacity-40"
        >
          <ScanText className="size-3.5" />
          {calibrated ? t("screen.recalibrate") : t("screen.calibrate")}
        </button>
        <select
          value={settings.intervalMs}
          disabled={locked}
          onChange={(event) => {
            const intervalMs = Number(event.target.value);
            onChange((last) => ({ ...last, intervalMs }));
          }}
          title={t("screen.interval")}
          aria-label={t("screen.interval")}
          className="shrink-0 rounded-nexus-sm border border-nexus-accent/15 bg-black/40 px-1 py-1 text-[12px] text-nexus-bright focus:outline-none disabled:opacity-40"
        >
          {SCREEN_INTERVALS.map((ms) => (
            <option key={ms} value={ms}>
              {t("screen.every", {
                seconds: format.number(ms / 1000, {
                  maximumFractionDigits: 2,
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
