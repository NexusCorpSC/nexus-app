import { useTranslations } from "use-intl";
import { cn, formatNumber } from "@/lib/utils";
import {
  quantityLabel,
  type OfferStatus,
  type PlayerRequest,
  type RequestStatus,
} from "@/types/requests";

type Tone = "warn" | "info" | "ok" | "bad" | "dim";

const TONE_CLASSES: Record<Tone, string> = {
  warn: "bg-amber-400/12 text-amber-300",
  info: "bg-sky-400/12 text-sky-300",
  ok: "bg-emerald-400/12 text-emerald-300",
  bad: "bg-red-400/12 text-red-300",
  dim: "bg-nexus-accent/8 text-nexus-muted",
};

const REQUEST_TONES: Record<RequestStatus, Tone> = {
  OPEN: "ok",
  FILLED: "info",
  EXPIRED: "dim",
  CLOSED: "dim",
};

const OFFER_TONES: Record<OfferStatus, Tone> = {
  NEW: "warn",
  KEPT: "info",
  RECEIVED: "ok",
  DECLINED: "bad",
  WITHDRAWN: "dim",
};

function Tag({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap",
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function RequestStatusTag({ status }: { status: RequestStatus }) {
  const t = useTranslations("Requests.requestStatus");
  return <Tag tone={REQUEST_TONES[status]}>{t(status)}</Tag>;
}

export function OfferStatusTag({ status }: { status: OfferStatus }) {
  const t = useTranslations("Requests.offerStatus");
  return <Tag tone={OFFER_TONES[status]}>{t(status)}</Tag>;
}

/** Who sees the request: its friends, its organizations, everyone. */
export function AudienceTags({ request }: { request: PlayerRequest }) {
  const t = useTranslations("Requests.audience");
  const tags: string[] = [];
  if (request.audience.friends) tags.push(t("friends"));
  for (const org of request.audience.orgs) tags.push(org.name);
  if (request.audience.public) tags.push(t("public"));
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-[#FFB98A]/30 px-2 py-px text-[11px] text-[#FFB98A]"
        >
          {tag}
        </span>
      ))}
    </span>
  );
}

/** «120 SCU · Q ≥ 600 · 4 200 aUEC / SCU», what a request asks for. */
export function requestFacts(
  request: PlayerRequest,
  t: ReturnType<typeof useTranslations<"Requests">>,
): string {
  const parts = [quantityLabel(request.quantity, request.unit)];
  if (request.minQuality !== undefined) {
    parts.push(t("minQuality", { quality: request.minQuality }));
  }
  parts.push(
    request.unitPrice !== undefined
      ? t("priceEach", {
          price: formatNumber(request.unitPrice),
          unit: request.unit ?? t("unitShort"),
        })
      : t("negotiable"),
  );
  return parts.join(" · ");
}

/** What is still to find, as a bar. */
export function ProgressBar({ request }: { request: PlayerRequest }) {
  const share =
    request.quantity > 0
      ? Math.min(1, request.received / request.quantity)
      : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-nexus-accent/10">
      <div
        className="h-full rounded-full bg-[#FFB98A]"
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </div>
  );
}
