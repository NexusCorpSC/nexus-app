import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  EMPTY_SNAPSHOT,
  getTelemetryStatus,
  TELEMETRY_FRAME_EVENT,
  TELEMETRY_STATUS_EVENT,
  type Connection,
  type Snapshot,
  type TelemetryStatus,
} from "@/lib/telemetry";

/** How often the parts of the state are aged out while nothing comes. */
const TICK_MS = 1_000;

/**
 * The game's telemetry as Rust last received it (`src-tauri/src/telemetry.rs`),
 * followed for as long as the component is mounted. `now` moves every second
 * so that a part the game stopped sending goes stale on screen (`fresh`).
 */
export function useTelemetry(): TelemetryStatus & { now: number } {
  const [connection, setConnection] = useState<Connection>("disabled");
  const [port, setPort] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let gone = false;
    const stops: UnlistenFn[] = [];
    const keep = (stop: UnlistenFn) => {
      if (gone) stop();
      else stops.push(stop);
    };

    void listen<Snapshot>(TELEMETRY_FRAME_EVENT, (event) => {
      setSnapshot(event.payload);
      setConnection("connected");
    })
      .then(keep)
      .catch((error) => console.error("cannot follow the telemetry", error));
    void listen<Connection>(TELEMETRY_STATUS_EVENT, (event) => {
      setConnection(event.payload);
      void getTelemetryStatus()
        .then((status) => {
          if (!gone) setPort(status.port);
        })
        .catch(() => {});
    })
      .then(keep)
      .catch((error) => console.error("cannot follow the telemetry", error));

    void getTelemetryStatus()
      .then((status) => {
        if (gone) return;
        setConnection(status.connection);
        setPort(status.port);
        setSnapshot(status.snapshot);
      })
      .catch((error) => console.error("cannot read the telemetry", error));

    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      gone = true;
      window.clearInterval(tick);
      for (const stop of stops) stop();
    };
  }, []);

  return { connection, port, snapshot, now };
}
