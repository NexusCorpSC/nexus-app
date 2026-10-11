import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, PackagePlus } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button, Modal, Segmented } from "@/components/ui";
import { LocationCombobox } from "@/components/inventory/location-combobox";
import { listInventoryItems } from "@/lib/api/inventory";
import { collectRefiningJob } from "@/lib/api/refining";
import { notify } from "@/lib/notifications";
import {
  isInert,
  MAX_REFINING_LINES,
  REFINING_KEY,
  refiningErrorMessage,
} from "@/lib/refining";
import { roundQty } from "@/lib/units";
import { formatNumber } from "@/lib/utils";
import type { Location, RefiningJob, RefiningLine } from "@/types/nexus";
import {
  checkDraft,
  isBlank,
  LinesTable,
  toDraft,
  type LineDraft,
} from "./lines-table";

type Unit = "cSCU" | "SCU";

function same(a: string | undefined, b: string | undefined) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/**
 * Collecting a finished order: its lines, already filled in, go into the
 * inventory at the refinery (or the place picked), and the order goes away.
 *
 * A capture of the finished panel, taken with the area capture, replaces the
 * lines when the actual yield differs: it comes in as `captured`. The right
 * column says, line by line, whether it tops up a lot already there (same
 * material, quality and unit, no note) or makes a new one, as the bulk add
 * will.
 */
export function CollectModal({
  job,
  captured,
  onClose,
}: {
  job: RefiningJob;
  /** Lines read from a capture, in place of the order's. */
  captured?: Partial<RefiningLine>[];
  onClose: () => void;
}) {
  const t = useTranslations("Refining");
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<LineDraft[]>(() => {
    const source = captured && captured.length > 0 ? captured : job.lines;
    return source.length > 0
      ? source.map((line) => toDraft(line, !isInert(line.name ?? "")))
      : [toDraft({})];
  });
  const [location, setLocation] = useState<Location | null>(() =>
    job.locationId ? { id: job.locationId, name: job.location } : null,
  );
  const [unit, setUnit] = useState<Unit>("cSCU");
  const [orgVisible, setOrgVisible] = useState(false);
  // "Remove without adding" deletes the order for good: a second click confirms.
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // The lots already at the place picked, to tell those that will be topped up.
  const held = useQuery({
    queryKey: ["inventory-items", "location", location?.id],
    queryFn: () => listInventoryItems({ locationId: location!.id }),
    enabled: Boolean(location),
  });

  const taken = rows.filter((row) => row.take);
  const checked = taken.filter((row) => !isBlank(row)).map(checkDraft);
  const lines = checked.flatMap((result) => (result.ok ? [result.line] : []));
  const invalid = checked.length - lines.length;
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);

  const outcome = (row: LineDraft) => {
    if (!row.take) return <span className="text-nexus-dim">{t("collectLeft")}</span>;
    const result = checkDraft(row);
    if (!result.ok || !held.data) return null;
    const match = held.data.find(
      (lot) =>
        same(lot.name, result.line.name) &&
        same(lot.unit, unit) &&
        !lot.description?.trim() &&
        (lot.quality ?? undefined) === result.line.quality,
    );
    return match ? (
      <span className="text-emerald-300">{t("collectMerge")}</span>
    ) : (
      <span className="text-nexus-muted">{t("collectNew")}</span>
    );
  };

  const collect = useMutation({
    mutationFn: (withLines: boolean) =>
      collectRefiningJob(job.id, {
        lines: withLines ? lines : [],
        locationId: location?.id ?? "",
        unit,
        orgVisible,
      }),
    onSuccess: async (result, withLines) => {
      await queryClient.invalidateQueries({ queryKey: REFINING_KEY });
      await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      onClose();
      await notify(
        withLines
          ? {
              kind: "success",
              title: t("collectDone", { name: location?.name ?? "" }),
              body: t("collectDoneDescription", {
                created: result.created,
                merged: result.merged,
              }),
              route: "/inventory",
            }
          : { kind: "success", title: t("jobRemoved") },
      ).catch((cause) => console.error("cannot notify", cause));
    },
  });

  const tooMany = lines.length > MAX_REFINING_LINES;
  const canCollect =
    !!location &&
    lines.length > 0 &&
    !tooMany &&
    invalid === 0 &&
    !collect.isPending;

  return (
    <Modal
      open
      title={t("collectTitle")}
      description={[job.location, job.method].filter(Boolean).join(" · ")}
      icon={<PackagePlus className="size-5" />}
      onClose={onClose}
      wide
      footer={
        <>
          <p className="mr-auto text-xs text-nexus-muted">
            {!location
              ? t("collectPickLocation")
              : invalid > 0
                ? t("linesInvalid", { count: invalid })
                : tooMany
                  ? t("linesTooMany", { max: MAX_REFINING_LINES })
                  : t("collectSum", {
                      count: lines.length,
                      total: formatNumber(
                        unit === "SCU" ? roundQty(total / 100) : total,
                      ),
                      unit,
                    })}
          </p>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant={confirmDiscard ? "danger" : "ghost"}
            disabled={collect.isPending}
            onClick={() =>
              confirmDiscard ? collect.mutate(false) : setConfirmDiscard(true)
            }
            onBlur={() => setConfirmDiscard(false)}
          >
            {confirmDiscard ? t("collectDiscardConfirm") : t("collectDiscard")}
          </Button>
          <Button
            type="button"
            disabled={!canCollect}
            onClick={() => collect.mutate(true)}
            className="border-emerald-300 bg-emerald-300 text-[#053527] hover:bg-emerald-200"
          >
            <PackagePlus className="size-4" />
            {collect.isPending ? t("adding") : t("collectSubmit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2.5 rounded-lg border border-dashed border-nexus-accent/25 px-3 py-2.5 text-[13px] text-nexus-soft/85">
          <Camera className="mt-0.5 size-4 shrink-0 text-nexus-accent" />
          {captured && captured.length > 0
            ? t("collectFromCapture")
            : t("collectCaptureHintApp")}
        </p>

        {job.content ? (
          <p className="rounded-lg border border-dashed border-nexus-accent/25 px-3 py-2 text-[13px] text-nexus-soft">
            {t("legacyContent", { content: job.content })}
          </p>
        ) : null}

        <LinesTable
          rows={rows}
          onChange={setRows}
          selectable
          outcome={location ? outcome : undefined}
        />

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-1.5">
            <span className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
              {t("collectLocation")}
            </span>
            <LocationCombobox
              value={location}
              onChange={setLocation}
              placeholder={job.location || t("refineryPlaceholder")}
              aria-label={t("collectLocation")}
              className="w-full rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 py-2 text-[13.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
            />
            <p className="text-xs text-nexus-dim">{t("collectLocationHint")}</p>
          </div>
          <div className="space-y-1.5">
            <span className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
              {t("collectUnit")}
            </span>
            <Segmented
              value={unit}
              onChange={setUnit}
              label={t("collectUnit")}
              options={[
                { value: "cSCU", label: "cSCU" },
                { value: "SCU", label: "SCU" },
              ]}
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-nexus-bright">
          <input
            type="checkbox"
            checked={orgVisible}
            onChange={(event) => setOrgVisible(event.target.checked)}
            className="accent-nexus-accent"
          />
          {t("orgVisible")}
        </label>

        {collect.error ? (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
            {refiningErrorMessage(collect.error, "errorCollect")}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
