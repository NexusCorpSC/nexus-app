import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translator } from "@/i18n/translate";
import { getMyRequests } from "@/lib/api/requests";
import { notify, type NotificationInput } from "@/lib/notifications";
import { REQUESTS_KEY, routeOfSitePath } from "@/lib/requests";
import {
  getRequestNotifications,
  getRequestsSince,
  setRequestsSince,
} from "@/lib/settings";
import { formatNumber } from "@/lib/utils";
import type { RequestNotice } from "@/types/requests";

/** A request is answered in minutes: the site is read every minute. */
const CHECK_INTERVAL_MS = 60 * 1000;

/** No more toasts than this at once: a backlog is summed up instead. */
const MAX_TOASTS = 3;

function toNotification(notice: RequestNotice): NotificationInput {
  const t = translator("Requests.notify");
  const route = routeOfSitePath(notice.path);
  const name = notice.actorName;
  const summary = notice.summary;

  switch (notice.type) {
    case "request":
      return {
        kind: "info",
        route,
        title: notice.orgName
          ? t("requestOrg", { name, org: notice.orgName })
          : t("request", { name }),
        body: summary,
      };
    case "offer":
      return {
        kind: "info",
        route,
        title: t("offer", { name }),
        body: notice.excerpt ? `${summary} · ${notice.excerpt}` : summary,
      };
    case "message":
      return {
        kind: "info",
        route,
        title: t("message", { name }),
        body: notice.excerpt ?? summary,
      };
    case "price":
      return {
        kind: "info",
        route,
        title: t("price", {
          name,
          price: formatNumber(notice.unitPrice ?? 0),
        }),
        body: summary,
      };
    default: {
      const status = notice.status ?? "NEW";
      const bad = status === "DECLINED" || status === "WITHDRAWN";
      return {
        kind: bad ? "warning" : status === "RECEIVED" ? "success" : "info",
        route,
        title: t(`status.${status}`, { name }),
        body: summary,
      };
    }
  }
}

/**
 * Tells the reader what happens on the request board: a request from a friend
 * or one of their organizations, an offer on one of their requests, a message
 * or a price in an offer's thread, an offer kept, received or declined. The
 * toast opens the request in the app.
 *
 * Like the orders, the first read for an account on an instance only sets the
 * mark, and `since` is the site's own clock, persisted.
 */
export function useRequestsWatcher(userId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const look = async () => {
      try {
        const since = await getRequestsSince(userId);
        const summary = await getMyRequests(since ?? undefined);
        if (cancelled) return;
        await setRequestsSince(userId, summary.now);
        queryClient.setQueryData([...REQUESTS_KEY, userId], summary);
        if (!since || summary.events.length === 0) return;
        // Something moved: the open screens read it again.
        void queryClient.invalidateQueries({ queryKey: ["request"] });
        if (!(await getRequestNotifications())) return;

        const events = summary.events;
        const shown = events.slice(-MAX_TOASTS);
        if (events.length > shown.length) {
          const t = translator("Requests.notify");
          await notify({
            title: t("backlogTitle"),
            body: t("backlog", { count: events.length - shown.length }),
            route: "/requests",
          });
        }
        for (const notice of shown) {
          await notify(toNotification(notice));
        }
      } catch (error) {
        console.error("cannot read the request board", error);
      }
    };

    void look();
    const timer = setInterval(() => void look(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId, queryClient]);
}
