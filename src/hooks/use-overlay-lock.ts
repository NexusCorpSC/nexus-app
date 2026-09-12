import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { OVERLAY_LOCK_EVENT, readOverlayLocked } from "@/lib/overlay-lock";

/**
 * Whether this overlay is locked — a picture the mouse goes through.
 *
 * Asked to Rust on mount, for the same reason as the opacity: the window is
 * created hidden at startup and Rust holds what is in force, so a lock set
 * before this tree mounted would otherwise go unshown.
 */
export function useOverlayLocked(label: string): boolean {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let gone = false;

    void readOverlayLocked(label)
      .then((initial) => {
        if (!gone) setLocked(initial);
      })
      .catch((error) => {
        console.error("cannot read the overlay lock", error);
      });

    void listen<boolean>(OVERLAY_LOCK_EVENT, (event) => {
      setLocked(event.payload);
    })
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("cannot follow the overlay lock", error);
      });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, [label]);

  return locked;
}
