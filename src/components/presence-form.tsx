import { useEffect, useId, useState } from "react";
import { CalendarClock, Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useMyPresence, useMyUpcomingEvents } from "@/hooks/use-presence";
import {
  formatPlannedTime,
  nextOccurrence,
  plannedOf,
  toTimeField,
} from "@/lib/presence";
import { cn } from "@/lib/utils";
import {
  PLANNED_SESSION_GRACE_HOURS,
  PRESENCE_ACTIVITY_MAX_LENGTH,
  PRESENCE_ACTIVITY_SUGGESTIONS,
  type MyPresence,
} from "@/types/nexus";

type Mode = "playing" | "planned" | "off";

const MODES: { value: Mode; label: string }[] = [
  { value: "playing", label: "En jeu" },
  { value: "planned", label: "Session prévue" },
  { value: "off", label: "Hors jeu" },
];

function modeOf(presence: MyPresence | null): Mode {
  if (presence?.playing) return "playing";
  return plannedOf(presence) ? "planned" : "off";
}

const FIELD =
  "h-9 w-full rounded-lg border border-nexus-accent/15 bg-nexus-abyss px-3 text-[13px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none";

/**
 * The reader's session: in game, a session planned, or off.
 *
 * The same declaration the site writes: set here, it shows on the
 * organization pages and to friends, on both. A planned session holds a time
 * and an activity, or picks up an event the reader registered to; starting to
 * play consumes it, taking over its activity.
 */
export function PresenceForm({
  className,
  compact = false,
  onDone,
}: {
  className?: string;
  /** Stacked, for the menu's popover; in rows otherwise. */
  compact?: boolean;
  onDone?: () => void;
}) {
  const { presence, declare, stop, plan, cancelPlanned, goOff } =
    useMyPresence(true);

  // The mode follows the stored state when it changes — declared from the
  // site, say, or by the click that just landed — and is the reader's own
  // choice in between.
  const stored = modeOf(presence);
  const [mode, setMode] = useState<Mode>(stored);
  useEffect(() => {
    setMode(stored);
  }, [stored]);

  const pending =
    declare.isPending ||
    stop.isPending ||
    plan.isPending ||
    cancelPlanned.isPending ||
    goOff.isPending;
  const error =
    declare.error ??
    stop.error ??
    plan.error ??
    cancelPlanned.error ??
    goOff.error;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        role="radiogroup"
        aria-label="État"
        className={cn(
          "grid grid-cols-3 gap-0.5 rounded-lg border border-nexus-accent/15 bg-nexus-abyss p-[3px]",
          !compact && "max-w-md",
        )}
      >
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => setMode(option.value)}
            className={cn(
              "h-7.5 truncate rounded-md px-1.5 text-[12px] font-medium transition-colors",
              mode === option.value
                ? "bg-nexus-accent/16 text-nexus-white"
                : "text-nexus-muted hover:text-nexus-bright",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === "playing" ? (
        <PlayingForm
          presence={presence}
          compact={compact}
          pending={pending}
          onDeclare={(activity) =>
            declare.mutate(activity, { onSuccess: onDone })
          }
          onStop={() => stop.mutate(undefined, { onSuccess: onDone })}
        />
      ) : mode === "planned" ? (
        <PlannedForm
          presence={presence}
          compact={compact}
          pending={pending}
          onPlan={(input) => plan.mutate(input, { onSuccess: onDone })}
          onCancel={() =>
            cancelPlanned.mutate(undefined, { onSuccess: onDone })
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-nexus-muted">
            {presence?.playing || plannedOf(presence)
              ? "Arrête la session en cours et annule la session prévue."
              : "Vous êtes hors jeu, sans session prévue."}
          </p>
          {presence && (presence.playing || plannedOf(presence)) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              className={cn(compact ? "w-full" : "self-start")}
              onClick={() => goOff.mutate(presence, { onSuccess: onDone })}
            >
              Passer hors jeu
            </Button>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="w-full text-xs text-red-300">
          {error instanceof Error ? error.message : "La mise à jour a échoué."}
        </p>
      ) : null}
    </div>
  );
}

function ActivitySuggestions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {PRESENCE_ACTIVITY_SUGGESTIONS.map((suggestion) => (
        <option key={suggestion} value={suggestion} />
      ))}
    </datalist>
  );
}

