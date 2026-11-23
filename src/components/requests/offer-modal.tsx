import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button, Field, Input, LoadingState, Modal } from "@/components/ui";
import { createOffer, getRequestDetail } from "@/lib/api/requests";
import {
  REQUEST_BOARD_KEY,
  requestDetailKey,
  requestErrorCode,
  REQUESTS_KEY,
} from "@/lib/requests";
import { cn, formatNumber } from "@/lib/utils";
import {
  MAX_OFFER_MESSAGE,
  quantityLabel,
  type PlayerRequest,
  type RequestOffer,
  type SupplyLot,
} from "@/types/requests";

/**
 * «J'en ai»: an offer on someone else's request. A lot of the reader's
 * inventory under the same name fills the quantity, quality and place in;
 * without one, the offer is a promise to find it.
 */
export function OfferModal({
  request,
  open,
  onClose,
  onSent,
}: {
  request: PlayerRequest;
  open: boolean;
  onClose: () => void;
  onSent?: (offer: RequestOffer) => void;
}) {
  const t = useTranslations("Requests");
  const detail = useQuery({
    queryKey: requestDetailKey(request.id),
    queryFn: () => getRequestDetail(request.id),
    enabled: open,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<HandCoins className="size-5" />}
      title={t("offer.title", { name: request.userName, item: request.name })}
      description={t("offer.subtitle", {
        quantity: quantityLabel(request.remaining, request.unit),
      })}
    >
      {detail.isPending ? (
        <LoadingState />
      ) : (
        <OfferForm
          request={request}
          lots={detail.data?.lots ?? []}
          onClose={onClose}
          onSent={onSent}
        />
      )}
    </Modal>
  );
}

function defaultQuantity(request: PlayerRequest, lot?: SupplyLot): string {
  if (!lot) return request.remaining > 0 ? String(request.remaining) : "";
  const amount =
    request.remaining > 0
      ? Math.min(lot.inRequestUnit, request.remaining)
      : lot.inRequestUnit;
  return String(Math.round(amount * 100) / 100);
}

function OfferForm({
  request,
  lots,
  onClose,
  onSent,
}: {
  request: PlayerRequest;
  lots: SupplyLot[];
  onClose: () => void;
  onSent?: (offer: RequestOffer) => void;
}) {
  const t = useTranslations("Requests");
  const queryClient = useQueryClient();
  const usable = lots.filter((lot) => !lot.belowMinimum);
  const [lotId, setLotId] = useState<string | null>(usable[0]?.id ?? null);
  const lot = lots.find((entry) => entry.id === lotId);
  const [quantity, setQuantity] = useState(() =>
    defaultQuantity(request, usable[0]),
  );
  const [quality, setQuality] = useState(
    usable[0]?.quality !== undefined ? String(usable[0].quality) : "",
  );
  const [price, setPrice] = useState(
    request.unitPrice !== undefined ? String(request.unitPrice) : "",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const material = request.kind === "resource" || request.kind === "other";
  const unit = request.unit ?? t("unitShort");

  function pick(next: SupplyLot | null) {
    setLotId(next?.id ?? null);
    setQuantity(defaultQuantity(request, next ?? undefined));
    setQuality(next?.quality !== undefined ? String(next.quality) : "");
  }

  const send = useMutation({
    mutationFn: () =>
      createOffer(request.id, {
        quantity: Number(quantity.replace(",", ".")),
        quality: material && quality.trim() !== "" ? Number(quality) : null,
        unitPrice:
          price.trim() === "" ? null : Number(price.replace(/\s/g, "")),
        inventoryItemId: lot?.id ?? null,
        message: message.trim() || null,
      }),
    onSuccess: (offer) => {
      void queryClient.invalidateQueries({ queryKey: REQUEST_BOARD_KEY });
      void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
      void queryClient.invalidateQueries({
        queryKey: requestDetailKey(request.id),
      });
      onClose();
      onSent?.(offer);
    },
    onError: (cause) => {
      const code = requestErrorCode(cause);
      setError(code ? t(`errors.${code}`) : t("errors.generic"));
    },
  });

  const amount = Number(quantity.replace(",", "."));
  const valid = Number.isFinite(amount) && amount > 0;
  const each = price.trim() === "" ? NaN : Number(price.replace(/\s/g, ""));

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) {
          setError(t("errors.quantity"));
          return;
        }
        setError(null);
        send.mutate();
      }}
    >
      {lots.length > 0 ? (
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
            {t("offer.fromInventory")}
          </legend>
          {lots.map((entry) => (
            <label
              key={entry.id}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-nexus-sm border px-3 py-2 text-[13px]",
                lotId === entry.id
                  ? "border-[#FFB98A]/60 bg-[#FFB98A]/8"
                  : "border-nexus-accent/15",
                entry.belowMinimum && "opacity-60",
              )}
            >
              <input
                type="radio"
                name="lot"
                checked={lotId === entry.id}
                onChange={() => pick(entry)}
                className="accent-[#FFB98A]"
              />
              <span className="min-w-0 flex-1">
                <span className="font-mono text-nexus-bright">
                  {quantityLabel(entry.quantity, entry.unit)}
                  {entry.quality !== undefined ? ` · Q ${entry.quality}` : ""}
                </span>
                {entry.locationName ? (
                  <span className="text-nexus-muted">
                    {" "}
                    · {entry.locationName}
                  </span>
                ) : null}
              </span>
              {entry.belowMinimum ? (
                <span className="text-[11.5px] text-amber-300">
                  {t("offer.belowMinimum")}
                </span>
              ) : null}
            </label>
          ))}
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-nexus-sm border px-3 py-2 text-[13px]",
              lotId === null
                ? "border-[#FFB98A]/60 bg-[#FFB98A]/8"
                : "border-nexus-accent/15",
            )}
          >
            <input
              type="radio"
              name="lot"
              checked={lotId === null}
              onChange={() => pick(null)}
              className="accent-[#FFB98A]"
            />
            <span className="text-nexus-bright">{t("offer.noLot")}</span>
            <span className="text-nexus-muted">{t("offer.noLotHint")}</span>
          </label>
        </fieldset>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Field label={`${t("offer.quantity")} (${unit})`}>
          <Input
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
        </Field>
        {material ? (
          <Field label={t("offer.quality")}>
            <Input
              inputMode="numeric"
              value={quality}
              placeholder={t("form.minQualityPlaceholder")}
              onChange={(event) => setQuality(event.target.value)}
            />
          </Field>
        ) : (
          <div />
        )}
        <Field label={t("fields.pricePer", { unit })}>
          <Input
            inputMode="numeric"
            value={price}
            placeholder={t("negotiable")}
            onChange={(event) => setPrice(event.target.value)}
          />
        </Field>
      </div>

      <Field label={t("offer.message")}>
        <textarea
          value={message}
          maxLength={MAX_OFFER_MESSAGE}
          rows={3}
          placeholder={t("offer.messagePlaceholder")}
          onChange={(event) => setMessage(event.target.value)}
          className="w-full rounded-nexus-sm border border-nexus-accent/15 bg-nexus-card px-3 py-2 text-[13.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
        />
      </Field>

      {valid && Number.isFinite(each) ? (
        <p className="text-xs text-nexus-muted">
          {t("offer.total", { total: formatNumber(amount * each) })}
        </p>
      ) : null}

      {error ? <p className="text-[13px] text-red-300">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={send.isPending}>
          {send.isPending ? t("sending") : t("offer.send")}
        </Button>
      </div>
    </form>
  );
}
