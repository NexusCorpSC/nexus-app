import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { Badge, Card } from "@/components/ui";
import {
  CREW_ROLE,
  DEPLOYMENT,
  enumName,
  fresh,
  GAME_EVENT,
  levelShare,
  LOCOMOTION,
  MASTER_MODE,
  share,
  type TelemetryStatus,
} from "@/lib/telemetry";
import { cn } from "@/lib/utils";

type Telemetry = TelemetryStatus & { now: number };

/** A share from 0 to 1, as a bar. Red under a quarter. */
function Meter({ label, value }: { label: string; value: number | null }) {
  const format = useFormatter();
  if (value === null) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-nexus-muted">{label}</span>
        <span className="font-mono text-nexus-bright tabular-nums">
          {format.number(value, { style: "percent", maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-nexus-abyss">
        <div
          className={cn(
            "h-full rounded-full",
            value < 0.25 ? "bg-red-400" : "bg-nexus-accent",
          )}
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

function Reading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] tracking-[0.08em] text-nexus-dim uppercase">
        {label}
      </div>
      <div className="truncate font-mono text-[13.5px] text-nexus-bright tabular-nums">
        {children}
      </div>
    </div>
  );
}

/** Where the connection stands, in one badge. */
export function TelemetryBadge({ telemetry }: { telemetry: Telemetry }) {
  const t = useTranslations("Telemetry");
  const actor = fresh(telemetry.snapshot.actor, telemetry.now);
  if (telemetry.connection === "disabled") {
    return <Badge>{t("status.disabled")}</Badge>;
  }
  if (telemetry.connection === "waiting") {
    return <Badge tone="warning">{t("status.waiting")}</Badge>;
  }
  return actor ? (
    <Badge tone="success">{t("status.live")}</Badge>
  ) : (
    <Badge tone="warning">{t("status.noCharacter")}</Badge>
  );
}

/**
 * What the game says of the player and of their vehicle. `compact` keeps the
 * essentials, for the home page.
 */
export function TelemetryPanel({
  telemetry,
  compact = false,
}: {
  telemetry: Telemetry;
  compact?: boolean;
}) {
  const t = useTranslations("Telemetry");
  const format = useFormatter();
  const actor = fresh(telemetry.snapshot.actor, telemetry.now);
  const vehicle = fresh(telemetry.snapshot.vehicle, telemetry.now);

  if (!actor && !vehicle) {
    return (
      <p className="text-[13px] text-nexus-muted">
        {telemetry.connection === "connected"
          ? t("empty.noCharacter")
          : telemetry.connection === "waiting"
            ? t("empty.waiting")
            : t("empty.disabled")}
      </p>
    );
  }

  const number = (value: number | null | undefined, digits = 0) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? "—"
      : format.number(value, { maximumFractionDigits: digits });

  const locomotion = enumName(LOCOMOTION, actor?.state?.locomotion);
  const role = enumName(CREW_ROLE, actor?.state?.crewRole);
  const instruments = vehicle?.flight?.instruments ?? null;
  const flightState = vehicle?.flight?.state ?? null;
  const gear = enumName(DEPLOYMENT, flightState?.gear);
  const masterMode = enumName(MASTER_MODE, vehicle?.masterMode?.mode);
  const coupled = vehicle?.flight?.settings?.ifcsCoupled?.active;

  return (
    <div className={cn("grid gap-4", !compact && "lg:grid-cols-2")}>
      {actor ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Reading label={t("player.balance")}>
              {actor.state
                ? t("player.auec", { amount: number(actor.state.uecBalance) })
                : "—"}
            </Reading>
            {locomotion ? (
              <Badge>
                {t(`locomotion.${locomotion}`)}
                {role ? ` · ${t(`role.${role}`)}` : ""}
              </Badge>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Meter
              label={t("player.health")}
              value={share(actor.vitals?.health)}
            />
            <Meter
              label={t("player.oxygen")}
              value={share(actor.vitals?.oxygen)}
            />
            {!compact ? (
              <>
                <Meter
                  label={t("player.hunger")}
                  value={share(actor.vitals?.hunger)}
                />
                <Meter
                  label={t("player.thirst")}
                  value={share(actor.vitals?.thirst)}
                />
              </>
            ) : null}
          </div>
          {!compact ? (
            <div className="grid grid-cols-3 gap-3">
              <Reading label={t("player.bodyTemperature")}>
                {t("units.celsius", {
                  value: number(actor.vitals?.bodyTemperature?.current, 1),
                })}
              </Reading>
              <Reading label={t("player.heartRate")}>
                {t("units.bpm", { value: number(actor.vitals?.heartRate) })}
              </Reading>
              <Reading label={t("player.externalTemperature")}>
                {t("units.celsius", {
                  value: number(actor.environment?.externalTemperature),
                })}
              </Reading>
              <Reading label={t("player.radiation")}>
                {number(actor.environment?.ambientRadiationRate, 2)}
              </Reading>
              <Reading label={t("player.atmosphere")}>
                {actor.environment
                  ? actor.environment.breathableAtmosphere
                    ? t("player.breathable")
                    : t("player.notBreathable")
                  : "—"}
              </Reading>
              {actor.state?.seatName ? (
                <Reading label={t("player.seat")}>
                  {actor.state.seatName}
                </Reading>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {vehicle ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Reading label={t("vehicle.title")}>
              {vehicle.name || vehicle.className || "—"}
            </Reading>
            <div className="flex flex-wrap gap-1.5">
              {masterMode ? (
                <Badge>{t(`masterMode.${masterMode}`)}</Badge>
              ) : null}
              {flightState?.isLanded ? (
                <Badge>{t("vehicle.landed")}</Badge>
              ) : null}
              {coupled === false ? (
                <Badge tone="warning">{t("vehicle.decoupled")}</Badge>
              ) : null}
            </div>
          </div>
          {!compact && vehicle.manufacturer ? (
            <p className="-mt-2 text-xs text-nexus-muted">
              {vehicle.manufacturer}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Meter
              label={t("vehicle.hydrogen")}
              value={levelShare(instruments?.hydrogenFuel)}
            />
            <Meter
              label={t("vehicle.quantum")}
              value={levelShare(instruments?.quantumFuel)}
            />
            {!compact ? (
              <>
                <Meter
                  label={t("vehicle.hull")}
                  value={levelShare(vehicle.health)}
                />
                <Meter
                  label={t("vehicle.shields")}
                  value={
                    vehicle.shields ? levelShare(vehicle.shields.level) : null
                  }
                />
              </>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Reading label={t("vehicle.speed")}>
              {t("units.ms", { value: number(instruments?.speed) })}
            </Reading>
            <Reading label={t("vehicle.altitude")}>
              {t("units.m", { value: number(instruments?.altitude) })}
            </Reading>
            {!compact ? (
              <>
                <Reading label={t("vehicle.radarAltitude")}>
                  {t("units.m", { value: number(instruments?.radarAltitude) })}
                </Reading>
                <Reading label={t("vehicle.verticalSpeed")}>
                  {t("units.ms", {
                    value: number(instruments?.verticalSpeedIndicator, 1),
                  })}
                </Reading>
                <Reading label={t("vehicle.heading")}>
                  {t("units.degrees", { value: number(instruments?.heading) })}
                </Reading>
                <Reading label={t("vehicle.gear")}>
                  {gear ? t(`deployment.${gear}`) : "—"}
                </Reading>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The last game events: deaths, respawns, seats. */
export function TelemetryEvents({ telemetry }: { telemetry: Telemetry }) {
  const t = useTranslations("Telemetry");
  const format = useFormatter();
  const events = telemetry.snapshot.events
    .map((event) => ({ ...event, name: enumName(GAME_EVENT, event.kind) }))
    .filter((event) => event.name !== null)
    .reverse();

  return (
    <Card className="p-4">
      <h2 className="mb-3 font-display text-sm font-semibold tracking-[0.12em] text-nexus-muted uppercase">
        {t("events.title")}
      </h2>
      {events.length === 0 ? (
        <p className="text-[13px] text-nexus-muted">{t("events.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((event) => (
            <li
              key={`${event.receivedAt}-${event.kind}`}
              className="flex items-baseline justify-between gap-3 text-[13px]"
            >
              <span className="text-nexus-bright">
                {t(`events.kinds.${event.name!}`)}
              </span>
              <span className="text-xs text-nexus-dim">
                {format.dateTime(new Date(event.receivedAt), {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
