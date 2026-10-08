import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "use-intl";
import { useAuth } from "@/auth/auth-context";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import { getMyOrders } from "@/lib/api/orders";
import {
  OPEN_STATUSES,
  openOrder,
  ORDERS_KEY,
  STATUS_TONES,
  type StatusTone,
} from "@/lib/orders";
import { openOnSite } from "@/lib/org-events";
import { cn, formatAgo, formatNumber } from "@/lib/utils";
import type { AppOrder, OrderStatus } from "@/types/nexus";

const TONE_CLASSES: Record<StatusTone, string> = {
  warn: "bg-amber-400/12 text-amber-300",
  info: "bg-sky-400/12 text-sky-300",
  ok: "bg-emerald-400/12 text-emerald-300",
  bad: "bg-red-400/12 text-red-300",
  dim: "bg-nexus-accent/8 text-nexus-muted",
};

/** «received:<shop id>» for a shop's orders, «placed» for the reader's own. */
type Tab = `received:${string}` | "placed";

/**
 * The reader's marketplace orders: those their shops received, shop by shop,
 * and those they placed. The marketplace itself stays on the site, where
 * «Open» leads.
 */
export default function OrdersPage() {
  const t = useTranslations("Orders");
  const { user } = useAuth();
  const orders = useQuery({
    queryKey: [...ORDERS_KEY, user?.id],
    queryFn: () => getMyOrders(),
    enabled: Boolean(user),
  });
  const [chosen, setChosen] = useState<Tab | null>(null);

  const data = orders.data;
  const shops = data?.shops ?? [];
  // A seller lands on what their first shop received; a buyer on their own.
  const tab: Tab =
    chosen ?? (shops.length > 0 ? `received:${shops[0].id}` : "placed");
  const side = tab === "placed" ? "placed" : "received";
  const list =
    side === "placed"
      ? (data?.placed ?? [])
      : (data?.received ?? []).filter(
          (order) => `received:${order.shopId}` === tab,
        );
  const open = list.filter((order) => OPEN_STATUSES.includes(order.status));
  const closed = list.filter((order) => !OPEN_STATUSES.includes(order.status));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void openOnSite("/shopping")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("marketplace")}
          </Button>
        }
      />

      {orders.isPending ? (
        <LoadingState />
      ) : orders.isError ? (
        <ErrorState
          error={orders.error}
          onRetry={() => void orders.refetch()}
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {shops.map((shop) => (
              <Chip
                key={shop.id}
                active={tab === `received:${shop.id}`}
                onClick={() => setChosen(`received:${shop.id}`)}
              >
                {t("receivedTab", { shop: shop.name })}
              </Chip>
            ))}
            <Chip active={tab === "placed"} onClick={() => setChosen("placed")}>
              {t("placedTab")}
            </Chip>
          </div>

          {list.length === 0 ? (
            <EmptyState
              title={
                side === "placed" ? t("empty.placed") : t("empty.received")
              }
              description={t("empty.description")}
            />
          ) : (
            <>
              <section className="mb-7">
                <SectionTitle aside={String(open.length)}>
                  {t("open")}
                </SectionTitle>
                {open.length === 0 ? (
                  <p className="text-[13px] text-nexus-muted">
                    {t("nothingOpen")}
                  </p>
                ) : (
                  <OrderList orders={open} side={side} />
                )}
              </section>
              {closed.length > 0 ? (
                <section>
                  <SectionTitle>{t("closed")}</SectionTitle>
                  <OrderList orders={closed} side={side} />
                </section>
              ) : null}
            </>
          )}
        </>
      )}
    </>
  );
}

function OrderList({
  orders,
  side,
}: {
  orders: AppOrder[];
  side: "placed" | "received";
}) {
  const t = useTranslations("Orders");
  return (
    <ul className="flex flex-col gap-2">
      {orders.map((order) => (
        <li
          key={order.id}
          className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 rounded-lg border border-nexus-accent/15 px-3 py-2.5 text-[13px]"
        >
          <div className="min-w-0">
            <div className="truncate font-semibold text-nexus-bright">
              {side === "placed" ? order.shopName : order.buyerName}
            </div>
            <div className="truncate text-xs text-nexus-muted">
              {[order.summary, order.pickup, formatAgo(order.updatedAt)]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <span className="font-mono text-xs text-nexus-bright tabular-nums">
            {order.total !== undefined ? formatNumber(order.total) : "–"}
          </span>
          <StatusTag status={order.status} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void openOrder(order.path)}
          >
            {t("openOrder")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function StatusTag({ status }: { status: OrderStatus }) {
  const t = useTranslations("Orders.status");
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap",
        TONE_CLASSES[STATUS_TONES[status]],
      )}
    >
      {t(status)}
    </span>
  );
}
