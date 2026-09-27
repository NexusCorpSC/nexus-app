import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { PresenceForm } from "@/components/presence-form";
import { useMyPresence } from "@/hooks/use-presence";
import { cn } from "@/lib/utils";

/**
 * The signed-in reader at the foot of the menu: who, whether they are
 * playing, and — behind a click — the declaration and the way out.
 *
 * The status line is the button, since it is what one comes to change: «En
 * jeu · Minage» in green, or «Hors jeu». The popover opens upwards, over the
 * menu, and closes on a click outside or Escape.
 */
export function SessionMenu({
  name,
  onSignOut,
}: {
  name: string;
  onSignOut: () => void;
}) {
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
  const status = playing
    ? presence?.activity
      ? `En jeu · ${presence.activity}`
      : "En jeu"
    : "Hors jeu";

  return (
    <div ref={root} className="flex min-w-0 flex-1 items-center gap-2.5">
      <div className="relative shrink-0">
        <div className="flex size-7.5 items-center justify-center rounded-full bg-nexus-panel text-xs font-semibold text-nexus-accent">
          {name.slice(0, 1).toUpperCase()}
        </div>
        {playing ? (
          <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-nexus-night bg-emerald-300" />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-[13px] font-medium text-nexus-white"
          title={name}
        >
          {name}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
          title="Déclarer ce que vous faites en jeu"
          className={cn(
            "truncate text-left text-[11px] transition-colors hover:text-nexus-accent",
            playing ? "text-emerald-300" : "text-nexus-dim",
          )}
        >
          {status}
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label="Ma session de jeu"
          className="absolute right-2 bottom-full left-2 z-20 mb-2 flex flex-col gap-3 rounded-xl border border-nexus-accent/18 bg-nexus-card p-3.5 shadow-xl shadow-black/40"
        >
          <div>
            <p className="font-display text-sm font-semibold text-nexus-white">
              Ma session de jeu
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-nexus-muted">
              Vos organisations voient que vous jouez, et à quoi.
            </p>
          </div>

          <PresenceForm compact onDone={() => setOpen(false)} />

          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1.5 border-t border-nexus-accent/10 pt-2.5 text-left text-xs text-nexus-dim transition-colors hover:text-nexus-accent"
          >
            <LogOut className="size-3.5" />
            Se déconnecter
          </button>
        </div>
      ) : null}
    </div>
  );
}
