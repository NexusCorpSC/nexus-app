import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { translator } from "@/i18n/translate";
import { getMyOrders } from "@/lib/api/orders";
import { notify, type NotificationInput } from "@/lib/notifications";
import {
  isOrderOpen,
  openOrder,
  ORDER_OPEN_EVENT,
  ORDERS_KEY,
} from "@/lib/orders";
import {
  getOrderNotifications,
  getOrdersSince,
  setOrdersSince,
} from "@/lib/settings";
import { formatUEC } from "@/lib/utils";
import type { AppOrderEvent } from "@/types/nexus";

/** An order is answered in minutes: the site is read every minute. */
const CHECK_INTERVAL_MS = 60 * 1000;

/** No more toasts than this at once: a backlog is summed up instead. */
const MAX_TOASTS = 3;

function toNotification(event: AppOrderEvent): NotificationInput {
  const t = translator("Orders.notify");
  const action = {
    label: t("open"),
    event: ORDER_OPEN_EVENT,
    payload: { path: event.path },
  };
  const base = { action, route: "/orders" };

  if (event.type === "new") {
    return {
      ...base,
      kind: "info",
      title: t("newTitle", { buyer: event.buyerName, summary: event.summary }),
      body: event.pickup
        ? t("newBody", { shop: event.shopName, pickup: event.pickup })
        : t("newBodyNoPickup", { shop: event.shopName }),
    };
  }
  if (event.type === "quote") {
    return {
      ...base,
      kind: "info",
      title: t("quoteTitle", { amount: formatUEC(event.quote) }),
      body: t("body", { name: event.shopName, summary: event.summary }),
    };
  }
  const bad = event.status === "REFUSED" || event.status === "CANCELLED";
  return {
    ...base,
    kind: bad ? "warning" : "success",
    title:
      event.side === "placed"
        ? t(`placed.${event.status}`, { shop: event.shopName })
        : t(`received.${event.status}`, { buyer: event.buyerName }),
    body: t("body", {
      name: event.side === "placed" ? event.shopName : event.buyerName,
      summary: event.summary,
    }),
  };
}

/**
 * Tells the reader when one of their shops receives an order, and when the
 * other party takes a step on an order: confirmed, ready, a quote, cancelled.
 * The toast's button opens the order on the site.
 *
 * Like the contribution events, the first read for an account on an instance
 * only sets the mark, and `since` is the site's own clock, persisted.
 */
export function useOrdersWatcher(userId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const look = async () => {
      try {
        const since = await getOrdersSince(userId);
        const summary = await getMyOrders(since ?? undefined);
        if (cancelled) return;
        await setOrdersSince(userId, summary.now);
        queryClient.setQueryData([...ORDERS_KEY, userId], summary);
        if (!since || !(await getOrderNotifications())) return;

        const events = summary.events;
        const shown = events.slice(-MAX_TOASTS);
        if (events.length > shown.length) {
          const t = translator("Orders.notify");
          await notify({
            title: t("backlogTitle"),
            body: t("backlog", { count: events.length - shown.length }),
            route: "/orders",
          });
        }
        for (const event of shown) {
          await notify(toNotification(event));
        }
      } catch (error) {
        console.error("cannot read marketplace orders", error);
      }
    };

    void look();
    const timer = setInterval(() => void look(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId, queryClient]);

  // The toast's button, pressed in the overlay, lands here.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let gone = false;
    void listen<unknown>(ORDER_OPEN_EVENT, ({ payload }) => {
      if (isOrderOpen(payload)) void openOrder(payload.path);
    }).then((stop) => {
      if (gone) stop();
      else unlisten = stop;
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);
}
