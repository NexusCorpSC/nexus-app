import { invoke } from "@tauri-apps/api/core";

/**
 * The game's telemetry, held from Rust (`src-tauri/src/telemetry.rs`): the
 * state of the player and of their vehicle, streamed by Star Citizen on
 * 127.0.0.1 once `GameTelemetryEnabled` is set in its `attributes.xml`, and the
 * actions the game lets a client trigger.
 *
 * Nothing of it leaves this computer, except what the player asks Nexus Chat
 * (`src/lib/chat-game-tools.ts`).
 */

/** The latest state, a few times a second. Carries a {@link Snapshot}. */
export const TELEMETRY_FRAME_EVENT = "telemetry://frame";
/** One game event, as it comes. Carries a {@link GameEvent}. */
export const TELEMETRY_GAME_EVENT = "telemetry://event";
/** The connection changed. Carries a {@link Connection}. */
export const TELEMETRY_STATUS_EVENT = "telemetry://status";

/** A part of the state older than this is no longer the game's. */
export const STALE_AFTER_MS = 3_000;

export type Connection = "disabled" | "waiting" | "connected";

export type Gauge = { current: number; max: number };
export type Availability = { enabled: boolean; active: boolean };

/** Mirrors `ActorFrame` in `src-tauri/proto/sc/game/telemetry/v1/types.proto`. */
export type ActorFrame = {
  vitals: {
    health: Gauge | null;
    oxygen: Gauge | null;
    hunger: Gauge | null;
    thirst: Gauge | null;
    bodyTemperature: Gauge | null;
    heartRate: number;
    gravity: number;
    pressure: number;
    intoxicationLevel: number;
  } | null;
  state: {
    locomotion: number;
    crewRole: number;
    seatName: string;
    uecBalance: number;
  } | null;
  environment: {
    externalTemperature: number;
    ambientRadiationRate: number;
    breathableAtmosphere: boolean;
  } | null;
};

export type VehicleState = {
  name: string;
  className: string;
  manufacturer: string;
  type: number;
  lightsEnabled: boolean;
  doors: { openState: number; lockState: number } | null;
  flight: {
    state: {
      isLanded: boolean;
      gear: number | null;
      vtol: number | null;
      transformation: number | null;
    } | null;
    settings: {
      ifcsCoupled: Availability | null;
      ifcsCruiseMode: Availability | null;
      ifcsSpeedLimiter: Availability | null;
      ifcsGSafe: Availability | null;
      ifcsProximityAssist: Availability | null;
    } | null;
    instruments: {
      speed: number;
      hydrogenFuel: number;
      quantumFuel: number;
      gMeter: Gauge | null;
      boost: {
        engaged: boolean;
        output: number;
        reserves: number;
        critical: boolean;
      } | null;
      altitude: number;
      radarAltitude: number;
      verticalSpeedIndicator: number;
      atmosphericDensity: number;
      heading: number;
    } | null;
  } | null;
  power: Record<string, boolean> | null;
  shields: { level: number; faces: number[] } | null;
  health: number;
  masterMode: { mode: number; spooled: boolean } | null;
};

export type WeaponsFrame = {
  presetIndex: number;
  presetName: string;
  weapons: {
    name: string;
    isPowered: boolean;
    readyToFire: boolean;
    containedInPreset: boolean;
  }[];
  countermeasures: { type: number; amount: number }[];
};

export type Stamped<T> = { receivedAt: number; data: T };

export type GameEvent = { kind: number; receivedAt: number };

/** Mirrors `Snapshot` in `src-tauri/src/telemetry.rs`. */
export type Snapshot = {
  actor: Stamped<ActorFrame> | null;
  vehicle: Stamped<VehicleState> | null;
  weapons: Stamped<WeaponsFrame> | null;
  events: GameEvent[];
};

export type TelemetryStatus = {
  connection: Connection;
  port: number;
  snapshot: Snapshot;
};

export const EMPTY_SNAPSHOT: Snapshot = {
  actor: null,
  vehicle: null,
  weapons: null,
  events: [],
};

/* ------------------------------------------------------------------ */
/* Enums, by their number in the schema                                */
/* ------------------------------------------------------------------ */

export const LOCOMOTION = {
  1: "onFoot",
  2: "eva",
  3: "seated",
} as const satisfies Record<number, string>;

export const CREW_ROLE = {
  1: "pilot",
  2: "gunner",
  3: "crew",
} as const satisfies Record<number, string>;

export const VEHICLE_TYPE = {
  1: "spaceship",
  2: "ground",
  3: "gravlev",
  4: "boat",
} as const satisfies Record<number, string>;

export const DEPLOYMENT = {
  1: "retracted",
  2: "deploying",
  3: "deployed",
  4: "retracting",
} as const satisfies Record<number, string>;

export const MASTER_MODE = {
  1: "navigation",
  2: "scm",
  3: "stealth",
} as const satisfies Record<number, string>;

export const GAME_EVENT = {
  1: "spawn",
  2: "dead",
  3: "enterSeat",
  4: "leaveSeat",
  5: "respawn",
  6: "downed",
} as const satisfies Record<number, string>;

