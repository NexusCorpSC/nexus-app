import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Check,
  Clipboard,
  Clock,
  Download,
  MinusCircle,
  Package,
  Send,
  X,
} from "lucide-react";
import { useTranslations } from "use-intl";
import { getLocale } from "@/i18n/locale";
import { listInventoryItems, listLocations } from "@/lib/api/inventory";
import {
  acceptParcel,
  cancelParcel,
  cleanParcelCode,
  createParcel,
  formatParcelCode,
  listParcels,
  parcelErrorMessage,
  previewParcel,
} from "@/lib/api/parcels";
import { Button, Card, Field, Input, Modal, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  InventoryItem,
  Location,
  Parcel,
  ParcelItem,
} from "@/types/nexus";

/** A lot put in the package, and how much of it. */
export type PackageEntry = { item: InventoryItem; quantity: number };

function formatNumber(value: number) {
  return new Intl.NumberFormat(getLocale(), {
    maximumFractionDigits: 3,
  }).format(value);
}

function roundQty(value: number) {
  return Math.round(value * 1e10) / 1e10;
}

/**
 * What of a lot a new parcel may still take: not what one waiting holds.
 * Never below zero — the lot may have been used after a parcel was sealed.
 */
export function availableOf(item: InventoryItem) {
  return Math.max(0, roundQty(item.quantity - (item.reserved ?? 0)));
}

/** "23 h 58", "12 min": what is left of a code's life, kept current. */
function useRemaining(expiresAt: string) {
  const t = useTranslations("Parcels");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - now) / 60_000),
  );
  return minutes >= 60
    ? t("remainingHours", {
        hours: Math.floor(minutes / 60),
        minutes: String(minutes % 60).padStart(2, "0"),
      })
    : t("remainingMinutes", { minutes });
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return {
    copied,
    copy: (text: string) => {
      // Absent outside a secure context, and in some webviews.
      if (!navigator.clipboard?.writeText) return;
      void navigator.clipboard
        .writeText(text)
        .then(() => setCopied(text))
        .catch(() => {
          // The code stays on screen to be copied by hand.
        });
    },
  };
}

