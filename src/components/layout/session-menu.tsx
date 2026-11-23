import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { useTranslations } from "use-intl";
import { PresenceForm } from "@/components/presence-form";
import { useMyPresence } from "@/hooks/use-presence";
import { plannedLabel, plannedOf } from "@/lib/presence";
import { cn } from "@/lib/utils";

/**
 * The signed-in reader at the foot of the primary rail: their initial and a
 * status dot for whether they are playing, opening the presence declaration
 * and sign-out popover to the right of the rail.
 *
 * The popover is wide enough (`w-[344px]`) for the three presence modes to fit
 * without truncation, and closes on a click outside or Escape.
 */
export function SessionMenu({
  name,
  onSignOut,
}: {
  name: string;
  onSignOut: () => void;
}) {
  const t = useTranslations("Layout.session");
  const { presence } = useMyPresence(true);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const playing = presence?.playing ?? false;
  // Only shown when not playing: a session running says more.
  const planned = playing ? null : plannedOf(presence);
  const status = playing
    ? presence?.activity
      ? t("playingActivity", { activity: presence.activity })
      : t("playing")
    : planned
      ? plannedLabel(planned)
      : t("off");

  return (
    <div ref={root} className="relative flex justify-center">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${name} — ${status}`}
        onClick={() => setOpen((value) => !value)}
        title={`${name} · ${status}`}
        className={cn(
          "relative flex size-9 items-center justify-center rounded-full border bg-nexus-panel text-[13px] font-semibold text-nexus-accent transition-colors",
          open
            ? "border-nexus-accent/45 bg-nexus-panel text-nexus-white"
            : "border-nexus-accent/18 hover:border-nexus-accent/40 hover:text-nexus-white",
        )}
      >
        {name.slice(0, 1).toUpperCase()}
        {playing ? (
          <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-nexus-rail bg-emerald-300" />
        ) : planned ? (
          <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-amber-300 bg-nexus-rail" />
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("title")}
          className="absolute bottom-0 left-full z-30 ml-2.5 flex w-[344px] flex-col gap-3 rounded-2xl border border-nexus-accent/22 bg-nexus-card p-3.5 shadow-2xl shadow-black/50"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-nexus-white">
                {name}
              </p>
              <p
                className={cn(
                  "mt-0.5 truncate text-[11.5px]",
                  playing
                    ? "text-emerald-300"
                    : planned
                      ? "text-amber-200"
                      : "text-nexus-muted",
                )}
              >
                {status}
              </p>
            </div>
          </div>

          <p className="text-[11.5px] leading-snug text-nexus-muted">
            {t("hint")}
          </p>

          <PresenceForm compact onDone={() => setOpen(false)} />

          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1.5 border-t border-nexus-accent/10 pt-2.5 text-left text-xs text-nexus-dim transition-colors hover:text-nexus-accent"
          >
            <LogOut className="size-3.5" />
            {t("signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