/** `TriggerGameActionStatus`. */
export const TRIGGER_STATUS = {
  1: "ok",
  2: "unknownAction",
  3: "mapInactive",
  4: "rateLimited",
  5: "failed",
  6: "holdNotAllowed",
  7: "filtered",
} as const satisfies Record<number, string>;

export type Locomotion = (typeof LOCOMOTION)[keyof typeof LOCOMOTION];
export type CrewRole = (typeof CREW_ROLE)[keyof typeof CREW_ROLE];
export type VehicleType = (typeof VEHICLE_TYPE)[keyof typeof VEHICLE_TYPE];
export type Deployment = (typeof DEPLOYMENT)[keyof typeof DEPLOYMENT];
export type MasterMode = (typeof MASTER_MODE)[keyof typeof MASTER_MODE];
export type GameEventKind = (typeof GAME_EVENT)[keyof typeof GAME_EVENT];
export type TriggerStatus =
  (typeof TRIGGER_STATUS)[keyof typeof TRIGGER_STATUS];

/** The name of `value` in `table`, or `null` for 0 (unspecified) and unknowns. */
export function enumName<T extends Record<number, string>>(
  table: T,
  value: number | null | undefined,
): T[keyof T] | null {
  if (value === null || value === undefined) return null;
  return (table as Record<number, T[keyof T]>)[value] ?? null;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** `part`'s data if it came less than {@link STALE_AFTER_MS} ago. */
export function fresh<T>(
  part: Stamped<T> | null | undefined,
  now: number = Date.now(),
): T | null {
  if (!part) return null;
  return now - part.receivedAt <= STALE_AFTER_MS ? part.data : null;
}

/** A gauge as a share of its maximum, 0 to 1, or `null` without one. */
export function share(gauge: Gauge | null | undefined): number | null {
  if (!gauge || !(gauge.max > 0)) return null;
  return Math.min(1, Math.max(0, gauge.current / gauge.max));
}

/**
 * A level (fuel, hull, shields) as a share, 0 to 1. The game sends a fraction; a value
 * above 1 is taken as a percentage, in case a patch changes the unit.
 */
export function levelShare(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const fraction = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, fraction));
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** Mirrors `Action` in `src-tauri/src/telemetry.rs`. */
export type GameAction = {
  name: string;
  category: string;
  holdable: boolean;
  /** Needs the player's confirmation. */
  dangerous: boolean;
};

export type TriggerResult = { status: number; message: string };

/**
 * Actions that cannot be taken back, or that leave the ship or its crew
 * exposed (power, shields, weapons, NAV mode, quantum drive, landing gear,
 * every door…), and any
 * name that looks like the worst of them. Mirrors `is_dangerous` in
 * `src-tauri/src/telemetry.rs`, which refuses them without `confirmed`.
 */
const DANGEROUS_ACTIONS = new Set([
  "v_eject",
  "v_emergency_exit",
  "v_self_destruct",
  "v_power_set_off",
  "v_power_toggle",
  "v_power_set_thrusters_off",
  "v_power_toggle_thrusters",
  "v_power_set_shields_off",
  "v_power_toggle_shields",
  "v_toggle_qdrive_engagement",
  "v_retract_landing_system",
  "v_toggle_landing_system",
  "v_open_all_doors",
  "v_unlock_all_doors",
  "v_unlock_all_ports",
  "v_toggle_all_doors",
  "v_toggle_all_doorlocks",
  "v_toggle_all_portlocks",
  "v_ifcs_gsafe_off",
  "v_ifcs_toggle_gforce_safety",
  "v_ifcs_proximity_assist_off",
  "v_master_mode_set_nav",
  "v_master_mode_cycle",
  "v_power_set_weapons_off",
  "v_power_toggle_weapons",
]);

const DANGEROUS_WORDS = [
  "eject",
  "self_destruct",
  "selfdestruct",
  "emergency",
  "suicide",
  "jettison",
];

export function isDangerousAction(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    DANGEROUS_ACTIONS.has(lower) ||
    DANGEROUS_WORDS.some((word) => lower.includes(word))
  );
}

/** The longest hold the app asks for. Mirrors `MAX_HOLD_MS` in Rust. */
export const MAX_HOLD_MS = 10_000;

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/** Makes Rust follow the stored settings: start or stop the stream. */
export function syncTelemetry(): Promise<void> {
  return invoke("telemetry_sync");
}

export function getTelemetryStatus(): Promise<TelemetryStatus> {
  return invoke("telemetry_status");
}

export function listGameActions(): Promise<GameAction[]> {
  return invoke("telemetry_actions");
}

/**
 * Triggers `action` in the game. `confirmed` only once the player said yes to
 * a dangerous one: Rust refuses it otherwise.
 */
export function triggerGameAction(
  action: string,
  options: { holdMs?: number; confirmed?: boolean } = {},
): Promise<TriggerResult> {
  return invoke("telemetry_trigger", {
    action,
    holdMs: options.holdMs ?? null,
    confirmed: options.confirmed ?? false,
  });
}

