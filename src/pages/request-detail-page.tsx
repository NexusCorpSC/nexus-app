import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ExternalLink, MapPin } from "lucide-react";
import { useTranslations } from "use-intl";
import { BackLink } from "@/components/layout/back-link";
import { OfferModal } from "@/components/requests/offer-modal";
import { OfferThread } from "@/components/requests/offer-thread";
import {
  AudienceTags,
  ProgressBar,
  RequestStatusTag,
  requestFacts,
} from "@/components/requests/request-ui";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  SectionTitle,
} from "@/components/ui";
import { changeRequest, getRequestDetail } from "@/lib/api/requests";
import { openOnSite } from "@/lib/org-events";
import {
  REQUEST_BOARD_KEY,
  requestDetailKey,
  requestErrorCode,
  requestRoute,
  REQUESTS_KEY,
} from "@/lib/requests";
import { formatAgo, formatDate } from "@/lib/utils";
import {
  ACTIVE_OFFER_STATUSES,
  quantityLabel,
  REQUEST_EXPIRY_DAYS,
  requestPath,
  type PlayerRequest,
} from "@/types/requests";

/**
 * One request: what is asked, what came in, and the offers with their
 * threads. Its author sees every offer; a supplier only theirs.
 */
export default function RequestDetailPage() {
  const t = useTranslations("Requests");
  const { requestId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const highlighted = searchParams.get("offer");
  const navigate = useNavigate();
  const [offering, setOffering] = useState(false);

  const detail = useQuery({
    queryKey: requestDetailKey(requestId),
    queryFn: () => getRequestDetail(requestId),
    enabled: Boolean(requestId),
  });

  // An offer pointed at by a notification is scrolled to once drawn.
  useEffect(() => {
    if (!highlighted || !detail.data) return;
    document
      .getElementById(`offre-${highlighted}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [highlighted, detail.data]);

  if (detail.isPending) return <LoadingState />;
  if (detail.isError) {
    const code = requestErrorCode(detail.error);
    return (
      <>
        <BackLink to="/requests">{t("backToBoard")}</BackLink>
        {code === "notFound" ? (
          <EmptyState title={t("errors.notFound")} />
        ) : (
          <ErrorState
            error={detail.error}
            onRetry={() => void detail.refetch()}
          />
        )}
      </>
    );
  }

  const { request, offers } = detail.data;
  // Une offre déclinée ou retirée n'empêche pas d'en refaire une, comme sur le site.
  const canOffer =
    !request.mine &&
    !offers.some((offer) => ACTIVE_OFFER_STATUSES.includes(offer.status)) &&
    request.status === "OPEN";

  return (
    <>
      <BackLink to="/requests">{t("backToBoard")}</BackLink>

      <Card className="mb-6 space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold text-nexus-white">
              {request.name}
            </h1>
            <p className="text-xs text-nexus-muted">
              {t(`kinds.${request.kind}`)} ·{" "}
              {request.mine ? t("byYou") : request.userName} ·{" "}
              <span title={formatDate(request.expiresAt)}>
                {t("expires", { when: formatAgo(request.expiresAt) })}
              </span>
            </p>
          </div>
          <RequestStatusTag status={request.status} />
        </div>

        <p className="font-mono text-[13px] text-nexus-bright">
          {requestFacts(request, t)}
        </p>
        <div className="space-y-1">
          <ProgressBar request={request} />
          <p className="text-xs text-nexus-muted">
            {t("receivedRemaining", {
              received: quantityLabel(request.received, request.unit),
              remaining: quantityLabel(request.remaining, request.unit),
              offers: request.activeOffers,
            })}
          </p>
        </div>
        {request.location ? (
          <p className="flex items-center gap-1 text-xs text-nexus-muted">
            <MapPin className="size-3.5" />
            {t("pickupAt", { place: request.location.name })}
          </p>
        ) : null}
        <AudienceTags request={request} />
        {request.note ? (
          <p className="text-[13px] whitespace-pre-wrap text-nexus-soft">
            {request.note}
          </p>
        ) : null}
        <p className="text-xs text-nexus-dim">{t("tradeInGame")}</p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canOffer ? (
            <Button type="button" onClick={() => setOffering(true)}>
              {t("iHaveIt")}
            </Button>
          ) : null}
          {request.mine ? <OwnerActions request={request} /> : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => void openOnSite(requestPath(request.id))}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("onSite")}
          </Button>
        </div>
      </Card>

      <SectionTitle aside={String(offers.length)}>
        {request.mine ? t("offers.label") : t("offers.mine")}
      </SectionTitle>
      {offers.length === 0 ? (
        <p className="text-[13px] text-nexus-muted">
          {request.mine ? t("offers.emptyMine") : t("offers.emptyOther")}
        </p>
      ) : (
        <div className="space-y-4">
          {offers.map((offer) => (
            <OfferThread
              key={offer.id}
              request={request}
              offer={offer}
              highlighted={offer.id === highlighted}
            />
          ))}
        </div>
      )}

      {offering ? (
        <OfferModal
          request={request}
          open
          onClose={() => setOffering(false)}
          onSent={(offer) =>
            navigate(requestRoute(request.id, offer.id), { replace: true })
          }
        />
      ) : null}
    </>
  );
}

/** Extend by a few days, close, or edit on the site. */
function OwnerActions({ request }: { request: PlayerRequest }) {
  const t = useTranslations("Requests");
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number>(7);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: (input: Parameters<typeof changeRequest>[1]) =>
      changeRequest(request.id, input),
    onSuccess: () => {
      setConfirming(false);
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: requestDetailKey(request.id),
      });
      void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
      void queryClient.invalidateQueries({ queryKey: REQUEST_BOARD_KEY });
    },
    onError: (cause) => {
      const code = requestErrorCode(cause);
      setError(code ? t(`errors.${code}`) : t("errors.generic"));
    },
  });

  if (request.status === "CLOSED") return null;
  // An expired request is still open underneath: extending it brings it back.
  const extendable = request.status !== "FILLED";

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void openOnSite(`${requestPath(request.id)}/edit`)}
      >
        {t("owner.edit")}
      </Button>
      {extendable ? (
        <span className="flex items-center gap-1.5">
          <Select
            aria-label={t("owner.extendBy")}
            value={days}
            className="h-8 w-auto py-0 text-xs"
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {REQUEST_EXPIRY_DAYS.map((count) => (
              <option key={count} value={count}>
                {t("form.days", { count })}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={change.isPending}
            onClick={() => change.mutate({ action: "extend", days })}
          >
            {t("owner.extend")}
          </Button>
        </span>
      ) : null}
      {confirming ? (
          <span className="flex items-center gap-1.5 text-xs text-nexus-muted">
            {t("owner.closeConfirm")}
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={change.isPending}
              onClick={() => change.mutate({ action: "close" })}
            >
              {t("owner.closeYes")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              {t("cancel")}
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(true)}
          >
            {t("owner.close")}
          </Button>
        )}
      {error ? <p className="w-full text-[13px] text-red-300">{error}</p> : null}
    </>
  );
}