function PlayingForm({
  presence,
  compact,
  pending,
  onDeclare,
  onStop,
}: {
  presence: MyPresence | null;
  compact: boolean;
  pending: boolean;
  /** `undefined` takes over the planned session's activity. */
  onDeclare: (activity: string | null | undefined) => void;
  onStop: () => void;
}) {
  const [activity, setActivity] = useState("");
  const listId = useId();

  // The field follows the stored activity when it changes — declared from the
  // site, say. A refresh bringing back the same activity changes nothing: the
  // dependency is the string, compared by value.
  useEffect(() => {
    setActivity(presence?.activity ?? "");
  }, [presence?.activity]);

  const playing = presence?.playing ?? false;
  const planned = plannedOf(presence);

  return (
    <form
      className={cn(
        "flex gap-2",
        compact ? "flex-col" : "flex-wrap items-center",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        const typed = activity.trim();
        // Left empty, a new session takes over the planned activity: no
        // activity at all is sent, and the server picks it up.
        onDeclare(!playing && !typed && planned ? undefined : typed || null);
      }}
    >
      <label className={cn(compact ? "w-full" : "min-w-52 flex-1")}>
        <span className="sr-only">Activité</span>
        <input
          value={activity}
          onChange={(event) => setActivity(event.target.value)}
          maxLength={PRESENCE_ACTIVITY_MAX_LENGTH}
          placeholder={
            !playing && planned?.activity
              ? planned.activity
              : "Que faites-vous ? (facultatif)"
          }
          list={listId}
          className={FIELD}
        />
        <ActivitySuggestions id={listId} />
      </label>

      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          className={cn(compact && "flex-1 whitespace-nowrap px-2")}
        >
          {/* No room for the icon in the menu's narrow popover. */}
          {compact ? null : <Gamepad2 className="size-3.5" />}
          {playing ? "Mettre à jour" : "Je joue"}
        </Button>
        {playing ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            className={cn(compact && "flex-1 whitespace-nowrap px-2")}
            onClick={onStop}
          >
            J'arrête
          </Button>
        ) : null}
      </div>

      {playing && planned ? (
        <p className="w-full text-xs text-amber-200">
          Prochaine session prévue · {formatPlannedTime(planned.at)} ·{" "}
          {planned.activity ?? "sans activité précisée"}
        </p>
      ) : null}
    </form>
  );
}

function PlannedForm({
  presence,
  compact,
  pending,
  onPlan,
  onCancel,
}: {
  presence: MyPresence | null;
  compact: boolean;
  pending: boolean;
  onPlan: (input: {
    at?: string;
    activity?: string | null;
    event?: { orgId: string; eventId: string };
  }) => void;
  onCancel: () => void;
}) {
  const planned = plannedOf(presence);
  const [time, setTime] = useState("21:00");
  const [activity, setActivity] = useState("");
  const listId = useId();
  const events = useMyUpcomingEvents(true);

  // The fields follow the stored session when it changes, as above. The time
  // field reads in the reader's time zone: the server only keeps the instant.
  const plannedAt = planned?.at;
  useEffect(() => {
    if (plannedAt) setTime(toTimeField(plannedAt));
  }, [plannedAt]);
  useEffect(() => {
    setActivity(planned?.activity ?? "");
  }, [planned?.activity]);

  // An older site has no such list: the form simply offers none.
  const upcoming = events.data ?? [];

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        const at = nextOccurrence(time);
        if (at) onPlan({ at, activity: activity.trim() || null });
      }}
    >
      <div
        className={cn(
          "grid gap-2",
          compact
            ? "grid-cols-[88px_minmax(0,1fr)]"
            : "max-w-xl grid-cols-[110px_minmax(0,1fr)]",
        )}
      >
        <label>
          <span className="sr-only">À</span>
          <input
            type="time"
            required
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={cn(FIELD, "px-2 font-mono")}
          />
        </label>
        <label>
          <span className="sr-only">Pour faire</span>
          <input
            value={activity}
            onChange={(event) => setActivity(event.target.value)}
            maxLength={PRESENCE_ACTIVITY_MAX_LENGTH}
            placeholder="Que ferez-vous ?"
            list={listId}
            className={FIELD}
          />
          <ActivitySuggestions id={listId} />
        </label>
      </div>

      {upcoming.length > 0 ? (
        <div className={cn("flex flex-col gap-1.5", !compact && "max-w-xl")}>
          <span className="text-[11.5px] text-nexus-muted">
            Ou reprendre un évènement où vous êtes inscrit :
          </span>
          {upcoming.map((event) => {
            const picked = planned?.event?.eventId === event.eventId;
            return (
              <button
                key={event.eventId}
                type="button"
                disabled={pending}
                aria-pressed={picked}
                onClick={() =>
                  onPlan({
                    event: { orgId: event.orgId, eventId: event.eventId },
                  })
                }
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition-colors disabled:opacity-50",
                  picked
                    ? "border-nexus-accent bg-nexus-accent/12 text-nexus-white"
                    : "border-nexus-accent/18 text-nexus-soft hover:border-nexus-accent/45",
                )}
              >
                <CalendarClock className="size-3.5 shrink-0 text-nexus-accent" />
                <span className="min-w-0 flex-1 truncate">
                  {event.title}
                  {event.orgName ? (
                    <span className="text-nexus-dim"> · {event.orgName}</span>
                  ) : null}
                </span>
                <span className="shrink-0 rounded-md bg-amber-300/12 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
                  {formatPlannedTime(event.startsAt)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          className={cn(compact && "flex-1 whitespace-nowrap px-2")}
        >
          {compact ? null : <CalendarClock className="size-3.5" />}
          Enregistrer
        </Button>
        {planned ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            className={cn(compact && "flex-1 whitespace-nowrap px-2")}
            onClick={onCancel}
          >
            Annuler
          </Button>
        ) : null}
      </div>

      <p className="text-[11px] leading-snug text-nexus-dim">
        Elle s'efface {PLANNED_SESSION_GRACE_HOURS} h après l'heure prévue, ou
        dès que vous passez « En jeu » : son activité est reprise.
      </p>
    </form>
  );
}
