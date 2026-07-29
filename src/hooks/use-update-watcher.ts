import { useEffect, useRef } from "react";
import { notify } from "@/lib/notifications";
import { checkForUpdate } from "@/lib/updates";

/** Between two checks. The app is left running for days at a time. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Watches for a newer release and says so, once per version.
 *
 * The notification carries a route rather than doing the work: installing means
 * downloading, showing progress and handing over to an installer, which belongs
 * in a window with room for it. The toast is only what makes it visible while
 * the app is behind the game.
 *
 * Failures stay silent — no endpoint, no network, no release yet — because
 * there is nothing here the user asked for. Settings has the button that
 * reports them.
 */
export function useUpdateWatcher() {
  const announced = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const look = async () => {
      try {
        const update = await checkForUpdate();
        if (!update || cancelled || announced.current === update.version) return;

        announced.current = update.version;

        await notify({
          title: `Mise à jour ${update.version} disponible`,
          body: "Cliquez pour l'installer.",
          route: "/settings",
        });
      } catch (error) {
        console.error("cannot check for updates", error);
      }
    };

    void look();
    const timer = setInterval(() => void look(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
}
