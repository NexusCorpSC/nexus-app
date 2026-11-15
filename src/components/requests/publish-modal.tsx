import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { useTranslations } from "use-intl";
import { ItemNameCombobox } from "@/components/inventory/item-name-combobox";
import { LocationCombobox } from "@/components/inventory/location-combobox";
import { Button, Chip, Field, Input, Modal, Select } from "@/components/ui";
import { useDebounced } from "@/hooks/use-debounced";
import { listItems } from "@/lib/api/items";
import { createRequest } from "@/lib/api/requests";
import { REQUEST_BOARD_KEY, requestErrorCode, REQUESTS_KEY } from "@/lib/requests";
import type { Location } from "@/types/nexus";
import {
  DEFAULT_REQUEST_EXPIRY_DAYS,
  MAX_REQUEST_NAME,
  MAX_REQUEST_NOTE,
  REQUEST_EXPIRY_DAYS,
  REQUEST_UNITS,
  type PlayerRequest,
  type RequestKind,
  type RequestUnit,
} from "@/types/requests";

function fold(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * The catalogue entry named exactly as typed, if any: it decides whether the
 * request counts SCU and a quality, as on the site.
 */
function useCatalogMatch(name: string) {
  const query = useDebounced(name.trim(), 300);
  const result = useQuery({
    queryKey: ["item-names", query, "exact"],
    queryFn: () => listItems({ query, limit: 10 }),
    enabled: query.length >= 2,
    staleTime: 10 * 60_000,
  });
  if (!query) return null;
  return (
    result.data?.items.find((item) => fold(item.name) === fold(query)) ?? null
  );
}

/**
 * «Publier une demande»: what the reader is looking for, how much, where it is
 * handed over, at what price, who sees it and for how long. Friends and the
 * organizations ticked are told.
 */
export function PublishModal({
  open,
  onClose,
  orgs,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  orgs: { id: string; name: string }[];
  onPublished?: (request: PlayerRequest) => void;
}) {
  const t = useTranslations("Requests");
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      icon={<ClipboardList className="size-5" />}
      title={t("form.title")}
      description={t("form.subtitle")}
    >
      <PublishForm orgs={orgs} onClose={onClose} onPublished={onPublished} />
    </Modal>
  );
}

