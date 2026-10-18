import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Compass,
  ExternalLink,
  MapPinned,
  Pencil,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { ShareModal } from "@/components/share-modal";
import { leaveShare } from "@/lib/api/shares";
import { useFormatter, useTranslations } from "use-intl";
import { markersChanged, useMarkersSync } from "@/hooks/use-markers-sync";
import { translator } from "@/i18n/translate";
import {
  deleteMarker,
  listMarkers,
  markerErrorMessage,
  updateMarker,
} from "@/lib/api/markers";
import { getNpsData } from "@/lib/api/nps";
import { openMarkForm, withDistances } from "@/lib/markers";
import {
  bodyAt,
  systemsOf,
  formatDistance,
  inSystem,
  MAX_TRAVEL_AGE_MS,
  type Fix,
} from "@/lib/nps";
import { withChosenSystem } from "@/lib/nps-system";
import { useSystemChoice } from "@/hooks/use-system-choice";
import { readNpsDestination, setDestination } from "@/lib/nps-destination";
import { notify } from "@/lib/notifications";
import { getApiBaseUrl, getNpsSystem } from "@/lib/settings";
import { showOverlay } from "@/lib/windows";
import { PrivatePlaceBadge } from "@/components/place/private-places";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SearchField,
  Select,
  Toolbar,
} from "@/components/ui";
import {
  DEFAULT_MARKER_COLOR,
  MARKER_KINDS,
  MAX_MARKER_NAME_LENGTH,
  MAX_MARKER_NOTE_LENGTH,
  type Marker,
  type MarkerCollection,
  type MarkerKind,
} from "@/types/markers";

/** Les relevés du NPS, que Rust envoie à toutes les fenêtres (`nps.rs`). */
const POSITION_EVENT = "nps://position";

/** « Tous », « Sans collection », ou une collection par son id. */
type CollectionFilter = "all" | "none" | string;

/**
 * Les marqueurs du joueur et ceux des collections partagées avec ses
 * organisations : des points relevés en jeu pour y revenir. Les plus proches
 * d'abord quand le NPS a donné une position ces dernières minutes, sinon les
 * plus récents ; « Guider » les envoie au NPS.
 *
 * Marquer sa position se fait dans la superposition du NPS, qui a le relevé.
 * Les collections — les créer, les renommer, les partager — se gèrent sur le
 * site.
 */
