import { ApiError, apiRequest } from "@/lib/api-client";
import type { ReportInput, SubmitReportResult } from "@/types/nexus";

/**
 * Reports: the same form as the site's « Signaler » entry (see
 * `lib/reports.ts` in Nexus Tools). The site answers a refusal with an error
 * code, which `reportErrorMessage` turns into its French wording.
 */

export function submitReport(input: ReportInput) {
  return apiRequest<SubmitReportResult>("/api/reports", {
    method: "POST",
    body: input,
  });
}

const MESSAGES: Record<string, string> = {
  unauthenticated: "Connectez-vous pour signaler.",
  invalidTarget: "Cet élément ne peut pas être signalé.",
  targetNotFound: "Cet élément n'existe plus.",
  invalidReason: "Choisissez un motif.",
  commentRequired: "Précisez le problème pour le motif « Autre ».",
  ownContent:
    "On ne signale pas son propre contenu : proposez plutôt une correction sur le site.",
  alreadyReported:
    "Vous avez déjà signalé cet élément. Un modérateur s'en occupe.",
  dailyLimit: "Dix signalements par jour au plus. Réessayez demain.",
  reportingSuspended:
    "Trois de vos signalements ont été classés d'affilée : vous ne pouvez plus signaler pendant 7 jours.",
};

export function reportErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return MESSAGES.unauthenticated;
    const body = error.body as { error?: string } | undefined;
    return (body?.error && MESSAGES[body.error]) || error.message;
  }
  return error instanceof Error ? error.message : "L'envoi a échoué.";
}