/** Mirrors `Activation` in `src-tauri/src/telemetry.rs`. */
export type Activation = {
  gameRunning: boolean;
  builds: { name: string; attributesPath: string; enabled: boolean }[];
};

export function getTelemetryActivation(): Promise<Activation> {
  return invoke("telemetry_activation");
}

/** Sets `GameTelemetryEnabled` for `build` (`LIVE`, `PTU`…), game closed. */
export function enableTelemetryInGame(build: string): Promise<Activation> {
  return invoke("telemetry_enable_in_game", { build });
}

/** The error codes Rust returns, as their key in `Telemetry.errors`. */
export const TELEMETRY_ERRORS = [
  "notConnected",
  "confirmationRequired",
  "gameRunning",
  "buildNotFound",
  "unexpectedFile",
] as const;

export type TelemetryError = (typeof TELEMETRY_ERRORS)[number];

export function telemetryErrorCode(cause: unknown): TelemetryError | null {
  const message = typeof cause === "string" ? cause : null;
  return TELEMETRY_ERRORS.find((code) => code === message) ?? null;
}

/* ------------------------------------------------------------------ */
/* For Nexus Chat                                                      */
/* ------------------------------------------------------------------ */

function rounded(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(value: number | null) {
  return value === null ? null : Math.round(value * 100);
}

/**
 * The state as Nexus Chat reads it: names rather than numbers, shares in
 * percent, and only what is current. Units are the game's (metres, m/s,
 * degrees Celsius).
 */
export function describeForChat(
  status: TelemetryStatus,
  now: number = Date.now(),
) {
  if (status.connection !== "connected") {
    return { connected: false, reason: status.connection };
  }
  const actor = fresh(status.snapshot.actor, now);
  const vehicle = fresh(status.snapshot.vehicle, now);
  const weapons = fresh(status.snapshot.weapons, now);
  const instruments = vehicle?.flight?.instruments ?? null;
  const flightState = vehicle?.flight?.state ?? null;
  const settings = vehicle?.flight?.settings ?? null;

  return {
    connected: true,
    inGame: actor !== null,
    player: actor
      ? {
          balanceAuec: actor.state?.uecBalance ?? null,
          locomotion: enumName(LOCOMOTION, actor.state?.locomotion),
          crewRole: enumName(CREW_ROLE, actor.state?.crewRole),
          seat: actor.state?.seatName || null,
          healthPercent: percent(share(actor.vitals?.health)),
          oxygenPercent: percent(share(actor.vitals?.oxygen)),
          hungerPercent: percent(share(actor.vitals?.hunger)),
          thirstPercent: percent(share(actor.vitals?.thirst)),
          bodyTemperature: rounded(actor.vitals?.bodyTemperature?.current),
          heartRate: rounded(actor.vitals?.heartRate, 0),
          intoxicationLevel: actor.vitals?.intoxicationLevel ?? null,
          externalTemperature: rounded(actor.environment?.externalTemperature),
          radiationRate: rounded(actor.environment?.ambientRadiationRate, 3),
          breathableAtmosphere: actor.environment?.breathableAtmosphere ?? null,
        }
      : null,
    vehicle: vehicle
      ? {
          name: vehicle.name || null,
          className: vehicle.className || null,
          manufacturer: vehicle.manufacturer || null,
          type: enumName(VEHICLE_TYPE, vehicle.type),
          healthPercent: percent(levelShare(vehicle.health)),
          shieldPercent: percent(levelShare(vehicle.shields?.level)),
          masterMode: enumName(MASTER_MODE, vehicle.masterMode?.mode),
          landed: flightState?.isLanded ?? null,
          landingGear: enumName(DEPLOYMENT, flightState?.gear),
          lights: vehicle.lightsEnabled,
          coupled: settings?.ifcsCoupled?.active ?? null,
          speedMs: rounded(instruments?.speed, 0),
          altitudeM: rounded(instruments?.altitude, 0),
          radarAltitudeM: rounded(instruments?.radarAltitude, 0),
          verticalSpeedMs: rounded(instruments?.verticalSpeedIndicator),
          headingDeg: rounded(instruments?.heading, 0),
          hydrogenFuelPercent: percent(levelShare(instruments?.hydrogenFuel)),
          quantumFuelPercent: percent(levelShare(instruments?.quantumFuel)),
          boostReservesPercent: percent(
            levelShare(instruments?.boost?.reserves),
          ),
          power: vehicle.power,
        }
      : null,
    weapons: weapons
      ? {
          preset: weapons.presetName || null,
          weapons: weapons.weapons.map((weapon) => ({
            name: weapon.name,
            powered: weapon.isPowered,
            ready: weapon.readyToFire,
          })),
          countermeasures: weapons.countermeasures.map((countermeasure) => ({
            type:
              countermeasure.type === 1
                ? "decoy"
                : countermeasure.type === 2
                  ? "noise"
                  : null,
            amount: countermeasure.amount,
          })),
        }
      : null,
    recentEvents: status.snapshot.events.slice(-5).map((event) => ({
      event: enumName(GAME_EVENT, event.kind),
      secondsAgo: Math.round((now - event.receivedAt) / 1000),
    })),
  };
}
