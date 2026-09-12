import { Circle, CircleDashed, CircleDot } from "lucide-react";
import {
  cycleOverlayOpacity,
  nextOverlayMode,
  OVERLAY_MODE_LABELS,
  type OverlayLabel,
  type OverlayMode,
} from "@/lib/overlay-opacity";
import { cn } from "@/lib/utils";

/**
 * Steps this overlay through its three modes: transparent, shaded, opaque.
 *
 * One window at a time, which is what a button sitting in its header should do.
 * Clearing the whole cockpit at once is the global shortcut's job — it takes
 * the three overlays to the same mode without reaching for any of them.
 *
 * The glyph is the mode it is *in*, not the one it goes to: a dashed ring for
 * nothing behind the text, a ring for the shade, a filled one for the panel.
 * The tooltip says where the next press lands.
 *
 * `className` because the three headers do not share a palette: the squad
 * overlay is light blue where the other two are slate.
 */
export function OverlayOpacityButton({
  label,
  mode,
  className,
}: {
  label: OverlayLabel;
  mode: OverlayMode;
  className?: string;
}) {
  const next = nextOverlayMode(mode);
  const action = `Fond ${OVERLAY_MODE_LABELS[mode]} — passer en ${OVERLAY_MODE_LABELS[next]}`;

  const Glyph =
    mode === "opaque" ? CircleDot : mode === "shaded" ? Circle : CircleDashed;

  return (
    <button
      type="button"
      onClick={() => {
        void cycleOverlayOpacity(label).catch((error) =>
          console.error("cannot change the overlay opacity", error),
        );
      }}
      title={action}
      className={cn(
        "shrink-0 rounded p-1 transition",
        "text-slate-400 hover:bg-white/10 hover:text-slate-100",
        className,
      )}
    >
      <span className="sr-only">{action}</span>
      <Glyph className="size-4" />
    </button>
  );
}
