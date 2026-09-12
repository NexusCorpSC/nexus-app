import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DEFAULT_OVERLAY_OPACITY,
  OVERLAY_OPACITY_EVENT,
  readOverlayMode,
  type OverlayLabel,
  type OverlayMode,
  type OverlayOpacity,
} from "@/lib/overlay-opacity";

/**
 * Which mode this overlay is drawing in.
 *
 * Asked to Rust on mount rather than read from the store: Rust holds what is in
 * force, and these windows are created hidden at startup, so their React trees
 * run long before anyone opens them — the event alone would leave them showing
 * the default until the first change.
 *
 * The event carries all three, since the shortcut changes all three; this picks
 * out the one field that concerns the window it runs in.
 */
export function useOverlayMode(label: OverlayLabel): OverlayMode {
  const [mode, setMode] = useState<OverlayMode>(DEFAULT_OVERLAY_OPACITY[label]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let gone = false;

    void readOverlayMode(label)
      .then((initial) => {
        if (!gone) setMode(initial);
      })
      .catch((error) => {
        console.error("cannot read the overlay opacity", error);
      });

    void listen<OverlayOpacity>(OVERLAY_OPACITY_EVENT, (event) => {
      setMode(event.payload[label]);
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

  return mode;
}