export default function MarkersPage() {
  const t = useTranslations("Markers");
  const format = useFormatter();
  const queryClient = useQueryClient();
  // Ouverte depuis une invitation : `?collection=<id>`.
  const [searchParams] = useSearchParams();
  const [collection, setCollection] = useState<CollectionFilter>(
    () => searchParams.get("collection") ?? "all",
  );
  const [sharing, setSharing] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Marker | null>(null);
  const [deleting, setDeleting] = useState<Marker | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [storedSystem, setStoredSystem] = useState<string | null>(null);
  // Le système choisi à la main dans le NPS l'emporte sur les relevés.
  const [chosenSystem] = useSystemChoice();
  useMarkersSync();

  const list = useQuery({
    queryKey: ["markers"],
    queryFn: () => listMarkers(),
  });
  // Les corps, pour situer un marqueur posé sur une planète qui tourne.
  const nps = useQuery({
    queryKey: ["nps"],
    queryFn: getNpsData,
    staleTime: 5 * 60 * 1000,
  });
  const bodies = useMemo(() => nps.data?.bodies ?? [], [nps.data]);

  // Les relevés arrivent tant que la superposition du NPS est affichée.
  useEffect(() => {
    const pending = listen<Fix>(POSITION_EVENT, (event) =>
      setFix(event.payload),
    );
    return () => {
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getNpsSystem()
      .then((slug) => {
        if (alive) setStoredSystem(slug);
      })
      .catch((error) => console.error("cannot read the NPS system", error));
    return () => {
      alive = false;
    };
  }, []);

  // Un relevé de plus de dix minutes ne dit plus où l'on est.
  const fresh = fix && Date.now() - fix.at <= MAX_TRAVEL_AGE_MS ? fix : null;
  const recent = fresh
    ? withChosenSystem(fresh, nps.data ? systemsOf(nps.data) : [], chosenSystem)
    : null;
  const body = recent ? bodyAt(recent, bodies) : null;
  const system =
    chosenSystem ?? recent?.system ?? body?.systemSlug ?? storedSystem;

  const markers = useMemo(() => list.data?.markers ?? [], [list.data]);
  const collections = useMemo(() => list.data?.collections ?? [], [list.data]);
  const loose = markers.filter((marker) => !marker.collectionId).length;

  const needle = search.trim().toLowerCase();
  const shown = withDistances(
    markers.filter(
      (marker) =>
        (collection === "all" ||
          (collection === "none"
            ? !marker.collectionId
            : marker.collectionId === collection)) &&
        (!needle ||
          [marker.name, marker.note].some((text) =>
            text?.toLowerCase().includes(needle),
          )),
    ),
    recent,
    bodies,
    system,
  );

  function guide(marker: Marker) {
    void setDestination({
      marker: {
        id: marker.id,
        name: marker.name,
        systemSlug: marker.systemSlug,
        position: marker.position,
      },
    })
      .then(() => showOverlay("nps"))
      .catch((error) => console.error("cannot guide to the marker", error));
  }

  async function openSite() {
    try {
      await openUrl(`${await getApiBaseUrl()}/marqueurs`);
    } catch (error) {
      console.error("Ouverture des marqueurs sur le site impossible", error);
      await notify({
        kind: "error",
        title: translator("Markers")("openFailed"),
      });
    }
  }

  function refresh() {
    markersChanged(queryClient);
  }

  const current = collections.find((one) => one.id === collection);

  async function leave(id: string) {
    try {
      await leaveShare("markerCollection", id);
      setCollection("all");
      refresh();
    } catch (error) {
      console.error("cannot leave the marker collection", error);
      await notify({ kind: "error", title: t("leaveFailed") });
    }
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void openSite()}>
              <ExternalLink className="h-3.5 w-3.5" />
              {t("manage")}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void openMarkForm().catch((error) =>
                  console.error("cannot open the NPS overlay", error),
                )
              }
              style={{
                backgroundColor: DEFAULT_MARKER_COLOR,
                borderColor: DEFAULT_MARKER_COLOR,
              }}
            >
              <MapPinned className="h-3.5 w-3.5" />
              {t("mark")}
            </Button>
          </>
        }
      />

      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : markers.length === 0 ? (
        <EmptyState
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Chip
              active={collection === "all"}
              onClick={() => setCollection("all")}
            >
              {t("all")} <Count value={markers.length} />
            </Chip>
            {collections.map((one) => (
              <CollectionChip
                key={one.id}
                collection={one}
                active={collection === one.id}
                onClick={() => setCollection(one.id)}
              />
            ))}
            <Chip
              active={collection === "none"}
              onClick={() => setCollection("none")}
              className="inline-flex items-center gap-1.5"
            >
              <Dot color={DEFAULT_MARKER_COLOR} />
              {t("noCollection")} <Count value={loose} />
            </Chip>
            {current?.isOwner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSharing(true)}
              >
                <Share2 className="h-3.5 w-3.5" />
                {current.guestCount
                  ? `${t("share")} · ${t("guests", { count: current.guestCount })}`
                  : t("share")}
              </Button>
            )}
            {current?.sharedWithMe && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void leave(current.id)}
              >
                <X className="h-3.5 w-3.5" />
                {t("leave")}
              </Button>
            )}
          </div>
          {current?.isOwner && (
            <ShareModal
              kind="markerCollection"
              id={current.id}
              open={sharing}
              onClose={() => {
                setSharing(false);
                refresh();
              }}
            />
          )}

          <Toolbar>
            <SearchField
              label={t("searchLabel")}
              value={search}
              placeholder={t("searchPlaceholder")}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Toolbar>

          <p className="mb-2 text-xs text-nexus-dim">
            {recent
              ? t("sortedByDistance", {
                  where: body?.name ?? t("space"),
                })
              : t("sortedByDate")}
          </p>

          {shown.length === 0 ? (
            <EmptyState title={t("noResults")} />
          ) : (
            <ul className="divide-y divide-nexus-accent/8 overflow-hidden rounded-xl border border-nexus-accent/12 bg-nexus-card/60">
              {shown.map(({ marker, distance }) => (
                <MarkerRow
                  key={marker.id}
                  marker={marker}
                  distance={
                    distance !== null ? formatDistance(distance, format) : null
                  }
                  reachable={inSystem(marker, system)}
                  onGuide={() => guide(marker)}
                  onEdit={() => setEditing(marker)}
                  onDelete={() => setDeleting(marker)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {editing ? (
        <EditMarkerModal
          marker={editing}
          collections={collections.filter((one) => one.isOwner)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteMarkerModal
          marker={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function Count({ value }: { value: number }) {
  return <span className="font-mono text-[11px] opacity-70">{value}</span>;
}

function CollectionChip({
  collection,
  active,
  onClick,
}: {
  collection: MarkerCollection;
  active: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("Markers");
  return (
    <Chip
      active={active}
      onClick={onClick}
      className="inline-flex items-center gap-1.5"
      title={
        collection.org
          ? t("sharedWith", { org: collection.org.name })
          : collection.sharedWithMe
            ? t("sharedByPlayer", { owner: collection.ownerName ?? "?" })
            : collection.guestCount
              ? t("guests", { count: collection.guestCount })
              : undefined
      }
    >
      <Dot color={collection.color} />
      {collection.name} <Count value={collection.count} />
    </Chip>
  );
}

function MarkerRow({
  marker,
  distance,
  reachable,
  onGuide,
  onEdit,
  onDelete,
}: {
  marker: Marker;
  /** Formatée ; `null` quand on ne sait pas où est le joueur. */
  distance: string | null;
  /** Dans le système du joueur, ou on ne sait pas. */
  reachable: boolean;
  onGuide: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Markers");
  const format = useFormatter();
  const where =
    marker.bodyName ??
    (marker.systemName
      ? t("inSpace", { system: marker.systemName })
      : undefined);

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <MapPinned
        className="size-5 shrink-0"
        style={{ color: marker.color }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-nexus-white">
          {marker.name}
        </span>
        <span className="block truncate text-xs text-nexus-dim">
          {[
            t(`kinds.${marker.kind}`),
            where,
            marker.note,
            marker.isOwner ? undefined : marker.ownerName,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {marker.org ? <PrivatePlaceBadge place={{ org: marker.org }} /> : null}
      <span className="flex shrink-0 flex-col items-end text-xs">
        {distance ? (
          <span className="font-mono text-nexus-bright">{distance}</span>
        ) : !reachable && marker.systemName ? (
          <span className="text-nexus-muted">{marker.systemName}</span>
        ) : null}
        <span className="text-nexus-dim">
          {format.relativeTime(new Date(marker.createdAt), new Date())}
        </span>
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onGuide}
        disabled={!reachable}
        title={
          reachable
            ? undefined
            : t("otherSystem", { system: marker.systemName ?? "?" })
        }
      >
        <Compass className="h-3.5 w-3.5" />
        {t("guide")}
      </Button>
      {marker.isOwner ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={t("edit")}
            title={t("edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={t("delete")}
            title={t("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : null}
    </li>
  );
}

/**
 * Nom, catégorie, collection et note ; la position ne se corrige que sur le
 * site.
 */
function EditMarkerModal({
  marker,
  collections,
  onClose,
  onSaved,
}: {
  marker: Marker;
  /** Les collections du joueur : on ne range rien dans celle d'un autre. */
  collections: MarkerCollection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Markers");
  const [name, setName] = useState(marker.name);
  const [kind, setKind] = useState<MarkerKind>(marker.kind);
  const [collectionId, setCollectionId] = useState(marker.collectionId ?? "");
  const [note, setNote] = useState(marker.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("form.nameMissing"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateMarker(marker.id, {
        name: name.trim(),
        kind,
        collectionId: collectionId || null,
        note: note.trim() || null,
      });
      onSaved();
    } catch (cause) {
      setError(markerErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={t("form.title")}
      icon={<MapPinned className="size-5" style={{ color: marker.color }} />}
      onClose={onClose}
      footer={
        <>
          {error ? (
            <p className="mr-auto text-xs text-red-300">{error}</p>
          ) : (
            <span className="mr-auto" />
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button size="sm" type="submit" form="marker-form" disabled={saving}>
            {saving ? "…" : t("form.save")}
          </Button>
        </>
      }
    >
      <form id="marker-form" onSubmit={save} className="space-y-4">
        <Field label={t("form.name")}>
          <Input
            autoFocus
            value={name}
            maxLength={MAX_MARKER_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.kind")}>
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value as MarkerKind)}
            >
              {MARKER_KINDS.map((one) => (
                <option key={one} value={one}>
                  {t(`kinds.${one}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("form.collection")}>
            <Select
              value={collectionId}
              onChange={(event) => setCollectionId(event.target.value)}
            >
              <option value="">{t("noCollection")}</option>
              {collections.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("form.note")}>
          <textarea
            value={note}
            rows={3}
            maxLength={MAX_MARKER_NOTE_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            className="w-full resize-y rounded-lg border border-nexus-accent/15 bg-nexus-card px-3 py-2 text-[13.5px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
          />
        </Field>
      </form>
    </Modal>
  );
}

function DeleteMarkerModal({
  marker,
  onClose,
  onDeleted,
}: {
  marker: Marker;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("Markers");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await deleteMarker(marker.id);
      // Le NPS n'a plus à y guider.
      const destination = await readNpsDestination().catch(() => null);
      if (
        destination &&
        "marker" in destination &&
        destination.marker.id === marker.id
      ) {
        await setDestination(null);
      }
      onDeleted();
    } catch (cause) {
      setError(markerErrorMessage(cause));
      setDeleting(false);
    }
  }

  return (
    <Modal
      open
      title={t("deleteTitle", { name: marker.name })}
      description={t("deleteDescription")}
      icon={<Trash2 className="size-5" />}
      onClose={onClose}
      footer={
        <>
          {error ? (
            <p className="mr-auto text-xs text-red-300">{error}</p>
          ) : (
            <span className="mr-auto" />
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={deleting}
            onClick={() => void confirm()}
          >
            {deleting ? "…" : t("delete")}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-nexus-muted">
        {[t(`kinds.${marker.kind}`), marker.bodyName ?? marker.systemName]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Modal>
  );
}
