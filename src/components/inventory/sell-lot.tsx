import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ExternalLink, MapPin, Store, Tag } from "lucide-react";
import { useTranslations } from "use-intl";
import { getLocale } from "@/i18n/locale";
import { ApiError } from "@/lib/api-client";
import { listMyShops, sellLot } from "@/lib/api/listings";
import { getApiBaseUrl } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { ICON_BUTTON } from "@/components/inventory/inventory-items";
import type { InventoryItem, LotSale, SellerShop } from "@/types/nexus";

/**
 * Putting a lot up for sale from the inventory: a marketplace listing that
 * follows the lot (`POST /api/me/listings` in Nexus Tools). The website has
 * the same button and the same dialog; its pages open in the browser.
 */

/** What the lot can sell: whole units, without what waiting parcels hold. */
export function sellableOf(lot: InventoryItem): number {
  return Math.max(0, Math.floor(lot.quantity - (lot.reserved ?? 0)));
}

function visibleSales(lot: InventoryItem): LotSale[] {
  return (lot.sales ?? []).filter((sale) => sale.onSale);
}

async function openOnSite(path: string) {
  await openUrl(`${await getApiBaseUrl()}${path}`);
}

/** The « on sale » badge in a lot's row. */
export function LotSaleBadge({ lot }: { lot: InventoryItem }) {
  const t = useTranslations("SellLot");
  const count = visibleSales(lot).length;
  if (count === 0) return null;
  const label = t("badge", { count });
  return (
    <span
      className="flex items-center gap-1 text-xs text-emerald-300"
      title={label}
    >
      <Tag className="size-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The card footer button, the lot's listings and the dialog. */
export function SellLotButton({
  lot,
  onSold,
}: {
  lot: InventoryItem;
  onSold: () => void;
}) {
  const t = useTranslations("SellLot");
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [shops, setShops] = useState<SellerShop[] | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sales = lot.sales ?? [];
  const onSale = visibleSales(lot).length > 0;
  const sellable = sellableOf(lot);
  const soldIn = new Set(sales.map((sale) => sale.shopId));
  const freeShops = shops?.filter((shop) => !soldIn.has(shop.id)) ?? [];

  useEffect(() => {
    if (!panelOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [panelOpen]);

  async function loadShops(): Promise<SellerShop[]> {
    if (shops) return shops;
    setLoading(true);
    try {
      const { shops: list } = await listMyShops();
      setShops(list);
      return list;
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  }

  // The button decides alone: the lot's listings, an invitation to open a
  // shop, or straight to the dialog.
  async function handleClick() {
    if (panelOpen) {
      setPanelOpen(false);
      return;
    }
    if (sales.length > 0) {
      setPanelOpen(true);
      void loadShops();
      return;
    }
    const list = await loadShops();
    if (list.length === 0) setPanelOpen(true);
    else setDialogOpen(true);
  }

  const disabled = sales.length === 0 && sellable < 1;
  const title = disabled
    ? t("nothingToSell")
    : onSale
      ? t("onSaleTitle")
      : t("action");

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={title}
        title={title}
        aria-expanded={panelOpen}
        disabled={disabled || loading}
        onClick={() => void handleClick()}
        className={cn(
          ICON_BUTTON,
          "relative",
          onSale && "text-emerald-300 hover:text-emerald-200",
        )}
      >
        <Tag className="size-3.5" />
        {onSale ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-1.5 rounded-full bg-emerald-300 ring-2 ring-nexus-card"
          />
        ) : null}
      </button>

      {panelOpen ? (
        <div className="absolute right-0 bottom-full z-20 mb-1 w-72 space-y-3 rounded-lg border border-nexus-accent/25 bg-nexus-deep p-3 shadow-xl shadow-black/40">
          {sales.length > 0 ? (
            <SalesPanel
              sales={sales}
              canSellElsewhere={sellable >= 1 && freeShops.length > 0}
              allShopsUsed={shops !== null && freeShops.length === 0}
              onSellElsewhere={() => {
                setPanelOpen(false);
                setDialogOpen(true);
              }}
            />
          ) : (
            <NoShopPanel />
          )}
        </div>
      ) : null}

      {dialogOpen && shops ? (
        <SellLotDialog
          lot={lot}
          shops={shops}
          soldIn={soldIn}
          onClose={() => setDialogOpen(false)}
          onSold={onSold}
        />
      ) : null}
    </div>
  );
}

function SalesPanel({
  sales,
  canSellElsewhere,
  allShopsUsed,
  onSellElsewhere,
}: {
  sales: LotSale[];
  canSellElsewhere: boolean;
  allShopsUsed: boolean;
  onSellElsewhere: () => void;
}) {
  const t = useTranslations("SellLot");
  const number = useMemo(() => new Intl.NumberFormat(getLocale()), []);

  return (
    <>
      <p className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
        {t("panelTitle")}
      </p>
      <ul className="space-y-2">
        {sales.map((sale) => (
          <li
            key={sale.listingId}
            className="space-y-1 rounded-md border border-nexus-accent/15 p-2 text-[13px]"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-nexus-bright">
                {sale.shopName}
              </span>
              <span className="shrink-0 font-mono text-nexus-bright tabular-nums">
                {t("price", { price: number.format(sale.price) })}
              </span>
            </div>
            <p className="text-xs text-nexus-muted">
              {t("saleStock", { stock: sale.stock, reserved: sale.reserved })}
              {sale.lotLimit !== undefined
                ? ` · ${t("saleLimit", { limit: sale.lotLimit })}`
                : null}
              {!sale.onSale ? ` · ${t("saleHidden")}` : null}
            </p>
            <button
              type="button"
              title={t("openOnSite")}
              onClick={() =>
                void openOnSite(
                  `/shops/${sale.shopId}/bo/listings/${sale.listingId}`,
                )
              }
              className="inline-flex items-center gap-1 text-xs text-nexus-accent hover:underline"
            >
              {t("manage")}
            </button>
          </li>
        ))}
      </ul>
      {canSellElsewhere ? (
        <Button type="button" size="sm" variant="outline" onClick={onSellElsewhere}>
          <Tag className="size-3.5" />
          {t("sellElsewhere")}
        </Button>
      ) : null}
      {allShopsUsed ? (
        <p className="text-xs text-nexus-muted">{t("allShopsUsed")}</p>
      ) : null}
    </>
  );
}

function NoShopPanel() {
  const t = useTranslations("SellLot");
  return (
    <>
      <p className="text-[13px] font-medium text-nexus-bright">
        {t("noShopTitle")}
      </p>
      <p className="text-xs text-nexus-muted">{t("noShopText")}</p>
      <Button
        type="button"
        size="sm"
        title={t("openOnSite")}
        onClick={() => void openOnSite("/shops/new")}
      >
        <Store className="size-3.5" />
        {t("noShopOpen")}
        <ExternalLink className="size-3" aria-hidden />
      </Button>
    </>
  );
}

function SellLotDialog({
  lot,
  shops,
  soldIn,
  onClose,
  onSold,
}: {
  lot: InventoryItem;
  shops: SellerShop[];
  soldIn: Set<string>;
  onClose: () => void;
  onSold: () => void;
}) {
  const t = useTranslations("SellLot");
  const number = useMemo(() => new Intl.NumberFormat(getLocale()), []);
  const sellable = sellableOf(lot);
  const unit = lot.unit?.trim();
  // Stuck to the quantity in the messages: « 32 SCU », « 6 ».
  const unitLabel = unit ? ` ${unit}` : "";

  const firstFree = shops.find((shop) => !soldIn.has(shop.id));
  const [shopId, setShopId] = useState(firstFree?.id ?? "");
  const [name, setName] = useState(
    lot.quality != null ? `${lot.name} Q ${lot.quality}` : lot.name,
  );
  const [price, setPrice] = useState("");
  const [capped, setCapped] = useState(false);
  const [limit, setLimit] = useState(String(Math.min(sellable, 1)));
  const [publish, setPublish] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [listingId, setListingId] = useState<string | null>(null);

  const priceValue = Number(price);
  const limitValue = Number(limit);
  const quantity = capped
    ? Math.min(sellable, Number.isInteger(limitValue) ? limitValue : 0)
    : sellable;
  const shop = shops.find((s) => s.id === shopId);

  // The inventory reloads on close, like on the website.
  function close() {
    onClose();
    if (listingId) onSold();
  }

  function errorText(code: unknown): string {
    const key = `errors.${String(code)}`;
    return t.has(key as "errors.GENERIC")
      ? t(key as "errors.GENERIC")
      : t("errors.GENERIC");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t("errors.NAME_REQUIRED"));
    if (price.trim() === "" || !Number.isInteger(priceValue) || priceValue < 0) {
      return setError(t("errors.INVALID_PRICE"));
    }
    if (capped && (!Number.isInteger(limitValue) || limitValue < 1)) {
      return setError(t("errors.INVALID_LIMIT"));
    }
    setSubmitting(true);
    try {
      const result = await sellLot({
        lotId: lot.id,
        shopId,
        name: name.trim(),
        price: priceValue,
        limit: capped ? limitValue : null,
        publish,
      });
      setListingId(result.listingId);
    } catch (cause) {
      const code =
        cause instanceof ApiError &&
        cause.body &&
        typeof cause.body === "object" &&
        "error" in cause.body
          ? (cause.body as { error: unknown }).error
          : undefined;
      setError(errorText(code));
    } finally {
      setSubmitting(false);
    }
  }

  if (listingId) {
    return (
      <Modal
        open
        title={t("title")}
        icon={<Tag className="size-5" />}
        onClose={close}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              title={t("openOnSite")}
              onClick={() => void openOnSite(`/shopping/i/${listingId}`)}
            >
              {t("viewListing")}
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              title={t("openOnSite")}
              onClick={() =>
                void openOnSite(`/shops/${shopId}/bo/listings/${listingId}`)
              }
            >
              {t("manageListing")}
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
            <Button type="button" className="ml-auto" onClick={close}>
              {t("close")}
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-2 text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          <span>
            <span className="block font-medium">
              {publish
                ? t("doneTitle", { shop: shop?.name ?? "" })
                : t("doneHiddenTitle", { shop: shop?.name ?? "" })}
            </span>
            <span className="text-[13px] text-nexus-soft">
              {t("doneText", { quantity, price: number.format(priceValue) })}
            </span>
          </span>
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title={t("title")}
      icon={<Tag className="size-5" />}
      onClose={close}
      footer={
        <>
          {Number.isInteger(priceValue) && price.trim() !== "" ? (
            <p className="mr-auto text-[13px] text-nexus-soft">
              {t.rich("total", {
                quantity,
                price: number.format(priceValue),
                total: number.format(quantity * priceValue),
                b: (chunks) => (
                  <b className="font-mono text-nexus-bright">{chunks}</b>
                ),
              })}
            </p>
          ) : (
            <span className="mr-auto" />
          )}
          <Button type="button" variant="outline" onClick={close}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form="sell-lot-form"
            disabled={submitting || !shopId}
          >
            <Tag className="size-3.5" />
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </>
      }
    >
      <form id="sell-lot-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-nexus-accent/15 bg-nexus-abyss/60 px-3 py-2">
          <p className="text-[13.5px] font-semibold text-nexus-bright">
            {lot.name}
            {lot.quality != null ? (
              <span className="ml-2 font-mono text-xs text-nexus-accent">
                Q {lot.quality}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-nexus-muted">
            {t("source", { quantity: sellable, unit: unitLabel })}
          </p>
        </div>

        {shops.length === 1 ? (
          <div className="space-y-1.5">
            <p className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
              {t("shop")}
            </p>
            <p className="text-[13.5px] text-nexus-bright">{shops[0].name}</p>
          </div>
        ) : (
          <Field label={t("shop")}>
            <Select value={shopId} onChange={(e) => setShopId(e.target.value)}>
              {shops.map((s) => (
                <option key={s.id} value={s.id} disabled={soldIn.has(s.id)}>
                  {soldIn.has(s.id)
                    ? t("shopAlreadyUsed", { name: s.name })
                    : s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t("name")}>
          <Input
            value={name}
            maxLength={500}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <span className="block text-xs text-nexus-muted">
            {t("nameHelp")}
          </span>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("unitPrice")}>
            <span className="relative block">
              <Input
                type="number"
                min={0}
                step={1}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="pr-14 font-mono"
                required
                autoFocus
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-nexus-muted">
                aUEC
              </span>
            </span>
          </Field>
          <div className="space-y-1.5">
            <p className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
              {t("pickup")}
            </p>
            <p className="flex min-h-9 items-center gap-1.5 text-[13px] text-nexus-soft">
              <MapPin className="size-4 shrink-0 text-nexus-muted" />
              {lot.location
                ? t("pickupFromLot", { location: lot.location.name })
                : t("pickupUnknown")}
            </p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1.5 font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
            {t("quantity")}
          </legend>
          <label
            className={cn(
              "flex cursor-pointer gap-2.5 rounded-lg border p-2.5",
              !capped
                ? "border-nexus-accent/60 bg-nexus-accent/5"
                : "border-nexus-accent/15",
            )}
          >
            <input
              type="radio"
              name="sell-quantity"
              checked={!capped}
              onChange={() => setCapped(false)}
              className="mt-1 accent-nexus-accent"
            />
            <span>
              <span className="block text-[13.5px] font-medium text-nexus-bright">
                {t("quantityAll")}
              </span>
              <span className="text-xs text-nexus-muted">
                {t("quantityAllHelp", { quantity: sellable, unit: unitLabel })}
              </span>
            </span>
          </label>
          <label
            className={cn(
              "flex cursor-pointer gap-2.5 rounded-lg border p-2.5",
              capped
                ? "border-nexus-accent/60 bg-nexus-accent/5"
                : "border-nexus-accent/15",
            )}
          >
            <input
              type="radio"
              name="sell-quantity"
              checked={capped}
              onChange={() => setCapped(true)}
              className="mt-1 accent-nexus-accent"
            />
            <span className="space-y-1.5">
              <span className="block text-[13.5px] font-medium text-nexus-bright">
                {t("quantitySome")}
              </span>
              <span className="block text-xs text-nexus-muted">
                {t("quantitySomeHelp")}
              </span>
              <span className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={sellable}
                  step={1}
                  value={limit}
                  aria-label={t("quantityLimit")}
                  onChange={(e) => {
                    setCapped(true);
                    setLimit(e.target.value);
                  }}
                  className="h-8 w-24 py-1 font-mono"
                />
                <span className="text-xs text-nexus-muted">
                  {t("quantityOf", { quantity: sellable, unit: unitLabel })}
                </span>
              </span>
            </span>
          </label>
        </fieldset>

        <label className="flex items-center gap-2 text-[13px] text-nexus-bright">
          <input
            type="checkbox"
            checked={publish}
            onChange={(e) => setPublish(e.target.checked)}
            className="size-3.5 accent-nexus-accent"
          />
          {t("publish")}
        </label>

        {error ? <p className="text-[13px] text-red-300">{error}</p> : null}
      </form>
    </Modal>
  );
}
