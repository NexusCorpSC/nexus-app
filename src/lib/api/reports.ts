import { translator } from "@/i18n/translate";
import { ApiError, apiRequest } from "@/lib/api-client";
import type { ReportInput, SubmitReportResult } from "@/types/nexus";

/**
 * Reports: the same form as the site's « Signaler » entry (see
 * `lib/reports.ts` in Nexus Tools). The site answers a refusal with an error
 * code, which `reportErrorMessage` turns into a sentence.
 */

export function submitReport(input: ReportInput) {
  return apiRequest<SubmitReportResult>("/api/reports", {
    method: "POST",
    body: input,
  });
}

/** The refusals the site answers with a code of its own. */
const CODES = [
  "unauthenticated",
  "invalidTarget",
  "targetNotFound",
  "invalidReason",
  "commentRequired",
  "ownContent",
  "alreadyReported",
  "dailyLimit",
  "busy",
  "reportingSuspended",
] as const;

type ReportErrorCode = (typeof CODES)[number];

function isReportErrorCode(value: unknown): value is ReportErrorCode {
  return (CODES as readonly unknown[]).includes(value);
}

export function reportErrorMessage(error: unknown): string {
  const t = translator("Api.reports");
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return t("unauthenticated");
    const body = error.body as { error?: string } | undefined;
    return isReportErrorCode(body?.error) ? t(body.error) : error.message;
  }
  return error instanceof Error
    ? error.message
    : translator("Common")("sendFailed");
}
