import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Compass, ExternalLink, Lock, Pencil, Share2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ShareModal } from "@/components/share-modal";
import { getApiBaseUrl } from "@/lib/settings";
import { BackLink } from "@/components/layout/back-link";
import { PlaceTypeBadge } from "@/components/place-card";
import {
  PRIVATE_ACCENT,
  PrivatePlaceBadge,
  guideTo,
} from "@/components/place/private-places";
import { Button, Card, PageHeader, SectionTitle } from "@/components/ui";
import type { PrivatePlace } from "@/types/nexus";

/**
 * La fiche d'un lieu privé : ce que le site en montre, en lecture. Le
 * modifier, le partager ou le proposer au public se fait sur le site.
 */
export function PrivatePlaceDetail({ place }: { place: PrivatePlace }) {
  const t = useTranslations("Places");
  const queryClient = useQueryClient();
  const [sharing, setSharing] = useState(false);

  async function openOnWeb(path = "") {
    const baseUrl = await getApiBaseUrl();
    await openUrl(`${baseUrl}/lieux/${encodeURIComponent(place.slug)}${path}`);
  }

  return (
    <>
      <BackLink to="/places">{t("detail.back")}</BackLink>

      {place.isOwner ? (
        <ShareModal
          kind="place"
          id={place.slug}
          open={sharing}
          onClose={() => {
            setSharing(false);
            // Le nombre d'invités de l'en-tête suit.
            void queryClient.invalidateQueries({ queryKey: ["private-places"] });
            void queryClient.invalidateQueries({ queryKey: ["private-place"] });
          }}
        />
      ) : null}

      <PageHeader
        title={place.name}
        description={
          place.sharedWithMe && !place.org
            ? t("private.sharedWithYou", { name: place.ownerName ?? "?" })
            : place.org
              ? t("private.visibleWithOrg", { org: place.org.name })
              : place.guestCount
                ? t("private.visibleOwnGuests", { count: place.guestCount })
                : t("private.visibleOwn")
        }
        actions={
          <>
            {place.position ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => guideTo(place.slug)}
              >
                <Compass className="h-3.5 w-3.5" />
                {t("detail.guide")}
              </Button>
            ) : null}
            {place.isOwner ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSharing(true)}
              >
                <Share2 className="h-3.5 w-3.5" />
                {t("private.share")}
              </Button>
            ) : null}
            {place.isOwner ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openOnWeb("/modifier")}
              >
                <Pencil className="h-3.5 w-3.5" />
                {t("private.edit")}
              </Button>
            ) : null}
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
        <span
          className="flex items-center gap-1"
          style={{ color: PRIVATE_ACCENT }}
        >
          <Lock className="size-3" />
          {place.name}
        </span>
      </nav>

      {place.proposal?.status === "pending" ? (
        <p
          className="mb-4 rounded-lg border px-3 py-2 text-xs"
          style={{
            color: PRIVATE_ACCENT,
            borderColor: `${PRIVATE_ACCENT}40`,
            backgroundColor: `${PRIVATE_ACCENT}0f`,
          }}
        >
          {t("private.inReview")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Image place={place} />
          <Card className="p-5">
            <SectionTitle>{t("private.notes")}</SectionTitle>
            {place.description ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-nexus-muted">
                {place.description}
              </p>
            ) : (
              <p className="text-xs text-nexus-dim">{t("private.noNotes")}</p>
            )}
          </Card>
        </div>

        <Card className="h-fit p-5">
          <SectionTitle>{t("detail.sheet")}</SectionTitle>
          <dl className="divide-y divide-nexus-accent/8 text-sm">
            <Row label={t("detail.type")}>
              <PlaceTypeBadge type={place.type} />
            </Row>
            <Row label={t("private.visibility")}>
              <PrivatePlaceBadge place={place} />
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
            {!place.isOwner && place.ownerName ? (
              <Row label={t("private.createdBy")}>{place.ownerName}</Row>
            ) : null}
            <Row label={t("private.position")}>
              {place.position ? t("private.positionKnown") : "—"}
            </Row>
          </dl>
        </Card>
      </div>
    </>
  );
}

function Image({ place }: { place: PrivatePlace }) {
  const [failed, setFailed] = useState(false);
  const url = place.image?.url ?? place.imageUrl;
  if (!url || failed) return null;
  return (
    <Card className="overflow-hidden">
      <img
        src={url}
        alt={place.name}
        onError={() => setFailed(true)}
        className="max-h-80 w-full object-cover"
      />
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
