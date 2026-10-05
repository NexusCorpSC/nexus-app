import { useEffect } from "react";
import { translator } from "@/i18n/translate";
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
  const t = translator("Updates.contrib");
  switch (event.type) {
    case "published":
      return {
        kind: "success",
        title: t("published"),
        body:
          event.points > 0
            ? t("publishedBody", { name: event.name, points: event.points })
            : event.name,
        route: "/settings?section=account",
      };
    case "changesRequested":
      return {
        kind: "warning",
        title: t("changesRequested"),
        body: event.message
          ? t("changesRequestedBody", {
              name: event.name,
              message: event.message,
            })
          : event.name,
        route: "/settings?section=account",
      };
    case "achievement":
      return {
        kind: "success",
        title: t("achievement"),
        body: event.title,
        route: "/settings?section=account",
      };
    case "level":
      return {
        kind: "success",
        title: t("level"),
        body: event.title,
        route: "/settings?section=account",
      };
  }
}

/**
 * Tells the player what became of their contributions on the site: published,
 * sent back for changes, an achievement unlocked, a new level.
 *
 * The first read for an account on an instance only sets the mark: an account
 * with a history is not greeted by a pile of old news, nor by another
 * player's. After that, `since` is
 * the site's own clock, persisted, so a restart neither repeats nor drops an
 * event. Failures stay silent, like the update check: nothing was asked.
 */
export function useContribWatcher(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const look = async () => {
      try {
        const since = await getContribSince(userId);
        const summary = await getMyContrib(since ?? undefined);
        if (cancelled) return;
        await setContribSince(userId, summary.now);
        if (!since || !(await getContribNotifications())) return;

        const events = summary.events;
        const shown = events.slice(-MAX_TOASTS);
        if (events.length > shown.length) {
          const t = translator("Updates.contrib");
          await notify({
            title: t("backlogTitle"),
            body: t("backlog", { count: events.length - shown.length }),
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
  }, [userId]);
}
