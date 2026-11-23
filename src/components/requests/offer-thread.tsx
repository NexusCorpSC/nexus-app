import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { useTranslations } from "use-intl";
import { LocationCombobox } from "@/components/inventory/location-combobox";
import { Button, Field, Input, Modal } from "@/components/ui";
import {
  actOnOffer,
  postOfferMessage,
  type OfferActionInput,
} from "@/lib/api/requests";
import {
  REQUEST_BOARD_KEY,
  requestDetailKey,
  requestErrorCode,
  REQUESTS_KEY,
} from "@/lib/requests";
import { cn, formatAgo, formatDate, formatNumber } from "@/lib/utils";
import type { Location } from "@/types/nexus";
import {
  MAX_OFFER_MESSAGE,
  offerActionsFor,
  quantityLabel,
  type OfferAction,
  type OfferEntry,
  type OfferRole,
  type PlayerRequest,
  type RequestOffer,
} from "@/types/requests";
import { OfferStatusTag } from "./request-ui";

/**
 * One offer and its private thread: messages, prices proposed by either
 * side, and the steps taken on it. The requester keeps, declines or marks it
 * received; the supplier can withdraw it.
 */
export function OfferThread({
  request,
  offer,
  highlighted,
}: {
  request: PlayerRequest;
  offer: RequestOffer;
  highlighted?: boolean;
}) {
  const t = useTranslations("Requests");
  const queryClient = useQueryClient();
  const role: OfferRole = request.mine ? "requester" : "supplier";
  const actions = offerActionsFor(offer.status, role);
  const unit = request.unit ?? t("unitShort");
  const [message, setMessage] = useState("");
  const [pricing, setPricing] = useState(false);
  const [price, setPrice] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Après « Reçu » : l'ajout à l'inventaire a échoué, à ranger à la main.
  const [inventoryFailed, setInventoryFailed] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: requestDetailKey(request.id),
    });
    void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
    void queryClient.invalidateQueries({ queryKey: REQUEST_BOARD_KEY });
  };
  const fail = (cause: unknown) => {
    const code = requestErrorCode(cause);
    setError(code ? t(`errors.${code}`) : t("errors.generic"));
  };

  const write = useMutation({
    mutationFn: () => postOfferMessage(offer.id, message.trim()),
    onSuccess: () => {
      setMessage("");
      setError(null);
      refresh();
    },
    onError: fail,
  });
  const act = useMutation({
    mutationFn: ({
      action,
      input,
    }: {
      action: OfferAction;
      input?: OfferActionInput;
    }) => actOnOffer(offer.id, action, input),
    onSuccess: (result) => {
      setInventoryFailed(result.inventory?.added === false);
      setPricing(false);
      setPrice("");
      setReceiving(false);
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const name = role === "requester" ? offer.userName : request.userName;
  const active = actions.length > 0;

  return (
    <section
      id={`offre-${offer.id}`}
      className={cn(
        "rounded-nexus border bg-nexus-card",
        highlighted ? "border-[#FFB98A]/60" : "border-nexus-accent/15",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-nexus-accent/10 px-4 py-3">
        <span className="font-semibold text-nexus-white">
          {role === "requester" ? offer.userName : t("thread.yourOffer")}
        </span>
        <span className="font-mono text-xs text-nexus-bright">
          {quantityLabel(offer.quantity, request.unit)}
          {offer.quality !== undefined ? ` · Q ${offer.quality}` : ""}
          {" · "}
          {offer.unitPrice !== undefined
            ? t("priceEach", { price: formatNumber(offer.unitPrice), unit })
            : t("negotiable")}
        </span>
        {offer.locationName ? (
          <span className="text-xs text-nexus-muted">
            {t("thread.lotAt", { place: offer.locationName })}
          </span>
        ) : null}
        <span className="ml-auto">
          <OfferStatusTag status={offer.status} />
        </span>
      </header>

      <ol className="space-y-2 px-4 py-3">
        {offer.timeline.map((entry) => (
          <TimelineEntry
            key={entry.id}
            entry={entry}
            mine={entry.role === role}
            unit={unit}
            requestUnit={request.unit}
          />
        ))}
      </ol>

      {error ? (
        <p className="px-4 pb-2 text-[13px] text-red-300">{error}</p>
      ) : null}
      {inventoryFailed ? (
        <p className="px-4 pb-3 text-[13px] text-amber-300">
          {t("receive.inventoryFailed")}
        </p>
      ) : null}

      {active ? (
        <div className="space-y-2 border-t border-nexus-accent/10 px-4 py-3">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (message.trim()) write.mutate();
            }}
          >
            <Input
              value={message}
              maxLength={MAX_OFFER_MESSAGE}
              placeholder={t("thread.write", { name })}
              onChange={(event) => setMessage(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={write.isPending || !message.trim()}
            >
              {t("thread.send")}
            </Button>
          </form>

          {pricing ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const each = Number(price.replace(/\s/g, ""));
                if (!Number.isFinite(each) || each < 0 || price.trim() === "") {
                  return setError(t("errors.invalid"));
                }
                act.mutate({ action: "price", input: { unitPrice: each } });
              }}
            >
              <Field label={t("fields.pricePer", { unit })} className="w-48">
                <Input
                  inputMode="numeric"
                  value={price}
                  autoFocus
                  onChange={(event) => setPrice(event.target.value)}
                />
              </Field>
              <Button type="submit" size="sm" disabled={act.isPending}>
                {t("actions.proposePrice")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPricing(false)}
              >
                {t("cancel")}
              </Button>
            </form>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {actions.includes("price") && !pricing ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPricing(true)}
              >
                {t("actions.price")}
              </Button>
            ) : null}
            {actions.includes("keep") ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "keep" })}
              >
                {t("actions.keep")}
              </Button>
            ) : null}
            {actions.includes("receive") ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setReceiving(true)}
              >
                <PackageCheck className="h-3.5 w-3.5" />
                {t("actions.receive")}
              </Button>
            ) : null}
            {actions.includes("decline") ? (
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "decline" })}
              >
                {t("actions.decline")}
              </Button>
            ) : null}
            {actions.includes("withdraw") ? (
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "withdraw" })}
              >
                {t("actions.withdraw")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {receiving ? (
        <ReceiveModal
          request={request}
          offer={offer}
          pending={act.isPending}
          onClose={() => setReceiving(false)}
          onConfirm={(input) => act.mutate({ action: "receive", input })}
        />
      ) : null}
    </section>
  );
}

