import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, Flag } from "lucide-react";
import { reportErrorMessage, submitReport } from "@/lib/api/reports";
import { cn } from "@/lib/utils";
import {
  MAX_REPORT_COMMENT_LENGTH,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  REPORT_UPHELD_POINTS,
  type ReportReason,
  type ReportTargetType,
} from "@/types/nexus";
import { Button, Modal } from "@/components/ui";

const TITLES: Record<ReportTargetType, string> = {
  place: "Signaler ce lieu",
  placeMedia: "Signaler cette image",
  plan: "Signaler cette carte",
  item: "Signaler cet objet",
  org: "Signaler cette organisation",
};

/**
 * « Signaler », avec le même formulaire que sur le site : un motif, un
 * commentaire facultatif sauf pour « Autre ». Le site garde un dossier par
 * fiche ; un modérateur tranche.
 */
export function ReportButton({
  type,
  id,
  name,
}: {
  type: ReportTargetType;
  /** Un slug pour un lieu ou un objet. */
  id: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Flag className="h-3.5 w-3.5" />
        Signaler
      </Button>
      {open ? (
        <ReportModal
          type={type}
          id={id}
          name={name}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ReportModal({
  type,
  id,
  name,
  onClose,
}: {
  type: ReportTargetType;
  id: string;
  name: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState("");
  const send = useMutation({
    mutationFn: () =>
      submitReport({
        target: { type, id },
        reason: reason!,
        comment: comment.trim() || undefined,
      }),
  });
  const needsComment = reason === "other" && comment.trim().length === 0;

  if (send.isSuccess) {
    return (
      <Modal
        open
        title="Merci, c'est noté"
        icon={<CircleCheck className="size-5" />}
        onClose={onClose}
        footer={
          <Button variant="outline" onClick={onClose} className="ml-auto">
            Fermer
          </Button>
        }
      >
        <p className="text-[13px] leading-relaxed text-nexus-muted">
          La décision s'affichera dans Mes contributions, sur le site. Si le
          signalement est retenu, il vous rapporte {REPORT_UPHELD_POINTS}{" "}
          points.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title={TITLES[type]}
      description={`${name} · un modérateur examine chaque signalement`}
      icon={<Flag className="size-5" />}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} className="ml-auto">
            Annuler
          </Button>
          <Button
            onClick={() => send.mutate()}
            disabled={!reason || needsComment || send.isPending}
          >
            {send.isPending ? "Envoi…" : "Envoyer le signalement"}
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-[13px] font-semibold text-nexus-white">
          Quel est le problème ?
        </legend>
        {REPORT_REASONS.map((entry) => (
          <label
            key={entry}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-[13px] text-nexus-white transition-colors",
              reason === entry
                ? "border-nexus-accent bg-nexus-accent/8"
                : "border-nexus-accent/15 hover:bg-nexus-accent/5",
            )}
          >
            <input
              type="radio"
              name="report-reason"
              checked={reason === entry}
              onChange={() => setReason(entry)}
              className="mt-0.5 size-4 accent-nexus-accent"
            />
            <span>
              {REPORT_REASON_LABELS[entry].label}
              <small className="mt-0.5 block text-xs text-nexus-dim">
                {REPORT_REASON_LABELS[entry].hint}
              </small>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="mt-4 block space-y-1.5">
        <span className="text-[13px] text-nexus-muted">
          {reason === "other"
            ? "Précisez (obligatoire pour « Autre »)"
            : "Précisez (facultatif sauf « Autre »)"}
        </span>
        <textarea
          rows={3}
          value={comment}
          maxLength={MAX_REPORT_COMMENT_LENGTH}
          onChange={(event) => setComment(event.target.value)}
          className="w-full resize-y rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 py-2 text-[13.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
        />
      </label>

      {send.isError ? (
        <p role="alert" className="mt-3 text-[13px] text-red-300">
          {reportErrorMessage(send.error)}
        </p>
      ) : null}
    </Modal>
  );
}
