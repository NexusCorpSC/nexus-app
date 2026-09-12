import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FeedStatus, FeedStatusEvent } from "@/types/nexus";

/** Broadcast by Rust whenever the stream's status changes. */
const FEED_STATUS_EVENT = "feed://status";

/**
 * Where the event stream stands, for a window that wants to say so.
 *
 * The stream is Rust's: one for the whole app, opened as soon as a session
 * exists. Asked once on mount — the stream may have been up long before this
 * window was — then followed.
 */
export function useFeedStatus(): FeedStatus {
  const [status, setStatus] = useState<FeedStatus>("idle");

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let gone = false;

    void invoke<FeedStatus>("feed_status")
      .then((initial) => {
        if (!gone) setStatus(initial);
      })
      .catch((error) => {
        console.error("cannot read the event stream status", error);
      });

    void listen<FeedStatusEvent>(FEED_STATUS_EVENT, (event) => {
      setStatus(event.payload.status);
    })
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("cannot follow the event stream status", error);
      });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  return status;
}
