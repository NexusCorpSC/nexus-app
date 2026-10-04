import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ExternalLink, PenLine } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { confirmPrices, confirmationErrorMessage } from "@/lib/api/contrib";
import { notify } from "@/lib/notifications";
import { getApiBaseUrl } from "@/lib/settings";
import { formatAgo } from "@/lib/utils";
import {
  CONFIRMATION_POINTS,
  MAX_CONFIRMATION_COMMENT_LENGTH,
} from "@/types/nexus";
import { Button } from "@/components/ui";

/**
 * « Toujours exact » or « Nouveau prix » under a resource's prices: one click
 * to say the prices still hold, or a word on what was seen instead. Three
 * players saying they no longer hold open a report on the site. Correcting
 * the prices themselves is done on the site.
 */
export function PriceConfirmation({
  slug,
  updatedAt,
}: {
  slug: string;
  /** `resource.pricesUpdatedAt`: a confirmation moves it to now. */
  updatedAt?: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState(false);
  const [comment, setComment] = useState("");

  const send = useMutation({
    mutationFn: (accurate: boolean) =>
      confirmPrices(slug, accurate, accurate ? undefined : comment.trim()),
    onSuccess: async (result, accurate) => {
      const points = result.confirmation.points;
      await notify({
        kind: "success",
        title: accurate
          ? points > 0
            ? `Merci ! Cours confirmés, +${points} points`
            : "Merci ! Cours confirmés"
          : "Merci, c'est noté.",
        body:
          !accurate && result.reported
            ? "Un signalement est ouvert pour revoir ces cours."
            : undefined,
        route: `/items/${slug}`,
      });
      setCorrecting(false);
      setComment("");
      void queryClient.invalidateQueries({ queryKey: ["item", slug] });
      void queryClient.invalidateQueries({ queryKey: ["me-contrib"] });
    },
  });

  if (!user) return null;

  async function openContribute() {
    const baseUrl = await getApiBaseUrl();
    await openUrl(`${baseUrl}/items/${encodeURIComponent(slug)}/contribuer`);
  }

  return (
    <div className="mt-4 rounded-lg border border-nexus-accent/12 bg-nexus-abyss/40 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-nexus-muted">
          {updatedAt ? `Confirmé ${formatAgo(updatedAt)}` : "Jamais confirmé"}
          <span className="ml-2 rounded-full bg-amber-300/12 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-200">
            +{CONFIRMATION_POINTS}
          </span>
        </p>
        <Button
          size="sm"
          onClick={() => send.mutate(true)}
          disabled={send.isPending}
        >
          <Check className="h-3.5 w-3.5" />
          Toujours exact
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCorrecting((value) => !value)}
          disabled={send.isPending}
          aria-expanded={correcting}
        >
          <PenLine className="h-3.5 w-3.5" />
          Nouveau prix
        </Button>
      </div>

      {correcting ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate(false);
          }}
        >
          <textarea
            rows={2}
            value={comment}
            maxLength={MAX_CONFIRMATION_COMMENT_LENGTH}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Quel prix avez-vous relevé, et où ?"
            className="w-full resize-y rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 py-2 text-[13px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void openContribute()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Corriger sur le site
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={send.isPending || comment.trim().length === 0}
            >
              {send.isPending ? "Envoi…" : "Envoyer"}
            </Button>
          </div>
        </form>
      ) : null}

      {send.isError ? (
        <p role="alert" className="mt-2 text-[13px] text-red-300">
          {confirmationErrorMessage(send.error)}
        </p>
      ) : null}
    </div>
  );
}