function TimelineEntry({
  entry,
  mine,
  unit,
  requestUnit,
}: {
  entry: OfferEntry;
  mine: boolean;
  unit: string;
  requestUnit?: string;
}) {
  const t = useTranslations("Requests");
  const who = mine ? t("thread.you") : entry.authorName;
  const when = (
    <time
      dateTime={entry.at}
      title={formatDate(entry.at)}
      className="text-[11px] text-nexus-dim"
    >
      {formatAgo(entry.at)}
    </time>
  );

  if (entry.kind === "status" && entry.status) {
    return (
      <li className="flex items-center justify-center gap-2 text-xs text-nexus-muted">
        <span>
          {t(`events.${entry.status}`, {
            name: who,
            quantity: quantityLabel(entry.quantity ?? 0, requestUnit),
          })}
        </span>
        {when}
      </li>
    );
  }

  return (
    <li className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-nexus px-3 py-2 text-[13px]",
          mine
            ? "bg-[#FFB98A]/12 text-nexus-white"
            : "bg-nexus-accent/8 text-nexus-bright",
        )}
      >
        <div className="mb-0.5 flex items-center gap-2 text-[11.5px] font-semibold text-nexus-muted">
          {who}
          {when}
        </div>
        {entry.kind === "price" && entry.unitPrice !== undefined ? (
          <p className="font-mono">
            {t("thread.priceProposal", {
              price: formatNumber(entry.unitPrice),
              unit,
            })}
          </p>
        ) : null}
        {entry.body ? (
          <p className="whitespace-pre-wrap">{entry.body}</p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * «Reçu»: how much arrived (the whole offer by default), deducted from what
 * is still to find, and optionally stored in the reader's inventory.
 */
function ReceiveModal({
  request,
  offer,
  pending,
  onClose,
  onConfirm,
}: {
  request: PlayerRequest;
  offer: RequestOffer;
  pending: boolean;
  onClose: () => void;
  onConfirm: (input: OfferActionInput) => void;
}) {
  const t = useTranslations("Requests");
  const [quantity, setQuantity] = useState(String(offer.quantity));
  const [store, setStore] = useState(true);
  // Where it was handed over, most likely where it now lies.
  const [location, setLocation] = useState<Location | null>(
    request.location ? { ...request.location } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const unit = request.unit ?? t("unitShort");

  function confirm() {
    const amount = Number(quantity.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      return setError(t("errors.quantity"));
    }
    if (amount > offer.quantity) return setError(t("errors.receivedTooMuch"));
    if (store && !location) return setError(t("errors.location"));
    onConfirm({
      quantity: amount,
      addToInventory: store && location ? { locationId: location.id } : null,
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon={<PackageCheck className="size-5" />}
      title={t("receive.title", { name: offer.userName })}
      description={t("receive.subtitle")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            className="ml-auto"
            disabled={pending}
            onClick={confirm}
          >
            {t("receive.confirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={`${t("receive.quantity")} (${unit})`}>
          <Input
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-nexus-bright">
          <input
            type="checkbox"
            checked={store}
            onChange={(event) => setStore(event.target.checked)}
            className="accent-nexus-accent"
          />
          {t("receive.store")}
        </label>
        {store ? (
          <Field label={t("receive.where")}>
            <LocationCombobox
              value={location}
              onChange={setLocation}
              placeholder={t("form.pickupPlaceholder")}
            />
          </Field>
        ) : null}
        {error ? <p className="text-[13px] text-red-300">{error}</p> : null}
      </div>
    </Modal>
  );
}
