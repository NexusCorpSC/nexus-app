import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { BackLink } from "@/components/layout/back-link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Map as MapIcon, Pin } from "lucide-react";
import { getPlace } from "@/lib/api/places";
import {
  onPinnedMapChange,
  pinMap,
  readPinnedMap,
  showMapOverlay,
} from "@/lib/pinned-map";
import { getApiBaseUrl } from "@/lib/settings";
import { MapLegend, MapView } from "@/components/place/map-view";
import { PlaceCard, PlaceTypeBadge } from "@/components/place-card";
import { type PlaceDetails, type PlacePlan } from "@/types/nexus";
import { ReportButton } from "@/components/report-button";
import { AddMediaButton } from "@/components/place/add-media-button";
import { useAuth } from "@/auth/auth-context";
import {
  Button,
  Card,
  Chip,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionTitle,
} from "@/components/ui";

/**
 * Un lieu, comme sa fiche le montre sur le site : d'où il vient, ce qu'on y
 * trouve, ce qu'il contient, et ses cartes.
 *
 * Le site parle de « plans » ; ici c'est « carte », parce que « plan » désigne
 * déjà le plan de vol d'une escouade. Voir `PlacePlan` dans `types/nexus.ts`.
 */
export default function PlaceDetailPage() {
  const t = useTranslations("Places");
  const { slug = "" } = useParams();
  const { user } = useAuth();

  const placeQuery = useQuery({
    queryKey: ["place", slug],
    queryFn: () => getPlace(slug),
    enabled: Boolean(slug),
  });

  async function openOnWeb() {
    const baseUrl = await getApiBaseUrl();
    await openUrl(`${baseUrl}/lieux/${encodeURIComponent(slug)}`);
  }

  if (placeQuery.isPending) return <LoadingState />;

  if (placeQuery.isError) {
    return (
      <>
        <BackLink to="/places">{t("detail.back")}</BackLink>
        <ErrorState
          error={placeQuery.error}
          onRetry={() => void placeQuery.refetch()}
        />
      </>
    );
  }

  const place = placeQuery.data;
  const services = place.services ?? [];
  const plans = place.plans ?? [];

  return (
    <>
      <BackLink to="/places">{t("detail.back")}</BackLink>

      <PageHeader
        title={place.name}
        description={place.shopCategory}
        actions={
          <>
            {user ? <AddMediaButton place={place} /> : null}
            <ReportButton type="place" id={place.slug} name={place.name} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openOnWeb()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("detail.openOnWeb")}
            </Button>
          </>
        }
      />

      <Trail place={place} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <HeroImage place={place} />

          {place.description ? (
            <Section title={t("detail.description")}>
              <p className="whitespace-pre-line text-sm leading-relaxed text-nexus-muted">
                {place.description}
              </p>
            </Section>
          ) : null}

          <MapsSection place={place} plans={plans} />

          {place.children.length > 0 ? (
            <Section
              title={t("detail.contents")}
              aside={`${place.children.length}`}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {place.children.map((child) => (
                  <PlaceCard key={child.id} place={child} layout="row" />
                ))}
              </div>
            </Section>
          ) : null}

          {place.shops.length > 0 ? (
            <Section title={t("detail.shops")} aside={`${place.shops.length}`}>
              {/* Tout le sous-arbre, pas seulement les enfants directs : les
                  magasins de Lorville se tiennent dans ses quartiers. */}
              <div className="grid gap-2 sm:grid-cols-2">
                {place.shops.map((shop) => (
                  <PlaceCard key={shop.id} place={shop} layout="row" />
                ))}
              </div>
            </Section>
          ) : null}
        </div>

        <div className="space-y-4">
          <Section title={t("detail.sheet")}>
            <dl className="divide-y divide-nexus-accent/8 text-sm">
              <Row label={t("detail.type")}>
                <PlaceTypeBadge type={place.type} />
              </Row>
              {place.systemName ? (
                <Row label={t("detail.system")}>{place.systemName}</Row>
              ) : null}
              {place.bodyName ? (
                <Row label={t("detail.body")}>{place.bodyName}</Row>
              ) : null}
              {place.parentName ? (
                <Row label={t("detail.inside")}>{place.parentName}</Row>
              ) : null}
            </dl>
          </Section>

          <Section title={t("detail.services")} aside={services.length ? undefined : "—"}>
            {services.length === 0 ? (
              <p className="text-xs text-nexus-dim">
                {t("detail.noServices")}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {services.map((service) => (
                  <li
                    key={service}
                    className="rounded-full bg-nexus-accent/10 px-2.5 py-1 text-xs text-nexus-bright"
                  >
                    {t(`services.${service}`)}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

/** « Stanton › Hurston › Lorville », chaque étape cliquable. */
function Trail({ place }: { place: PlaceDetails }) {
  if (place.ancestors.length === 0) return null;

  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-xs text-nexus-dim">
      {place.ancestors.map((ancestor) => (
        <span key={ancestor.slug} className="flex items-center gap-1">
          <Link
            to={`/places/${ancestor.slug}`}
            className="transition-colors hover:text-nexus-accent"
          >
            {ancestor.name}
          </Link>
          <span aria-hidden>›</span>
        </span>
      ))}
      <span className="text-nexus-muted">{place.name}</span>
    </nav>
  );
}

function HeroImage({ place }: { place: PlaceDetails }) {
  const [failed, setFailed] = useState(false);
  if (!place.imageUrl || failed) return null;

  return (
    <Card className="overflow-hidden">
      <img
        src={place.imageUrl}
        alt={place.name}
        onError={() => setFailed(true)}
        className="max-h-80 w-full object-cover"
      />
    </Card>
  );
}

/**
 * Les cartes du lieu, et le bouton qui en envoie une dans l'overlay.
 *
 * Épingler ne se fait pas depuis l'overlay seul : taper une recherche
 * par-dessus le jeu est pénible, et la fenêtre verrouillée ne prend pas la
 * souris. On choisit ici, au calme, et l'overlay suit.
 */
function MapsSection({
  place,
  plans,
}: {
  place: PlaceDetails;
  plans: PlacePlan[];
}) {
  const t = useTranslations("Places");
  const [activeId, setActiveId] = useState<string | null>(plans[0]?.id ?? null);
  const [pinned, setPinned] = useState<string | null>(null);

  // Lu puis suivi : l'overlay a son propre sélecteur, et une épingle posée
  // là-bas laisserait sinon ce bouton annoncer le contraire de la vérité.
  useEffect(() => {
    let alive = true;

    function refresh() {
      void readPinnedMap().then((slug) => {
        if (alive) setPinned(slug);
      });
    }

    refresh();
    const pending = onPinnedMapChange(refresh);

    return () => {
      alive = false;
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  if (plans.length === 0) {
    return (
      <Section title={t("detail.maps")}>
        <p className="text-xs text-nexus-dim">{t("detail.notSurveyed")}</p>
      </Section>
    );
  }

  const active = plans.find((plan) => plan.id === activeId) ?? plans[0];
  const isPinned = pinned === place.slug;

  return (
    <Section
      title={t("detail.maps")}
      aside={plans.length > 1 ? `${plans.length}` : undefined}
    >
      {plans.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {plans.map((plan) => (
            <Chip
              key={plan.id}
              active={plan.id === active.id}
              onClick={() => setActiveId(plan.id)}
            >
              {plan.name}
            </Chip>
          ))}
        </div>
      ) : null}

      <MapView
        plan={active}
        targets={place.planTargets}
        className="h-[420px]"
      />

      {active.borrowedFrom ? (
        <p className="mt-2 text-xs text-nexus-dim">
          {t("detail.borrowed", { name: active.borrowedFrom.name })}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const next = isPinned ? null : place.slug;
            setPinned(next);
            void pinMap(next);
            // Épingler affiche : c'est ce que le bouton annonce. Dépingler ne
            // referme pas la fenêtre — elle dira simplement qu'elle n'a plus
            // rien à montrer, et c'est à son occupant de la fermer.
            if (next) void showMapOverlay();
          }}
        >
          {isPinned ? (
            <>
              <Pin className="h-3.5 w-3.5" />
              {t("detail.unpin")}
            </>
          ) : (
            <>
              <MapIcon className="h-3.5 w-3.5" />
              {t("detail.pin")}
            </>
          )}
        </Button>
      </div>

      <div className="mt-3 border-t border-nexus-accent/8 pt-3">
        <MapLegend plan={active} targets={place.planTargets} />
      </div>
    </Section>
  );
}

function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <SectionTitle aside={aside}>{title}</SectionTitle>
      {children}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="text-xs text-nexus-dim">{label}</dt>
      <dd className="text-right text-nexus-white">{children}</dd>
    </div>
  );
}
