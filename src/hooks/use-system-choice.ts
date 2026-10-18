import { useCallback, useEffect, useState } from "react";
import {
  onSystemChoiceChange,
  readSystemChoice,
  setSystemChoice,
} from "@/lib/nps-system";

/**
 * The system the player picked by hand in the NPS, kept in step across
 * windows, and how to change it: `null` is automatic detection.
 */
export function useSystemChoice(): [
  string | null,
  (slug: string | null) => void,
] {
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    function refresh() {
      void readSystemChoice()
        .then((slug) => {
          if (alive) setChosen(slug);
        })
        .catch((error) =>
          console.error("cannot read the chosen NPS system", error),
        );
    }
    refresh();
    const pending = onSystemChoiceChange(refresh);
    return () => {
      alive = false;
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  const choose = useCallback(
    (slug: string | null) => {
      const previous = chosen;
      setChosen(slug);
      // Not saved, the choice would hold in this window only: back to what
      // was there.
      void setSystemChoice(slug).catch((error) => {
        console.error("cannot save the chosen NPS system", error);
        setChosen(previous);
      });
    },
    [chosen],
  );

  return [chosen, choose];
}
