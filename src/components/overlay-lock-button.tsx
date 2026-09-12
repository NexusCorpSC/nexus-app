import { useEffect, useRef } from "react";
import { Lock, LockOpen } from "lucide-react";
import { lockOverlay, unlockOverlay } from "@/lib/overlay-lock";
import { cn } from "@/lib/utils";

/**
 * Locks this overlay, or unlocks it.
 *
 * Locked, the window lets every click through to the game — except on this
 * button, which is the only way back. Rust decides that by watching where the
 * cursor is against the rectangle this button reports about itself, so the
 * button keeps Rust told: on locking, and again whenever the window is resized
 * and the header reflows under it.
 *
 * Kept visibly pressed while locked, since it is then the one live thing in a
 * window that otherwise looks exactly as it did.
 */
export function OverlayLockButton({
  label,
  locked,
  className,
}: {
  label: string;
  locked: boolean;
  className?: string;
}) {
  const button = useRef<HTMLButtonElement>(null);

  // The zone follows the button. `ResizeObserver` on the body rather than on
  // the button: the button's size never changes, its *place* does, and it is
  // the window and the header around it that move it.
  useEffect(() => {
    if (!locked) return;

    function report() {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;

      void lockOverlay(label, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }).catch((error) => console.error("cannot lock the overlay", error));
    }

    report();

    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    window.addEventListener("resize", report);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [label, locked]);

  const action = locked
    ? "Déverrouiller : la fenêtre reprend les clics"
    : "Verrouiller : les clics passent au jeu, sauf sur ce bouton";

  return (
    <button
      ref={button}
      type="button"
      onClick={() => {
        // Locking is reported by the effect above once the state comes back
        // from Rust; unlocking has to be asked for directly, this being the
        // one click a locked window still gets.
        const change = locked
          ? unlockOverlay(label)
          : lockOverlay(label, zoneOf(button.current));

        void change.catch((error) =>
          console.error("cannot change the overlay lock", error),
        );
      }}
      title={action}
      aria-pressed={locked}
      className={cn(
        "shrink-0 rounded p-1 transition",
        // The header's own palette applies to the button at rest; locked, it
        // wears the same amber in every window, being the one thing left to
        // find.
        locked
          ? "bg-amber-300/20 text-amber-200 hover:bg-amber-300/30"
          : ["text-slate-400 hover:bg-white/10 hover:text-slate-100", className],
      )}
    >
      <span className="sr-only">{action}</span>
      {locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
    </button>
  );
}

function zoneOf(element: HTMLElement | null) {
  const rect = element?.getBoundingClientRect();

  return rect
    ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    : { x: 0, y: 0, width: 0, height: 0 };
}
