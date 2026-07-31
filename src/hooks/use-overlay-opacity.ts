import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DEFAULT_OVERLAY_OPACITY,
  OVERLAY_OPACITY_EVENT,
  readOverlayOpacity,
  type OverlayLabel,
  type OverlayOpacity,
} from "@/lib/overlay-opacity";

/**
 * Whether this overlay is drawing its panel.
 *
 * Asked to Rust on mount rather than read from the store: Rust holds what is in
 * force, and these windows are created hidden at startup, so their React trees
 * run long before anyone opens them — the event alone would leave them showing
 * the default until the first flip.
 *
 * The event carries all three, since the shortcut changes all three; this picks
 * out the one field that concerns the window it runs in.
 */
export function useOverlayOpaque(label: OverlayLabel): boolean {
  const [opaque, setOpaque] = useState(DEFAULT_OVERLAY_OPACITY[label]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let gone = false;

    void readOverlayOpacity(label)
      .then((initial) => {
        if (!gone) setOpaque(initial);
      })
      .catch((error) => {
        console.error("cannot read the overlay opacity", error);
      });

    void listen<OverlayOpacity>(OVERLAY_OPACITY_EVENT, (event) => {
      setOpaque(event.payload[label]);
    })
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("cannot follow the overlay opacity", error);
      });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, [label]);

  return opaque;
}
