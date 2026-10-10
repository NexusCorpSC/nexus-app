import { useLocale, useTranslations } from "use-intl";
import { cn } from "@/lib/utils";
import type { ChatStatus } from "@/types/chat";

/**
 * Microdollars as dollars: two decimals, four under a dollar (a Haiku answer
 * costs a few tenths of a cent). Mirrors `lib/chat/format.ts` on the site.
 */
export function formatUsd(micros: number, locale: string): string {
  const usd = micros / 1_000_000;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(usd) < 1 && usd !== 0 ? 4 : 2,
  }).format(usd);
}

export function resetDate(status: ChatStatus, locale: string): string {
  return new Date(status.resetsAt).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
  });
}

/**
 * What the player has used of this month's budget, on one line with a thin
 * bar; when it starts again is in the tooltip.
 */
export function ChatBudget({ status }: { status: ChatStatus }) {
  const t = useTranslations("Chat.budget");
  const locale = useLocale();
  const ratio =
    status.monthlyBudgetMicros > 0
      ? Math.min(1, status.spentMicros / status.monthlyBudgetMicros)
      : 1;
  const resets = t("resets", { date: resetDate(status, locale) });

  return (
    <div className="space-y-1.5" title={resets}>
      <div className="flex items-baseline justify-between gap-2 text-xs text-[#8fb1d6]">
        <span>{t("label")}</span>
        <span className="font-mono whitespace-nowrap text-[#cfe2f7]">
          {t("spent", {
            spent: formatUsd(status.spentMicros, locale),
            budget: formatUsd(status.monthlyBudgetMicros, locale),
          })}
        </span>
      </div>
      <div
        className="h-0.5 overflow-hidden rounded-full bg-[#8fd0ff]/12"
        role="progressbar"
        aria-label={t("label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <div
          className={cn(
            "h-full rounded-full",
            ratio >= 0.9 ? "bg-amber-300" : "bg-[#8fd0ff]",
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p className="sr-only">{resets}</p>
    </div>
  );
}
