import { Contrast } from "lucide-react";
import { toggleOverlayOpacity, type OverlayLabel } from "@/lib/overlay-opacity";
import { cn } from "@/lib/utils";

/**
 * Drops this overlay's panel, or puts it back.
 *
 * One window at a time, which is what a button sitting in its header should do.
 * Clearing the whole cockpit at once is the global shortcut's job — it takes
 * the three overlays to the same mode without reaching for any of them.
 *
 * `className` because the three headers do not share a palette: the squad
 * overlay is light blue where the other two are slate.
 */
export function OverlayOpacityButton({
  label,
  opaque,
  className,
}: {
  label: OverlayLabel;
  opaque: boolean;
  className?: string;
}) {
  const action = opaque ? "Rendre transparent" : "Rendre opaque";

  return (
    <button
      type="button"
      onClick={() => {
        void toggleOverlayOpacity(label).catch((error) =>
          console.error("cannot flip the overlay opacity", error),
        );
      }}
      title={action}
      aria-pressed={!opaque}
      className={cn(
        "shrink-0 rounded p-1 transition",
        "text-slate-400 hover:bg-white/10 hover:text-slate-100",
        className,
      )}
    >
      <span className="sr-only">{action}</span>
      <Contrast className="size-4" />
    </button>
  );
}
