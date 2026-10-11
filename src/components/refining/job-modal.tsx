import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { LocationCombobox } from "@/components/inventory/location-combobox";
import { createRefiningJob, updateRefiningJob } from "@/lib/api/refining";
import {
  formatDurationInput,
  formatMinutes,
  MAX_REFINING_DURATION,
  MAX_REFINING_LINES,
  parseDuration,
  REFINING_KEY,
  REFINING_METHODS,
  refiningErrorMessage,
} from "@/lib/refining";
import { getLocale } from "@/i18n/locale";
import { cn, formatNumber } from "@/lib/utils";
import type { Location, RefiningJob } from "@/types/nexus";
import {
  checkDraft,
  isBlank,
  LinesTable,
  toDraft,
  type LineDraft,
} from "./lines-table";

/**
 * Starting to track an order, or editing one: refinery, method, duration,
 * cost, the materials expected and a note. An older free-text order shows its
 * text above the lines, to be copied into them. Mounted on each opening, so
 * it starts from the order (or from nothing) every time.
 */
export function JobModal({
  job,
  defaultLocation,
  onClose,
}: {
  /** The order to edit; absent for a new one. */
  job?: RefiningJob;
  /** The refinery used last, offered for a new order. */
  defaultLocation?: Location | null;
  onClose: () => void;
}) {
  const t = useTranslations("Refining");
  const queryClient = useQueryClient();
  const [openedAt] = useState(() => Date.now());
  const [location, setLocation] = useState<Location | null>(() =>
    job
      ? job.locationId
        ? { id: job.locationId, name: job.location }
        : null
      : (defaultLocation ?? null),
  );
  const [method, setMethod] = useState(job?.method ?? "");
  const [duration, setDuration] = useState(() =>
    job ? formatDurationInput(job.duration) : "",
  );
  const [cost, setCost] = useState(job?.cost?.toString() ?? "");
  const [note, setNote] = useState(job?.note ?? "");
  const [rows, setRows] = useState<LineDraft[]>(() =>
    job && job.lines.length > 0
      ? job.lines.map((line) => toDraft(line))
      : [toDraft({})],
  );

  const parsed = parseDuration(duration);
  // Beyond what the site accepts: told here rather than on the way back.
  const tooLong = parsed !== null && parsed > MAX_REFINING_DURATION;
  const minutes = tooLong ? null : parsed;
  const checked = rows.filter((row) => !isBlank(row)).map(checkDraft);
  const lines = checked.flatMap((result) => (result.ok ? [result.line] : []));
  const invalid = checked.length - lines.length;
  const costValue = cost.trim() === "" ? undefined : Number(cost);
  const costInvalid =
    costValue !== undefined && (!Number.isInteger(costValue) || costValue < 0);
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);

  // The end: from now for a new order, from its start for one edited.
  const start = job ? Date.parse(job.startTime) : openedAt;
  const end =
    minutes !== null
      ? new Date(start + minutes * 60_000).toLocaleString(getLocale(), {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  const save = useMutation({
    mutationFn: () => {
      const input = {
        locationId: location!.id,
        method: method || undefined,
        lines,
        cost: costValue,
        note: note.trim() || undefined,
        duration: minutes!,
      };
      return job ? updateRefiningJob(job.id, input) : createRefiningJob(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: REFINING_KEY });
      onClose();
    },
  });

  const canSubmit =
    !!location &&
    minutes !== null &&
    lines.length > 0 &&
    lines.length <= MAX_REFINING_LINES &&
    invalid === 0 &&
    !costInvalid &&
    !save.isPending;

  return (
    <Modal
      open
      title={job ? t("editJob") : t("newJob")}
      description={t("jobDialogDescription")}
      icon={<FlaskConical className="size-5" />}
      onClose={onClose}
      wide
      footer={
        <>
          <p className="mr-auto text-xs text-nexus-muted">
            {invalid > 0
              ? t("linesInvalid", { count: invalid })
              : lines.length > MAX_REFINING_LINES
                ? t("linesTooMany", { max: MAX_REFINING_LINES })
                : t("linesSum", {
                    count: lines.length,
                    total: formatNumber(total),
                  })}
          </p>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t("saving")
              : job
                ? t("saveChanges")
                : t("startTracking")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
              {t("refinery")}
            </span>
            <LocationCombobox
              value={location}
              onChange={setLocation}
              placeholder={
                job && !job.locationId ? job.location : t("refineryPlaceholder")
              }
              aria-label={t("refinery")}
              className="w-full rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 py-2 text-[13.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
            />
          </div>
          <Field label={`${t("method")} ${t("optional")}`}>
            <Select
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value="">{t("methodNone")}</option>
              {REFINING_METHODS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("duration")}>
            <Input
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              placeholder={t("durationPlaceholder")}
              aria-invalid={(duration !== "" && minutes === null) || undefined}
              className="font-mono"
            />
            {duration !== "" ? (
              minutes === null ? (
                <span className="block text-xs text-red-300">
                  {tooLong ? t("durationTooLong") : t("durationInvalid")}
                </span>
              ) : (
                <span className="block text-xs text-emerald-300">
                  {t("durationEquivalent", {
                    duration: formatMinutes(minutes),
                    end,
                  })}
                </span>
              )
            ) : null}
          </Field>
          <Field label={`${t("cost")} ${t("optional")}`}>
            <div className="relative">
              <Input
                inputMode="numeric"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                aria-invalid={costInvalid || undefined}
                className={cn("pr-14 font-mono", costInvalid && "text-red-300")}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-nexus-muted">
                aUEC
              </span>
            </div>
          </Field>
        </div>

        <div className="space-y-2">
          <span className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
            {t("expectedMaterials")}
          </span>
          {job?.content ? (
            <p className="rounded-lg border border-dashed border-nexus-accent/25 px-3 py-2 text-[13px] text-nexus-soft">
              {t("legacyContent", { content: job.content })}
            </p>
          ) : null}
          <LinesTable rows={rows} onChange={setRows} />
          <p className="text-xs text-nexus-dim">{t("linesHint")}</p>
        </div>

        <Field label={`${t("note")} ${t("optional")}`}>
          <Input
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("notePlaceholder")}
          />
        </Field>

        {save.error ? (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
            {refiningErrorMessage(save.error, "errorSave")}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
