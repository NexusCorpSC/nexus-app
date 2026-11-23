import { useEffect, useRef, useState } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTranslations } from "use-intl";
import { useTelemetry } from "@/hooks/use-telemetry";
import { notify } from "@/lib/notifications";
import {
  getActiveTheme,
  getAppearance,
  setActiveTheme,
} from "@/lib/settings";
import { CREW_ROLE, fresh, LOCOMOTION } from "@/lib/telemetry";
import {
  APPEARANCE_EVENT,
  applyTheme,
  DEFAULT_APPEARANCE,
  MANUFACTURER_NAMES,
  THEME_EVENT,
  themeForVehicle,
  type ActiveTheme,
  type Appearance,
  type ThemeId,
} from "@/lib/themes";

/** How long a seat must hold before the theme follows it: no flicker when
    walking through a cockpit or swapping seats. */
const SETTLE_MS = 1_500;

/** Without "keep the last ship", how long the theme stays after leaving. */
const LINGER_MS = 10_000;

/** Pressed on the notification: back to the usual theme for this ship. */
const DISMISS_EVENT = "theme://dismiss";

type Seat = { theme: ThemeId; className: string; name: string };

/**
 * Follows the appearance settings and, at the controls of a ship, the
 * manufacturer the game's telemetry reports. Runs in the main window only,
 * which then tells the overlays (`useFollowTheme`).
 */
export function useShipTheme(): void {
  const t = useTranslations("SettingsAppearance");
  const telemetry = useTelemetry();
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [loaded, setLoaded] = useState(false);

  // The seat the player holds now (null: none), and since when.
  const seatRef = useRef<{ seat: Seat | null; since: number }>({ seat: null, since: 0 });
  // The last ship whose theme was put in force, and when it was left.
  const lastShipRef = useRef<{ seat: Seat; leftAt: number | null } | null>(null);
  // A ship the player asked to fly in the usual theme, until they leave it.
  const dismissedRef = useRef<string | null>(null);
  const appliedRef = useRef<ActiveTheme | null>(null);
  const [dismissTick, setDismissTick] = useState(0);

  useEffect(() => {
    let gone = false;
    const stops: UnlistenFn[] = [];
    const keep = (stop: UnlistenFn) => (gone ? stop() : stops.push(stop));

    void getAppearance()
      .then((stored) => {
        if (gone) return;
        setAppearanceState(stored);
        setLoaded(true);
      })
      .catch((error) => {
        console.error("cannot read the appearance", error);
        if (!gone) setLoaded(true);
      });
    void listen<Appearance>(APPEARANCE_EVENT, (event) => {
      setAppearanceState(event.payload);
    })
      .then(keep)
      .catch((error) => console.error("cannot follow the appearance", error));
    void listen(DISMISS_EVENT, () => {
      const seat = seatRef.current.seat;
      if (seat) dismissedRef.current = seat.className;
      setDismissTick((tick) => tick + 1);
    })
      .then(keep)
      .catch((error) => console.error("cannot follow the theme", error));

    return () => {
      gone = true;
      for (const stop of stops) stop();
    };
  }, []);

  const { snapshot, now } = telemetry;
  const vehicle = fresh(snapshot.vehicle, now);
  const actor = fresh(snapshot.actor, now)?.state ?? null;
  const seated = actor !== null && LOCOMOTION[actor.locomotion as keyof typeof LOCOMOTION] === "seated";
  const role = actor ? CREW_ROLE[actor.crewRole as keyof typeof CREW_ROLE] : undefined;
  const atControls = seated && (role === "pilot" || appearance.anySeat);
  const shipTheme = vehicle && atControls ? themeForVehicle(vehicle) : null;
  const seat: Seat | null =
    vehicle && shipTheme
      ? { theme: shipTheme, className: vehicle.className, name: vehicle.name }
      : null;
  const seatKey = seat ? `${seat.theme}/${seat.className}` : "";

  useEffect(() => {
    if (!loaded) return;

    const held = seatRef.current;
    const heldKey = held.seat ? `${held.seat.theme}/${held.seat.className}` : "";
    if (heldKey !== seatKey) {
      seatRef.current = { seat, since: now };
      if (!seat) {
        dismissedRef.current = null;
        if (lastShipRef.current && lastShipRef.current.leftAt === null) {
          lastShipRef.current.leftAt = now;
        }
      }
    }

    let theme: ThemeId = appearance.theme;
    let fromSeat: Seat | null = null;
    if (appearance.mode === "ship") {
      const current = seatRef.current.seat;
      const settled = now - seatRef.current.since >= SETTLE_MS;
      if (current && !settled) {
        // A seat just taken: stay on what is shown until it holds.
        theme = appliedRef.current?.theme ?? theme;
      } else if (current && dismissedRef.current !== current.className) {
        lastShipRef.current = { seat: current, leftAt: null };
        theme = current.theme;
        fromSeat = current;
      } else if (!current && lastShipRef.current) {
        const { seat: last, leftAt } = lastShipRef.current;
        const lingering = leftAt !== null && now - leftAt < LINGER_MS;
        if (appearance.keepLastShip || lingering) theme = last.theme;
      }
    }

    const next: ActiveTheme = { theme, effects: appearance.effects };
    const applied = appliedRef.current;
    if (applied && applied.theme === next.theme && applied.effects === next.effects) return;
    const first = applied === null;
    appliedRef.current = next;
    applyTheme(next);
    void setActiveTheme(next).catch((error) => console.error("cannot store the theme", error));
    void emit(THEME_EVENT, next).catch((error) => console.error("cannot broadcast the theme", error));

    const announce = first || !appearance.announce ? null : fromSeat;
    if (announce) {
      void notify({
        kind: "info",
        title: t("switched.title", { maker: MANUFACTURER_NAMES[announce.theme as Exclude<ThemeId, "nexus">] }),
        body: announce.name ? t("switched.body", { ship: announce.name }) : undefined,
        route: "/settings?section=appearance",
        action: { label: t("switched.undo"), event: DISMISS_EVENT },
      }).catch(() => {});
    }
  }, [loaded, appearance, seatKey, now, dismissTick, seat, t]);
}

/**
 * Applies the theme the main window broadcasts. Every other window runs this:
 * the overlays are created hidden at startup, so the stored copy covers what
 * they would have missed before they listened.
 */
export function useFollowTheme(): void {
  useEffect(() => {
    let gone = false;
    let unlisten: UnlistenFn | null = null;
    void getActiveTheme()
      .then((active) => {
        if (!gone) applyTheme(active);
      })
      .catch((error) => console.error("cannot read the theme", error));
    void listen<ActiveTheme>(THEME_EVENT, (event) => applyTheme(event.payload))
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => console.error("cannot follow the theme", error));
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);
}
