import { useEffect, useId, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useMyPresence } from "@/hooks/use-presence";
import { cn } from "@/lib/utils";
import {
  PRESENCE_ACTIVITY_MAX_LENGTH,
  PRESENCE_ACTIVITY_SUGGESTIONS,
} from "@/types/nexus";

/**
 * Declares playing, with an optional activity, or stops.
 *
 * The same declaration the site writes: set here, it shows on the
 * organization pages of both.
 */
export function PresenceForm({
  className,
  compact = false,
  onDone,
}: {
  className?: string;
  /** Stacked, for the menu's popover; a single row otherwise. */
  compact?: boolean;
  onDone?: () => void;
}) {
  const { presence, declare, stop } = useMyPresence(true);
  const [activity, setActivity] = useState("");
  const listId = useId();

  // The field follows the stored activity until the reader starts typing.
  useEffect(() => {
    setActivity(presence?.activity ?? "");
  }, [presence?.activity]);

  const playing = presence?.playing ?? false;
  const pending = declare.isPending || stop.isPending;
  const error = declare.error ?? stop.error;

  return (
    <form
      className={cn(
        "flex gap-2",
        compact ? "flex-col" : "flex-wrap items-center",
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        declare.mutate(activity.trim() || null, { onSuccess: onDone });
      }}
    >
      <label className={cn(compact ? "w-full" : "min-w-52 flex-1")}>
        <span className="sr-only">Activité</span>
        <input
          value={activity}
          onChange={(event) => setActivity(event.target.value)}
          maxLength={PRESENCE_ACTIVITY_MAX_LENGTH}
          placeholder="Que faites-vous ? (facultatif)"
          list={listId}
          className="h-9 w-full rounded-lg border border-nexus-accent/15 bg-nexus-abyss px-3 text-[13px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
        />
        <datalist id={listId}>
          {PRESENCE_ACTIVITY_SUGGESTIONS.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
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
            onClick={() => stop.mutate(undefined, { onSuccess: onDone })}
          >
            J'arrête
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="w-full text-xs text-red-300">
          {error instanceof Error ? error.message : "La mise à jour a échoué."}
        </p>
      ) : null}
    </form>
  );
}
