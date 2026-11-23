import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Plus } from "lucide-react";
import { useTranslations } from "use-intl";
import { useAuth } from "@/auth/auth-context";
import { OfferModal } from "@/components/requests/offer-modal";
import { PublishModal } from "@/components/requests/publish-modal";
import { RequestCard } from "@/components/requests/request-card";
import { OfferStatusTag } from "@/components/requests/request-ui";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchField,
  Segmented,
  Toolbar,
  ToolbarToggle,
} from "@/components/ui";
import { useDebounced } from "@/hooks/use-debounced";
import { oneOf, useInitialParams, useUrlFilters } from "@/hooks/use-url-filters";
import {
  getMyRequests,
  getRequestAlerts,
  listRequestBoard,
  markRequestNoticesSeen,
  setRequestAlertsOff,
  type BoardFilters,
} from "@/lib/api/requests";
import { openOnSite } from "@/lib/org-events";
import { REQUEST_BOARD_KEY, requestRoute, REQUESTS_KEY } from "@/lib/requests";
import { formatAgo, formatNumber } from "@/lib/utils";
import {
  ACTIVE_OFFER_STATUSES,
  quantityLabel,
  REQUEST_KIND_FILTERS,
  type PlayerRequest,
} from "@/types/requests";

const VIEWS = ["board", "mine", "offers"] as const;
type View = (typeof VIEWS)[number];
const AUDIENCES = ["", "friends", "orgs", "public"] as const;
const KINDS = ["", ...REQUEST_KIND_FILTERS] as const;

/**
 * The request board: what friends, organizations and the community are
 * looking for, the reader's own requests, and the offers they made. As on
 * the site, «J'en ai» opens an offer, and each offer has its private thread.
 */
