import { Link, useNavigate } from "react-router-dom";
import { MapPin } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui";
import { requestRoute } from "@/lib/requests";
import { formatAgo } from "@/lib/utils";
import {
  ACTIVE_OFFER_STATUSES,
  quantityLabel,
  type PlayerRequest,
} from "@/types/requests";
import {
  AudienceTags,
  OfferStatusTag,
  ProgressBar,
  RequestStatusTag,
  requestFacts,
} from "./request-ui";

/**
 * One request on the board: what, how much, where, for whom, and «J'en ai»
 * when the reader can answer it.
 */
export function RequestCard({
  request,
  onOffer,
}: {
  request: PlayerRequest;
  onOffer?: (request: PlayerRequest) => void;
}) {
  const t = useTranslations("Requests");
  const navigate = useNavigate();
  // Une offre déclinée ou retirée n'empêche pas d'en refaire une, comme sur le site.
  const activeOffer =
    request.myOffer && ACTIVE_OFFER_STATUSES.includes(request.myOffer.status)
      ? request.myOffer
      : undefined;
  const canOffer = !request.mine && !activeOffer && request.status === "OPEN";
  const supply = request.supply;

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-nexus-accent/15 bg-nexus-card px-4 py-3">
      <div className="flex items-start gap-2">
        <Link
          to={requestRoute(request.id)}
          className="min-w-0 flex-1 truncate font-semibold text-nexus-white hover:text-[#FFB98A]"
        >
          {request.name}
        </Link>
        {request.status !== "OPEN" ? (
          <RequestStatusTag status={request.status} />
        ) : null}
        {request.myOffer ? (
          <OfferStatusTag status={request.myOffer.status} />
        ) : null}
      </div>
      <div className="font-mono text-[12.5px] text-nexus-bright">
        {requestFacts(request, t)}
      </div>
      {request.received > 0 ? (
        <div className="space-y-1">
          <ProgressBar request={request} />
          <p className="text-[11.5px] text-nexus-muted">
            {t("progress", {
              received: quantityLabel(request.received, request.unit),
              quantity: quantityLabel(request.quantity, request.unit),
            })}
          </p>
        </div>
      ) : null}
      {request.location ? (
        <p className="flex items-center gap-1 text-xs text-nexus-muted">
          <MapPin className="size-3.5" />
          {t("pickupAt", { place: request.location.name })}
        </p>
      ) : null}
      {supply ? (
        <p className="text-xs text-emerald-300">
          {supply.locationName
            ? t("youHaveAt", {
                quantity: quantityLabel(supply.quantity, request.unit),
                quality:
                  supply.quality !== undefined ? ` · Q ${supply.quality}` : "",
                place: supply.locationName,
              })
            : t("youHave", {
                quantity: quantityLabel(supply.quantity, request.unit),
                quality:
                  supply.quality !== undefined ? ` · Q ${supply.quality}` : "",
              })}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs text-nexus-muted">
          {request.mine ? t("byYou") : request.userName} ·{" "}
          {t("expires", { when: formatAgo(request.expiresAt) })}
        </span>
        <AudienceTags request={request} />
        <span className="ml-auto flex gap-2">
          {canOffer && onOffer ? (
            <Button type="button" size="sm" onClick={() => onOffer(request)}>
              {t("iHaveIt")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                navigate(requestRoute(request.id, request.myOffer?.id))
              }
            >
              {request.mine
                ? t("offerCount", { count: request.activeOffers })
                : request.myOffer
                  ? t("openMyOffer")
                  : t("open")}
            </Button>
          )}
        </span>
      </div>
    </article>
  );
}