function ParcelItems({ items }: { items: ParcelItem[] }) {
  return (
    <ul className="divide-y divide-nexus-accent/10 rounded-lg border border-nexus-accent/15">
      {items.map((item, index) => (
        <li
          key={`${index}-${item.name}`}
          className="flex items-center gap-3 px-3 py-2 text-[13px]"
        >
          <span className="min-w-0 flex-1 truncate font-medium text-nexus-white">
            {item.name}
          </span>
          {item.quality != null ? (
            <span className="font-mono text-xs text-nexus-muted">
              Q {item.quality}
            </span>
          ) : null}
          <span className="w-28 text-right font-mono font-semibold text-nexus-bright tabular-nums">
            ×{formatNumber(item.quantity)}
            {item.unit ? (
              <span className="ml-1 text-xs text-nexus-muted">{item.unit}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ErrorLine({ children }: { children: string | null }) {
  return children ? (
    <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">
      {children}
    </p>
  ) : null;
}

/* ------------------------------------------------------------------ */
/* The package                                                         */
/* ------------------------------------------------------------------ */

/**
 * The lots gathered to send, beside the inventory: quantities to adjust,
 * then « Envoyer le colis », which seals them into a parcel and a code.
 */
export function PackagePanel({
  entries,
  onChange,
  onSent,
}: {
  entries: PackageEntry[];
  onChange: (entries: PackageEntry[]) => void;
  onSent: (parcel: Parcel) => void;
}) {
  const t = useTranslations("Parcels");
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: () =>
      createParcel(
        entries.map((entry) => ({
          itemId: entry.item.id,
          quantity: entry.quantity,
        })),
      ),
    onSuccess: async (parcel) => {
      onChange([]);
      onSent(parcel);
      await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      await queryClient.invalidateQueries({ queryKey: ["parcels"] });
    },
  });

  const places = [
    ...new Set(entries.map((entry) => entry.item.location?.name ?? "—")),
  ];

  return (
    <aside className="sticky top-4 w-72 shrink-0 space-y-3 self-start rounded-xl border border-nexus-accent/25 bg-nexus-card p-4 shadow-lg shadow-black/20">
      <div className="flex items-center gap-2">
        <Package className="size-4.5 text-nexus-accent" />
        <h2 className="font-display text-sm font-semibold text-nexus-white">
          {t("package.title")}
        </h2>
        <span className="rounded-full bg-nexus-accent/15 px-1.5 py-0.5 text-xs font-medium text-nexus-accent">
          {entries.length}
        </span>
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-auto text-xs text-nexus-muted hover:text-nexus-soft"
        >
          {t("package.clear")}
        </button>
      </div>
      <p className="text-xs text-nexus-muted">
        {t("package.from", { places: places.join(", ") })}
      </p>

      <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <li
            key={entry.item.id}
            className="flex items-center gap-2 border-b border-nexus-accent/10 py-1.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-nexus-white">
                {entry.item.name}
                {entry.item.quality != null ? (
                  <span className="ml-1.5 text-nexus-muted">
                    Q{entry.item.quality}
                  </span>
                ) : null}
              </p>
              <p className="text-[11px] text-nexus-dim">
                {t("package.outOf", {
                  available: formatNumber(availableOf(entry.item)),
                })}
              </p>
            </div>
            <input
              type="number"
              min={0.001}
              max={availableOf(entry.item)}
              step="any"
              value={entry.quantity}
              aria-label={t("package.quantityOf", { name: entry.item.name })}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value) || value <= 0) return;
                onChange(
                  entries.map((other) =>
                    other.item.id === entry.item.id
                      ? {
                          ...other,
                          quantity: Math.min(value, availableOf(other.item)),
                        }
                      : other,
                  ),
                );
              }}
              className="h-7 w-16 rounded-md border border-nexus-accent/20 bg-nexus-abyss px-2 text-right font-mono text-xs text-nexus-white focus:border-nexus-accent/50 focus:outline-none"
            />
            {entry.item.unit ? (
              <span className="text-[11px] text-nexus-muted">
                {entry.item.unit}
              </span>
            ) : null}
            <button
              type="button"
              aria-label={t("package.remove", { name: entry.item.name })}
              onClick={() =>
                onChange(
                  entries.filter((other) => other.item.id !== entry.item.id),
                )
              }
              className="text-nexus-muted hover:text-red-300"
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <ErrorLine>
        {send.error ? parcelErrorMessage(send.error) : null}
      </ErrorLine>

      <div className="space-y-2 border-t border-nexus-accent/15 pt-3">
        <Button
          className="w-full"
          disabled={send.isPending || entries.length === 0}
          onClick={() => send.mutate()}
        >
          <Send className="size-4" />
          {send.isPending ? t("package.sending") : t("package.send")}
        </Button>
        <p className="text-[11px] leading-relaxed text-nexus-muted">
          {t("package.sendHint")}
        </p>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* The code of a parcel just sent                                      */
/* ------------------------------------------------------------------ */

export function SentParcelModal({
  parcel,
  onClose,
}: {
  parcel: Parcel | null;
  onClose: () => void;
}) {
  const t = useTranslations("Parcels");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => cancelParcel(parcel!.code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      await queryClient.invalidateQueries({ queryKey: ["parcels"] });
      onClose();
    },
  });

  return (
    <Modal
      open={parcel !== null}
      onClose={onClose}
      icon={<Package className="size-5" />}
      title={t("sent.title")}
      description={t("sent.description")}
      footer={
        <>
          <Button
            variant="danger"
            size="sm"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t("sent.cancel")}
          </Button>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose();
              navigate("/inventory/parcels");
            }}
          >
            {t("sent.seeAll")}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("close")}
          </Button>
        </>
      }
    >
      {parcel ? <SentParcelBody parcel={parcel} /> : null}
      <div className="mt-3">
        <ErrorLine>
          {cancel.error ? parcelErrorMessage(cancel.error) : null}
        </ErrorLine>
      </div>
    </Modal>
  );
}

function SentParcelBody({ parcel }: { parcel: Parcel }) {
  const t = useTranslations("Parcels");
  const remaining = useRemaining(parcel.expiresAt);
  const { copied, copy } = useCopy();

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-nexus-accent/15 bg-nexus-abyss p-5">
        <p
          aria-label={t("sent.codeLabel", { code: parcel.code })}
          className="flex items-center gap-1.5"
        >
          {parcel.code.split("").map((char, index) => (
            <span key={index} className="flex items-center gap-1.5">
              {index === 4 ? (
                <span aria-hidden className="h-0.5 w-3 bg-nexus-accent/30" />
              ) : null}
              <span
                aria-hidden
                className="flex h-14 w-11 items-center justify-center rounded-lg bg-nexus-panel font-mono text-3xl font-bold text-nexus-white"
              >
                {char}
              </span>
            </span>
          ))}
        </p>
        <Button onClick={() => copy(parcel.code)}>
          {copied === parcel.code ? (
            <Check className="size-4" />
          ) : (
            <Clipboard className="size-4" />
          )}
          {copied === parcel.code ? t("sent.codeCopied") : t("sent.copyCode")}
        </Button>
        <p className="flex items-center gap-1.5 text-[13px] text-amber-300">
          <Clock className="size-4" />
          {t("sent.waiting", { remaining })}
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
          {t("sent.contents")}
        </p>
        <ParcelItems items={parcel.items} />
        <p className="text-xs text-nexus-muted">
          {t("sent.reservedHint")}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Receiving a parcel                                                  */
/* ------------------------------------------------------------------ */

/**
 * The recipient's side: a code, what it holds and who sent it, where to put
 * it. Nothing moves until « Accepter le colis ».
 */
export function ReceiveParcelModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Parcels");
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Download className="size-5" />}
      title={t("receive.title")}
      description={t("receive.description")}
    >
      <ReceiveParcelForm onClose={onClose} />
    </Modal>
  );
}

function ReceiveParcelForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Parcels");
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [locationId, setLocationId] = useState("");
  const [orgVisible, setOrgVisible] = useState(false);
  const complete = code.length === 8;

  const preview = useQuery({
    queryKey: ["parcel-preview", code],
    queryFn: () => previewParcel(code),
    enabled: complete,
    retry: false,
    staleTime: 0,
  });

  const itemsQuery = useQuery({
    queryKey: ["inventory-items", ""],
    queryFn: () => listInventoryItems(),
  });
  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: () => listLocations(),
    staleTime: 10 * 60_000,
  });

  // The places the reader already stores things at first, as in the bulk add.
  const locations = useMemo(() => {
    const byId = new Map<string, Location>();
    for (const item of itemsQuery.data ?? []) {
      if (item.location) byId.set(item.location.id, item.location);
    }
    for (const location of locationsQuery.data ?? []) {
      if (!byId.has(location.id)) byId.set(location.id, location);
    }
    return [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name, getLocale()),
    );
  }, [itemsQuery.data, locationsQuery.data]);

  const accept = useMutation({
    mutationFn: () => acceptParcel(code, { locationId, orgVisible }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      await queryClient.invalidateQueries({ queryKey: ["parcels"] });
    },
  });

  const parcel = complete && preview.isSuccess ? preview.data : null;

  if (accept.isSuccess) {
    const { parcel: received, created, merged } = accept.data;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
          <Check className="mt-0.5 size-5 shrink-0 text-emerald-300" />
          <div>
            <p className="text-sm font-semibold text-nexus-white">
              {received.deliveredLocationName
                ? t("receive.receivedAt", {
                    sender: received.senderName ?? t("receive.someone"),
                    location: received.deliveredLocationName,
                  })
                : t("receive.received", {
                    sender: received.senderName ?? t("receive.someone"),
                  })}
            </p>
            <p className="text-xs text-emerald-200/90">
              {t("receive.receivedDescription", { created, merged })}
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t("close")}</Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (parcel && locationId && !accept.isPending) accept.mutate();
      }}
    >
      <Field label={t("receive.codeField")}>
        <div className="relative">
          <Input
            value={formatParcelCode(code)}
            onChange={(event) => {
              accept.reset();
              setCode(cleanParcelCode(event.target.value));
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            className={cn(
              "h-14 pr-12 font-mono text-2xl font-bold tracking-[0.2em] uppercase",
              parcel && "border-emerald-400",
            )}
          />
          {parcel ? (
            <Check className="absolute top-1/2 right-4 size-6 -translate-y-1/2 text-emerald-300" />
          ) : null}
        </div>
      </Field>
      <p className="-mt-2 text-xs text-nexus-muted">
        {complete && preview.isFetching
          ? t("receive.looking")
          : t("receive.codeHint")}
      </p>

      {complete && preview.isError ? (
        <ErrorLine>{parcelErrorMessage(preview.error)}</ErrorLine>
      ) : null}

      {parcel ? (
        <>
          <div className="space-y-3 rounded-xl border border-nexus-accent/15 bg-nexus-abyss p-4">
            <p className="text-[13px] text-nexus-bright">
              {t("receive.from", {
                sender: parcel.senderName ?? t("receive.someoneStart"),
                count: parcel.items.length,
              })}
            </p>
            <ParcelItems items={parcel.items} />
          </div>

          <Field label={t("receive.storeAt")}>
            <Select
              value={locationId}
              required
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">{t("receive.storeAtPlaceholder")}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-nexus-bright">
            <input
              type="checkbox"
              checked={orgVisible}
              onChange={(event) => setOrgVisible(event.target.checked)}
              className="size-3.5 accent-nexus-accent"
            />
            {t("receive.orgVisible")}
          </label>

          <ErrorLine>
            {accept.error ? parcelErrorMessage(accept.error) : null}
          </ErrorLine>

          <div className="flex items-center gap-2 border-t border-nexus-accent/12 pt-3">
            <p className="flex-1 text-xs text-nexus-muted">
              {t("receive.mergeHint")}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("cancelShort")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!locationId || accept.isPending}
            >
              <Check className="size-4" />
              {accept.isPending ? t("receive.accepting") : t("receive.accept")}
            </Button>
          </div>
        </>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The list of parcels                                                 */
/* ------------------------------------------------------------------ */

const STATUS_STYLE: Record<Parcel["status"], string> = {
  pending: "bg-amber-400/10 text-amber-300",
  delivered: "bg-emerald-400/10 text-emerald-300",
  cancelled: "bg-nexus-panel text-nexus-bright",
  expired: "bg-nexus-panel text-nexus-bright",
};

function ParcelStatusBadge({ parcel }: { parcel: Parcel }) {
  const t = useTranslations("Parcels");
  const remaining = useRemaining(parcel.expiresAt);
  const when = parcel.deliveredAt
    ? new Intl.DateTimeFormat(getLocale(), {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(parcel.deliveredAt))
    : "";
  const [Icon, label] =
    parcel.status === "pending"
      ? [Clock, t("status.pending", { remaining })]
      : parcel.status === "delivered"
        ? [
            Check,
            when
              ? t("status.deliveredAt", { when })
              : t("status.delivered"),
          ]
        : parcel.status === "cancelled"
          ? [X, t("status.cancelled")]
          : [MinusCircle, t("status.expired")];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs",
        STATUS_STYLE[parcel.status],
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

/** The reader's parcels, sent and received, with what can still be done. */
export function ParcelList() {
  const t = useTranslations("Parcels");
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<"sent" | "received">("sent");
  const { copied, copy } = useCopy();

  const parcelsQuery = useQuery({
    queryKey: ["parcels"],
    queryFn: listParcels,
  });
  const cancel = useMutation({
    mutationFn: cancelParcel,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["parcels"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    },
  });

  const shown = (parcelsQuery.data ?? []).filter(
    (parcel) => parcel.direction === direction,
  );

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        className="inline-flex rounded-lg border border-nexus-accent/15 bg-nexus-card p-1"
      >
        {(["sent", "received"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={direction === tab}
            onClick={() => setDirection(tab)}
            className={cn(
              "h-8 rounded-md px-4 text-[13px] font-semibold",
              direction === tab
                ? "bg-nexus-panel text-nexus-white"
                : "text-nexus-muted hover:text-nexus-soft",
            )}
          >
            {t(`list.tabs.${tab}`)}
          </button>
        ))}
      </div>

      <ErrorLine>
        {parcelsQuery.error
          ? parcelErrorMessage(parcelsQuery.error)
          : cancel.error
            ? parcelErrorMessage(cancel.error)
            : null}
      </ErrorLine>

      {parcelsQuery.isPending ? (
        <div className="h-40 animate-pulse rounded-xl bg-nexus-card" />
      ) : shown.length === 0 ? (
        <Card className="py-12 text-center text-[13px] text-nexus-muted">
          {direction === "sent"
            ? t("list.emptySent")
            : t("list.emptyReceived")}
        </Card>
      ) : (
        <Card className="divide-y divide-nexus-accent/10 overflow-hidden">
          {shown.map((parcel) => (
            <div
              key={parcel.code}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3"
            >
              <span
                className={cn(
                  "w-28 font-mono text-[15px] font-bold tracking-wider",
                  parcel.status === "pending"
                    ? "text-nexus-white"
                    : "text-nexus-muted",
                )}
              >
                {formatParcelCode(parcel.code)}
              </span>
              <span className="min-w-48 flex-1 text-[13px] text-nexus-bright">
                {parcel.items
                  .map(
                    (item) => `${item.name} ×${formatNumber(item.quantity)}`,
                  )
                  .join(", ")}
                <span className="text-nexus-muted">
                  {" · "}
                  {direction === "sent"
                    ? [
                        ...new Set(
                          parcel.items.map((item) => item.locationName ?? "—"),
                        ),
                      ].join(", ")
                    : (parcel.deliveredLocationName ?? "—")}
                </span>
              </span>
              <ParcelStatusBadge parcel={parcel} />
              <span className="w-28 truncate text-[13px] text-nexus-muted">
                {direction === "sent"
                  ? (parcel.recipientName ?? "—")
                  : (parcel.senderName ?? "—")}
              </span>
              {direction === "sent" && parcel.status === "pending" ? (
                <span className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t("list.copyCodeOf", { code: parcel.code })}
                    onClick={() => copy(parcel.code)}
                  >
                    {copied === parcel.code ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Clipboard className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(parcel.code)}
                  >
                    {t("cancelShort")}
                  </Button>
                </span>
              ) : (
                <span className="w-[108px]" />
              )}
            </div>
          ))}
        </Card>
      )}

      <p className="text-xs text-nexus-muted">
        {t("list.hint")}
      </p>
    </div>
  );
}