export default function RequestsPage() {
  const t = useTranslations("Requests");
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const initial = useInitialParams();

  const [view, setView] = useState<View>(() =>
    oneOf(initial, "view", VIEWS, "board"),
  );
  const [search, setSearch] = useState(initial.get("q") ?? "");
  const [aud, setAud] = useState(() => oneOf(initial, "aud", AUDIENCES, ""));
  const [kind, setKind] = useState(() => oneOf(initial, "kind", KINDS, ""));
  const [supply, setSupply] = useState(initial.get("supply") === "1");
  const q = useDebounced(search.trim(), 300);
  useUrlFilters({
    view: view === "board" ? null : view,
    q,
    aud,
    kind,
    supply: supply ? "1" : null,
  });

  const [publishing, setPublishing] = useState(false);
  const [offering, setOffering] = useState<PlayerRequest | null>(null);

  const filters: BoardFilters = {
    q: q || undefined,
    aud: aud || undefined,
    kind: kind || undefined,
    supply,
  };
  const board = useQuery({
    queryKey: [...REQUEST_BOARD_KEY, filters],
    queryFn: () => listRequestBoard(filters),
    enabled: Boolean(user),
    placeholderData: (previous) => previous,
  });
  const mine = useQuery({
    queryKey: [...REQUESTS_KEY, user?.id],
    queryFn: () => getMyRequests(),
    enabled: Boolean(user),
  });
  const alerts = useQuery({
    queryKey: ["request-alerts"],
    queryFn: getRequestAlerts,
    enabled: Boolean(user),
  });
  const toggleAlerts = useMutation({
    mutationFn: (on: boolean) => setRequestAlertsOff(!on),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["request-alerts"] }),
  });

  // Opening the board reads the news: the site's bell goes quiet too.
  const unseen = alerts.data?.unseen ?? 0;
  useEffect(() => {
    if (unseen > 0) void markRequestNoticesSeen().catch(() => undefined);
  }, [unseen]);

  const myRequests = mine.data?.requests ?? [];
  const myOffers = mine.data?.offers ?? [];
  const openMine = myRequests.filter((r) => r.status === "OPEN").length;
  const activeOffers = myOffers.filter((o) =>
    ACTIVE_OFFER_STATUSES.includes(o.status),
  ).length;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void openOnSite("/demandes")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("onSite")}
            </Button>
            <Button type="button" size="sm" onClick={() => setPublishing(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t("publish")}
            </Button>
          </>
        }
      />

      <Toolbar>
        <Segmented
          label={t("tabs.label")}
          value={view}
          onChange={setView}
          options={[
            { value: "board", label: t("tabs.board") },
            {
              value: "mine",
              label: openMine
                ? `${t("tabs.mine")} · ${openMine}`
                : t("tabs.mine"),
            },
            {
              value: "offers",
              label: activeOffers
                ? `${t("tabs.offers")} · ${activeOffers}`
                : t("tabs.offers"),
            },
          ]}
        />
        {alerts.data ? (
          <ToolbarToggle
            label={t("alerts")}
            checked={!alerts.data.alertsOff}
            onChange={(on) => toggleAlerts.mutate(on)}
          />
        ) : null}
      </Toolbar>

      {view === "board" ? (
        <>
          <Toolbar>
            <SearchField
              label={t("filters.search")}
              placeholder={t("filters.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <ToolbarToggle
              label={t("filters.supply")}
              checked={supply}
              onChange={setSupply}
            />
          </Toolbar>
          <div className="mb-5 flex flex-wrap gap-2">
            {AUDIENCES.map((entry) => (
              <Chip
                key={entry || "all"}
                active={aud === entry}
                onClick={() => setAud(entry)}
              >
                {entry ? t(`filters.audience.${entry}`) : t("filters.all")}
              </Chip>
            ))}
            <span className="mx-1 w-px bg-nexus-accent/15" />
            {REQUEST_KIND_FILTERS.map((entry) => (
              <Chip
                key={entry}
                active={kind === entry}
                onClick={() => setKind(kind === entry ? "" : entry)}
              >
                {t(`filters.kind.${entry}`)}
              </Chip>
            ))}
          </div>

          {board.isPending ? (
            <LoadingState />
          ) : board.isError ? (
            <ErrorState
              error={board.error}
              onRetry={() => void board.refetch()}
            />
          ) : board.data.requests.length === 0 ? (
            <EmptyState
              title={t("emptyBoard")}
              description={t("tradeInGame")}
            />
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                {board.data.requests.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    onOffer={setOffering}
                  />
                ))}
              </div>
              {board.data.total > board.data.requests.length ? (
                <p className="mt-3 text-xs text-nexus-muted">
                  {t("moreResults", {
                    shown: board.data.requests.length,
                    total: board.data.total,
                  })}
                </p>
              ) : null}
            </>
          )}
        </>
      ) : mine.isPending ? (
        <LoadingState />
      ) : mine.isError ? (
        <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />
      ) : view === "mine" ? (
        myRequests.length === 0 ? (
          <EmptyState
            title={t("emptyMine")}
            description={t("tradeInGame")}
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {myRequests.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </div>
        )
      ) : myOffers.length === 0 ? (
        <EmptyState title={t("emptyOffers")} description={t("tradeInGame")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {myOffers.map((offer) => (
            <li key={offer.id}>
              <button
                type="button"
                onClick={() =>
                  navigate(requestRoute(offer.requestId, offer.id))
                }
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 rounded-nexus-sm border border-nexus-accent/15 px-3 py-2.5 text-left text-[13px] hover:border-nexus-accent/40"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-nexus-bright">
                    {offer.request.name}
                  </div>
                  <div className="truncate text-xs text-nexus-muted">
                    {[
                      t("offers.to", { name: offer.request.userName }),
                      formatAgo(offer.updatedAt),
                    ].join(" · ")}
                  </div>
                </div>
                <span className="font-mono text-xs text-nexus-bright tabular-nums">
                  {quantityLabel(offer.quantity, offer.request.unit)}
                  {offer.quality !== undefined ? ` · Q ${offer.quality}` : ""}
                  {offer.unitPrice !== undefined
                    ? ` · ${formatNumber(offer.unitPrice)} aUEC`
                    : ""}
                </span>
                <OfferStatusTag status={offer.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <PublishModal
        open={publishing}
        onClose={() => setPublishing(false)}
        orgs={board.data?.orgs ?? []}
        onPublished={(request) => navigate(requestRoute(request.id))}
      />
      {offering ? (
        <OfferModal
          request={offering}
          open
          onClose={() => setOffering(null)}
          onSent={(offer) =>
            navigate(requestRoute(offer.requestId, offer.id))
          }
        />
      ) : null}
    </>
  );
}
