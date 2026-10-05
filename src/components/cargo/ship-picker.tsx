import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { listTransports, type TransportSource } from "@/lib/api/cargo-ships";
import {
  CUSTOM_TRANSPORT_ID,
  DEFAULT_TRANSPORT_ID,
  findTransport,
  type Transport,
} from "@/lib/cargo";
import { DEFAULT_CUSTOM_CAPACITY, type SheetShip } from "@/lib/cargo-sheet";
import { translator } from "@/i18n/translate";
import { Button, Field, Input, Select, Spinner } from "@/components/ui";

/**
 * The ships offered, and where the list came from.
 *
 * Only the windows that let a ship be *chosen* load it — the main screen, and
 * the capture import when it has to start a sheet. The overlay reads the ship
 * from the sheet itself and never asks the network for anything.
 */
export function useTransports() {
  const [transports, setTransports] = useState<Transport[] | null>(null);
  const [source, setSource] = useState<TransportSource>("builtin");

  useEffect(() => {
    let gone = false;

    void listTransports().then((result) => {
      if (gone) return;
      setTransports(result.transports);
      setSource(result.source);
    });

    return () => {
      gone = true;
    };
  }, []);

  return { transports, source, loading: transports === null };
}

/** Where the ship list came from, when it is worth a warning; empty otherwise. */
export function transportSourceLabel(source: TransportSource): string {
  const t = translator("Cargo.ships");

  switch (source) {
    case "cache":
      return t("sourceCache");
    case "builtin":
      return t("sourceBuiltin");
    default:
      return "";
  }
}

/**
 * Picks a ship, and its capacity when «Capacité libre» is chosen.
 *
 * `onSubmit` rather than a live binding: this is what starts a sheet, and
 * starting one halfway through a selection would be surprising.
 */
export function ShipPicker({
  transports,
  initialTransportId,
  initialCapacity = DEFAULT_CUSTOM_CAPACITY,
  submitLabel,
  onSubmit,
}: {
  transports: Transport[];
  initialTransportId?: string;
  initialCapacity?: number;
  submitLabel: string;
  onSubmit: (ship: SheetShip) => void;
}) {
  const t = useTranslations("Cargo.ships");
  const fallbackId =
    initialTransportId ??
    (findTransport(transports, DEFAULT_TRANSPORT_ID)
      ? DEFAULT_TRANSPORT_ID
      : (transports[0]?.id ?? CUSTOM_TRANSPORT_ID));

  const [transportId, setTransportId] = useState(fallbackId);
  const [capacity, setCapacity] = useState(String(initialCapacity));

  const custom = transportId === CUSTOM_TRANSPORT_ID;
  const parsedCapacity = Math.floor(Number(capacity));
  const capacityValid =
    !custom || (Number.isFinite(parsedCapacity) && parsedCapacity > 0);
  const selected = findTransport(transports, transportId);

  function submit() {
    if (!capacityValid) return;

    onSubmit(
      custom || !selected
        ? {
            id: CUSTOM_TRANSPORT_ID,
            name: t("custom"),
            capacity: parsedCapacity,
          }
        : selected,
    );
  }

  return (
    <div className="space-y-3">
      <Field label={t("ship")}>
        <Select
          value={transportId}
          onChange={(event) => setTransportId(event.target.value)}
        >
          {transports.map((transport) => (
            <option key={transport.id} value={transport.id}>
              {transport.name} — {transport.capacity} SCU
            </option>
          ))}
          <option value={CUSTOM_TRANSPORT_ID}>{t("custom")}</option>
        </Select>
      </Field>

      {custom ? (
        <Field label={t("capacity")}>
          <Input
            value={capacity}
            inputMode="numeric"
            onChange={(event) => setCapacity(event.target.value)}
          />
        </Field>
      ) : null}

      <Button type="button" size="sm" disabled={!capacityValid} onClick={submit}>
        {submitLabel}
      </Button>
    </div>
  );
}

export function TransportsLoading() {
  const t = useTranslations("Cargo.ships");

  return (
    <div className="flex items-center gap-2 text-xs text-nexus-accent/60">
      <Spinner />
      {t("loading")}
    </div>
  );
}
