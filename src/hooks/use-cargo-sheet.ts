import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CARGO_EVENT, readSheet, type CargoSheet } from "@/lib/cargo-sheet";

export interface CargoSheetState {
  /** `null` once read and there is none; `undefined` while reading. */
  sheet: CargoSheet | null | undefined;
  loading: boolean;
}

/**
 * The cargo sheet, kept in step across windows.
 *
 * Every mutation writes to the store and announces itself; each window — the
 * main one and the overlay, which are separate React trees — re-reads on the
 * announcement. That is also what makes a capture handled in the palette show
 * up in an overlay that is already open.
 */
export function useCargoSheet(): CargoSheetState & { refresh: () => void } {
  const [sheet, setSheet] = useState<CargoSheet | null | undefined>(undefined);

  const refresh = useCallback(() => {
    void readSheet()
      .then(setSheet)
      .catch((error) => {
        console.error("cannot read the cargo sheet", error);
        setSheet(null);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let gone = false;

    void listen(CARGO_EVENT, refresh)
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("cannot follow the cargo sheet", error);
      });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, [refresh]);

  return { sheet, loading: sheet === undefined, refresh };
}
