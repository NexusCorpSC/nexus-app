import { useEffect } from "react";
import { getMyContrib } from "@/lib/api/contrib";
import { notify, type NotificationInput } from "@/lib/notifications";
import {
  getContribNotifications,
  getContribSince,
  setContribSince,
} from "@/lib/settings";
import type { ContribEvent } from "@/types/nexus";

/** Between two reads: a review is a matter of hours, not seconds. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** No more toasts than this at once: a backlog is summed up instead. */
const MAX_TOASTS = 3;

function toNotification(event: ContribEvent): NotificationInput {
  switch (event.type) {
    case "published":
      return {
        kind: "success",
        title: "Contribution publiée",
        body:
          event.points > 0
            ? `${event.name} · +${event.points} points`
            : event.name,
        route: "/settings?section=account",
      };
    case "changesRequested":
      return {
        kind: "warning",
        title: "Contribution à corriger",
        body: event.message
          ? `${event.name} : « ${event.message} »`
          : event.name,
        route: "/settings?section=account",
      };
    case "achievement":
      return {
        kind: "success",
        title: "Succès débloqué",
        body: event.title,
        route: "/settings?section=account",
      };
    case "level":
      return {
        kind: "success",
        title: "Nouveau niveau",
        body: event.title,
        route: "/settings?section=account",
      };
  }
}

/**
 * Tells the player what became of their contributions on the site: published,
 * sent back for changes, an achievement unlocked, a new level.
 *
 * The first read after sign-in on this machine only sets the mark: an account
 * with a history is not greeted by a pile of old news. After that, `since` is
 * the site's own clock, persisted, so a restart neither repeats nor drops an
 * event. Failures stay silent, like the update check: nothing was asked.
 */
export function useContribWatcher(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;

    const look = async () => {
      try {
        const since = await getContribSince();
        const summary = await getMyContrib(since ?? undefined);
        if (cancelled) return;
        await setContribSince(summary.now);
        if (!since || !(await getContribNotifications())) return;

        const events = summary.events;
        const shown = events.slice(-MAX_TOASTS);
        if (events.length > shown.length) {
          await notify({
            title: "Contributions",
            body: `${events.length - shown.length} autres nouvelles sur vos contributions.`,
            route: "/settings?section=account",
          });
        }
        for (const event of shown) {
          await notify(toNotification(event));
        }
      } catch (error) {
        console.error("cannot read contribution events", error);
      }
    };

    void look();
    const timer = setInterval(() => void look(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [signedIn]);
}