function PublishForm({
  orgs,
  onClose,
  onPublished,
}: {
  orgs: { id: string; name: string }[];
  onClose: () => void;
  onPublished?: (request: PlayerRequest) => void;
}) {
  const t = useTranslations("Requests");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<RequestUnit | "">("SCU");
  const [quantity, setQuantity] = useState("");
  const [minQuality, setMinQuality] = useState("");
  const [location, setLocation] = useState<Location | null>(null);
  const [price, setPrice] = useState("");
  const [friends, setFriends] = useState(true);
  const [orgIds, setOrgIds] = useState<string[]>(() =>
    orgs.map((org) => org.id),
  );
  const [isPublic, setPublic] = useState(false);
  const [days, setDays] = useState<number>(DEFAULT_REQUEST_EXPIRY_DAYS);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const match = useCatalogMatch(name);
  const kind: RequestKind = match?.kind ?? "other";
  const material = kind === "resource" || kind === "other";
  const shownUnit = material ? unit : "";

  const publish = useMutation({
    mutationFn: () =>
      createRequest({
        name: name.trim(),
        itemSlug: match?.slug,
        quantity: Number(quantity.replace(",", ".")),
        unit: shownUnit || null,
        minQuality:
          material && minQuality.trim() !== "" ? Number(minQuality) : null,
        locationId: location?.id ?? null,
        unitPrice:
          price.trim() === "" ? null : Number(price.replace(/\s/g, "")),
        note: note.trim() || null,
        audience: { friends, orgIds, public: isPublic },
        expiresInDays: days,
      }),
    onSuccess: (request) => {
      void queryClient.invalidateQueries({ queryKey: REQUEST_BOARD_KEY });
      void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
      onClose();
      onPublished?.(request);
    },
    onError: (cause) => {
      const code = requestErrorCode(cause);
      setError(code ? t(`errors.${code}`) : t("errors.generic"));
    },
  });

  function submit() {
    const amount = Number(quantity.replace(",", "."));
    if (!name.trim()) return setError(t("errors.name"));
    if (!Number.isFinite(amount) || amount <= 0) {
      return setError(t("errors.quantity"));
    }
    if (!shownUnit && !Number.isInteger(amount)) {
      return setError(t("errors.wholeQuantity"));
    }
    if (!friends && orgIds.length === 0 && !isPublic) {
      return setError(t("errors.audience"));
    }
    setError(null);
    publish.mutate();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label={t("form.what")}>
        <ItemNameCombobox
          value={name}
          onChange={(next) => setName(next.slice(0, MAX_REQUEST_NAME))}
          placeholder={t("form.whatPlaceholder")}
          autoFocus
          required
        />
        <span className="block text-xs text-nexus-dim">
          {name.trim()
            ? match
              ? t("form.catalogKind", { kind: t(`kinds.${match.kind}`) })
              : t("form.freeText")
            : t("form.whatHint")}
        </span>
      </Field>

      {material ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
            {t("form.unit")}
          </span>
          {[...REQUEST_UNITS, ""].map((entry) => (
            <Chip
              key={entry || "units"}
              active={unit === entry}
              onClick={() => setUnit(entry as RequestUnit | "")}
            >
              {entry || t("form.units")}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Field label={t("fields.quantity")}>
          <Input
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
        </Field>
        {material ? (
          <Field label={t("form.minQuality")}>
            <Input
              inputMode="numeric"
              value={minQuality}
              placeholder={t("form.minQualityPlaceholder")}
              onChange={(event) => setMinQuality(event.target.value)}
            />
          </Field>
        ) : (
          <div />
        )}
        <Field
          label={
            shownUnit
              ? t("fields.pricePer", { unit: shownUnit })
              : t("fields.pricePerUnit")
          }
        >
          <Input
            inputMode="numeric"
            value={price}
            placeholder={t("negotiable")}
            onChange={(event) => setPrice(event.target.value)}
          />
        </Field>
      </div>

      <Field label={t("form.pickup")}>
        <LocationCombobox
          value={location}
          onChange={setLocation}
          placeholder={t("form.pickupPlaceholder")}
        />
      </Field>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
          {t("form.audience")}
        </legend>
        <div className="flex flex-wrap gap-2">
          <Chip active={friends} onClick={() => setFriends(!friends)}>
            {t("form.myFriends")}
          </Chip>
          {orgs.map((org) => {
            const on = orgIds.includes(org.id);
            return (
              <Chip
                key={org.id}
                active={on}
                onClick={() =>
                  setOrgIds(
                    on
                      ? orgIds.filter((id) => id !== org.id)
                      : [...orgIds, org.id],
                  )
                }
              >
                {org.name}
              </Chip>
            );
          })}
          <Chip active={isPublic} onClick={() => setPublic(!isPublic)}>
            {t("audience.public")}
          </Chip>
        </div>
        <p className="text-xs text-nexus-dim">{t("form.audienceHint")}</p>
      </fieldset>

      <div className="grid grid-cols-[auto_1fr] items-start gap-3">
        <Field label={t("form.expiresIn")}>
          <Select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {REQUEST_EXPIRY_DAYS.map((count) => (
              <option key={count} value={count}>
                {t("form.days", { count })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t("form.note")} (${t("form.optional")})`}>
          <textarea
            value={note}
            maxLength={MAX_REQUEST_NOTE}
            rows={2}
            placeholder={t("form.notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 py-2 text-[13.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
          />
        </Field>
      </div>

      {error ? <p className="text-[13px] text-red-300">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={publish.isPending}>
          {publish.isPending ? t("sending") : t("form.publish")}
        </Button>
      </div>
    </form>
  );
}
