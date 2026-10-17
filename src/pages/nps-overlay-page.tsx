import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Compass,
  Crosshair,
  Keyboard,
  Lock,
  MapPinned,
  MapPinPlus,
  Navigation,
  Radar,
  Search,
  ScanText,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

import { AHEAD_DEGREES, NpsCompass } from "@/components/nps-compass";
import { OverlayLockButton } from "@/components/overlay-lock-button";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { useDebounced } from "@/hooks/use-debounced";
import { useOverlayLocked } from "@/hooks/use-overlay-lock";
import { useOverlayMode } from "@/hooks/use-overlay-opacity";
import { markersChanged, useMarkersSync } from "@/hooks/use-markers-sync";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import {
  usePlayersInGame,
  usePositionReporting,
  usePositionSharing,
} from "@/hooks/use-position-sharing";
import {
  PLAYER_COLOR,
  PlayerAvatar,
  ShareCard,
  SharePanel,
  Tag,
} from "@/components/nps-position-sharing";
import { translator } from "@/i18n/translate";
import {
  getNpsData,
  positionErrorMessage,
  submitPlacePosition,
} from "@/lib/api/nps";
import { listPlaces } from "@/lib/api/places";
import {
  createMarker,
  createMarkerCollection,
  deleteMarker,
  isNotFound,
  listMarkers,
  markerErrorMessage,
} from "@/lib/api/markers";
import {
  defaultMarkerName,
  isFresh,
  MARK_FORM_EVENT,
  MARKER_ARRIVAL_M,
  markerPositionOf,
  nextCollectionColor,
  whereOf,
  withDistances,
} from "@/lib/markers";
import { notify } from "@/lib/notifications";
import {
  bodyAt,
  compassPoint,
  formatDistance,
  fromGeo,
  geoOf,
  guide,
  inSystem,
  MIN_CLOSING_SPEED,
  nearestPlaces,
  MAX_TRAVEL_AGE_MS,
  looksLikeGameCoordinates,
  parseBodyCoordinates,
  parseGameCoordinates,
  parseNumber,
  positionOf,
  previousFor,
  systemOfZones,
  systemPositionOf,
  toBodyFrame,
  type Fix,
} from "@/lib/nps";
import {
  onDestinationChange,
  readNpsDestination,
  setDestination,
  type NpsDestination,
} from "@/lib/nps-destination";
import { overlaySkin } from "@/lib/overlay-opacity";
import {
  DEFAULT_MARKER_DEFAULTS,
  DEFAULT_NPS_SCREEN,
  getMarkerDefaults,
  getNpsScreen,
  getNpsSystem,
  setMarkerDefaults,
  setNpsScreen,
  setNpsSystem,
  type MarkerDefaults,
  type NpsScreenRegion,
  type NpsScreenSettings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { NpsBody, NpsPlace, PlacePosition } from "@/types/nexus";
import {
  DEFAULT_MARKER_COLOR,
  MARKER_KINDS,
  MAX_MARKER_COLLECTION_NAME_LENGTH,
  MAX_MARKER_NAME_LENGTH,
  MAX_MARKER_NOTE_LENGTH,
  type Marker,
  type MarkerListResponse,
} from "@/types/markers";
import {
  POSITION_STALE_MS,
  type PlayerInGame,
} from "@/types/player-positions";

/**
 * Carries a reading of `/showlocation`, from `src-tauri/src/nps.rs`, or one
 * read off the screen, from `src-tauri/src/nps_screen.rs`.
 */
const POSITION_EVENT = "nps://position";

/** How the reading off the screen goes, each time it changes. */
const SCREEN_STATUS_EVENT = "nps://screen-status";

/** The box drawn around the game's debug lines, and whether it read. */
const CALIBRATED_EVENT = "nps://calibrated";

/** Ten minutes of readings off the screen, at the shortest interval. */
const MAX_HISTORY = 1200;

/** The intervals offered for reading the screen, in milliseconds. */
const SCREEN_INTERVALS = [500, 1000, 2000, 5000];

type ScreenStatus =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "unreadable" }
  | { state: "failed"; message: string };

/** How often the age of the reading is redrawn. */
const TICK_MS = 1000;

/** Le raccourci « Marquer ma position » (`src-tauri/src/nps.rs`). */
const MARK_EVENT = "nps://mark";

/** Le bouton « Annuler » de la notification d'un marqueur créé au raccourci. */
const UNDO_MARK_EVENT = "markers://undo";

/**
 * Combien attendre un relevé neuf pour le raccourci : le suivi à l'écran en
 * donne un chaque seconde ou presque ; `/showlocation`, lui, attend que le
 * joueur le colle dans le chat du jeu.
 */
const SCREEN_WAIT_MS = 10_000;
const PASTE_WAIT_MS = 60_000;

type Panel =
  | "guide"
  | "destination"
  | "coordinates"
  | "record"
  | "mark"
  | "share";

/** What the overlay guides to: a recorded place, or a point typed in. */
type Target = {
  name: string;
  /** Typed in by hand, not a place of the catalogue. */
  manual: boolean;
  systemSlug?: string;
  systemName?: string;
  bodyName?: string;
  position: PlacePosition;
  /** Un marqueur : sa couleur, sa collection et sa note, et s'il est à soi. */
  marker?: { id: string; color: string; detail?: string; isOwner: boolean };
  /**
   * Un joueur en jeu : l'heure de son relevé, son activité, et s'il a cessé
   * de partager (on va alors à sa dernière position connue).
   */
  player?: {
    id: string;
    friend: boolean;
    at: number | null;
    activity: string | null;
    gone: boolean;
  };
};

/**
 * Le prochain relevé, d'où qu'il vienne, pris à partir de `after` ; `null`
 * passé `timeoutMs`.
 */
function nextReading(after: number, timeoutMs: number): Promise<Fix | null> {
  return new Promise((resolve) => {
    let done = false;
    let stop: (() => void) | null = null;
    const finish = (reading: Fix | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve(reading);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    void listen<Fix>(POSITION_EVENT, (event) => {
      if (event.payload.at >= after) finish(event.payload);
    })
      .then((unlisten) => {
        if (done) unlisten();
        else stop = unlisten;
      })
      .catch(() => finish(null));
  });
}

/**
 * The NPS — Nexus Positioning System — over the game.
 *
 * The game gives a position, never an orientation: `/showlocation` copies the
 * player's coordinates to the clipboard, and that is all. So the window says
 * how far the destination is and which bearing leads there, and — once two
 * readings are a few metres apart — how far to turn from the way one is
 * going. The button puts `/showlocation` on the clipboard; pasting it in the
 * chat is the player's part, and the answer is picked up on its own
 * (`src-tauri/src/nps.rs`). Typing the command by hand works just as well.
 *
 * Places have no position until players record one, from here, standing on
 * the spot: the position goes to the site as a contribution.
 *
 * Les marqueurs du joueur se posent d'ici aussi, au dernier relevé : par le
 * formulaire sous « Ma position », ou d'un coup par le raccourci, qui affiche
 * la fenêtre sans lui donner la main. On s'y fait guider comme vers un lieu.
 */
export default function NpsOverlayPage() {
  useTransparentWindow();
  const t = useTranslations("NpsOverlay");
  const format = useFormatter();

  const mode = useOverlayMode("nps");
  const locked = useOverlayLocked("nps");

  // The readings of the last minutes, oldest first: the latest says where one
  // is, an earlier one far enough behind which way one is going.
  const [history, setHistory] = useState<Fix[]>([]);
  const fix = history.length > 0 ? history[history.length - 1] : null;
  const [screen, setScreen] = useState<NpsScreenSettings>(DEFAULT_NPS_SCREEN);
  const [screenLoaded, setScreenLoaded] = useState(false);
  const [screenStatus, setScreenStatus] = useState<ScreenStatus>({
    state: "idle",
  });
  // Set once a box has been drawn: whether a position was read in it, or
  // whether it was too small to keep.
  const [calibration, setCalibration] = useState<
    "found" | "empty" | "tooSmall" | null
  >(null);
  const [waiting, setWaiting] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [panel, setPanel] = useState<Panel>("guide");
  const [destination, setDestinationState] = useState<NpsDestination | null>(
    null,
  );
  // The last system a reading named or was near a body of: from
  // `/showlocation` in open space, coordinates do not tell Stanton from Pyro,
  // each centred on its own star.
  const [lastSystem, setLastSystem] = useState<string | null>(null);
  // Arrivé à un marqueur, « Le garder » range la question pour celui-là.
  const [keptMarker, setKeptMarker] = useState<string | null>(null);
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  useMarkersSync();
  const share = usePositionSharing();

  const data = useQuery({
    queryKey: ["nps"],
    queryFn: getNpsData,
    staleTime: 5 * 60 * 1000,
  });
  const bodies = useMemo(() => data.data?.bodies ?? [], [data.data]);
  const places = useMemo(() => data.data?.places ?? [], [data.data]);
  const markers = useMemo(() => data.data?.markers ?? [], [data.data]);

  useEffect(() => {
    const pending = listen<Fix>(POSITION_EVENT, (event) => {
      const reading = event.payload;
      setHistory((last) =>
        [...last, reading]
          .filter((one) => reading.at - one.at <= MAX_TRAVEL_AGE_MS)
          .slice(-MAX_HISTORY),
      );
      if (reading.source !== "screen") setWaiting(false);
    });
    return () => {
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getNpsScreen()
      .then((stored) => {
        if (!alive) return;
        setScreen(stored);
        setScreenLoaded(true);
      })
      .catch((error) => console.error("cannot read the NPS tracking", error));
    const status = listen<ScreenStatus>(SCREEN_STATUS_EVENT, (event) => {
      setScreenStatus(event.payload);
      // Once the reading says how it goes, that is what to show.
      if (event.payload.state !== "idle") setCalibration(null);
    });
    const calibrated = listen<{
      region: NpsScreenRegion | null;
      found: boolean;
    }>(CALIBRATED_EVENT, (event) => {
      const { region, found } = event.payload;
      if (!region) {
        setCalibration("tooSmall");
        return;
      }
      setCalibration(found ? "found" : "empty");
      // A box that reads turns the tracking on: that is what it was drawn
      // for.
      setScreen((last) => ({
        ...last,
        region,
        enabled: last.enabled || found,
      }));
    });
    return () => {
      alive = false;
      void status.then((stop) => stop()).catch(() => {});
      void calibrated.then((stop) => stop()).catch(() => {});
    };
  }, []);

  // Rust reads the screen; the settings live here, in the store.
  useEffect(() => {
    if (!screenLoaded) return;
    void invoke("nps_screen_configure", { settings: screen }).catch((error) =>
      console.error("cannot apply the NPS tracking", error),
    );
    void setNpsScreen(screen).catch((error) =>
      console.error("cannot save the NPS tracking", error),
    );
  }, [screen, screenLoaded]);

  // The destination lives in the store: the main window can set it from a
  // place's page, and this window outlives any hide and show.
  useEffect(() => {
    let alive = true;
    function refresh() {
      void readNpsDestination()
        .then((stored) => {
          if (alive) setDestinationState(stored);
        })
        .catch((error) =>
          console.error("cannot read the NPS destination", error),
        );
    }
    refresh();
    const pending = onDestinationChange(refresh);
    return () => {
      alive = false;
      void pending.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getNpsSystem()
      .then((slug) => {
        if (alive && slug) setLastSystem((seen) => seen ?? slug);
      })
      .catch((error) => console.error("cannot read the NPS system", error));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Locked, the window does not take the mouse: no list to pick from.
  useEffect(() => {
    if (locked) setPanel("guide");
  }, [locked]);

  // Les positions des autres ne se relisent que pour choisir un joueur ou
  // pour le suivre.
  const followed =
    destination && "player" in destination ? destination.player : null;
  const players = usePlayersInGame(
    share.sharing !== null && (panel === "destination" || followed !== null),
  );
  const others = useMemo(
    () => players.data?.filter((one) => !one.me),
    [players.data],
  );

  const target = useMemo(
    () =>
      targetOf(destination, places, markers, others, bodies, {
        manualName: t("manualName"),
        noCollection: t("mark.noCollection"),
      }),
    [destination, places, markers, others, bodies, t],
  );
  const systems = useMemo(
    () => [
      ...new Set(
        [...bodies, ...places].flatMap((one) =>
          one.systemSlug ? [one.systemSlug] : [],
        ),
      ),
    ],
    [bodies, places],
  );
  // Ce que les zones de r_displayInfo disent du système : seules à le dire
  // loin de tout corps, et dans un système dont le site ne décrit pas encore
  // les corps (Nyx).
  const named = fix ? systemOfZones(fix.zones, systems) : null;
  const body = fix
    ? bodyAt(
        fix,
        named ? bodies.filter((one) => one.systemSlug === named) : bodies,
      )
    : null;
  const seen = named ?? body?.systemSlug ?? null;
  const system = seen ?? lastSystem;
  const shareError = usePositionReporting(fix, bodies, system, share.sharing);

  // Le joueur suivi a bougé : la copie gardée avec la destination suit, pour
  // guider vers sa dernière position s'il cesse de partager.
  const followedNow = followed
    ? others?.find((one) => one.userId === followed.id)
    : undefined;
  useEffect(() => {
    if (!followed || !followedNow || followedNow.at === followed.at) return;
    void setDestination({
      player: {
        id: followed.id,
        name: followedNow.name,
        systemSlug: followedNow.systemSlug,
        position: followedNow.position,
        at: followedNow.at,
      },
    });
  }, [followed, followedNow]);
  const systemName = [...bodies, ...places].find(
    (one) => one.systemSlug === system,
  )?.systemName;
  const bodyFrame = fix && body ? toBodyFrame(fix, body) : null;
  const geo = bodyFrame && body ? geoOf(bodyFrame, body) : null;
  const elsewhere = target ? !inSystem(target, system) : false;
  const previous = useMemo(
    () => (fix ? previousFor(fix, history, bodies) : null),
    [fix, history, bodies],
  );
  const guidance =
    fix && target && !elsewhere
      ? guide(fix, previous, target.position, bodies)
      : null;
  const live = screen.enabled && screen.region !== null;
  const nearest = fix
    ? nearestPlaces(fix, places, bodies, system, 1)[0]
    : undefined;

  useEffect(() => {
    if (!seen || seen === lastSystem) return;
    setLastSystem(seen);
    void setNpsSystem(seen).catch((error) =>
      console.error("cannot save the NPS system", error),
    );
  }, [seen, lastSystem]);

  // Ce que le raccourci lit au moment où il part : il écoute une fois pour
  // toutes, et l'état aura changé d'ici là.
  const latest = useRef({ fix, system, live });
  useEffect(() => {
    latest.current = { fix, system, live };
  }, [fix, system, live]);
  const marking = useRef(false);

  useEffect(() => {
    /**
     * Le raccourci « Marquer ma position » : sans formulaire, au dernier
     * relevé s'il a moins de 30 s, sinon au prochain — lu à l'écran si le
     * suivi tourne, sinon `/showlocation` remis dans le presse-papiers.
     */
    async function quickMark() {
      if (marking.current) return;
      marking.current = true;
      const t = translator("NpsOverlay.mark");
      try {
        const started = Date.now();
        let reading = latest.current.fix;
        if (!isFresh(reading, started)) {
          const screenOn = latest.current.live;
          if (!screenOn) {
            await invoke("nps_copy_command");
            await notify({
              kind: "info",
              title: t("pasteTitle"),
              body: t("pasteBody"),
            });
          }
          reading = await nextReading(
            started,
            screenOn ? SCREEN_WAIT_MS : PASTE_WAIT_MS,
          );
          if (!reading) throw new Error(t("noReading"));
        }

        // Sans les corps, une position sur une planète serait prise dans le
        // repère du système, qui tourne sous le marqueur.
        const nps = await queryClient.ensureQueryData({
          queryKey: ["nps"],
          queryFn: getNpsData,
        });
        const system = latest.current.system;
        const where = whereOf(reading, nps.bodies, system);
        const located = markerPositionOf(reading, nps.bodies, system);
        if (!located.position?.body && !located.systemSlug) {
          throw new Error(t("noSystem"));
        }
        const name = defaultMarkerName(
          where.body?.name ?? where.systemName ?? t("defaultWhere"),
          reading.at,
        );
        const defaults = await getMarkerDefaults();
        let collectionId = defaults.collectionId;
        let created: { id: string };
        try {
          created = await createMarker({
            name,
            kind: defaults.kind,
            collectionId: collectionId ?? undefined,
            ...located,
          });
        } catch (error) {
          // La dernière collection a pu être supprimée sur le site : le
          // marqueur va « Sans collection » plutôt que nulle part.
          if (!collectionId || !isNotFound(error)) throw error;
          collectionId = null;
          await setMarkerDefaults({ ...defaults, collectionId });
          created = await createMarker({
            name,
            kind: defaults.kind,
            ...located,
          });
        }
        markersChanged(queryClient);

        const collectionName = collectionId
          ? queryClient
              .getQueryData<MarkerListResponse>(["markers"])
              ?.collections.find((one) => one.id === collectionId)?.name
          : translator("Markers")("noCollection");
        await notify({
          kind: "success",
          title: t("created", { name }),
          body: [collectionName, where.body?.name ?? where.systemName]
            .filter(Boolean)
            .join(" · "),
          route: "/markers",
          action: {
            label: t("undo"),
            event: UNDO_MARK_EVENT,
            payload: { id: created.id, name },
          },
        });
      } catch (error) {
        console.error("cannot mark the position", error);
        await notify({
          kind: "error",
          title: t("failed"),
          body: markerErrorMessage(error),
        }).catch(() => {});
      } finally {
        marking.current = false;
      }
    }

    /** « Annuler » sur la notification : le marqueur tout juste créé. */
    async function undo(id: string, name: string) {
      const t = translator("NpsOverlay.mark");
      try {
        await deleteMarker(id);
        markersChanged(queryClient);
        await notify({ kind: "info", title: t("undone", { name }) });
      } catch (error) {
        await notify({
          kind: "error",
          title: t("undoFailed"),
          body: markerErrorMessage(error),
        }).catch(() => {});
      }
    }

    const mark = listen(MARK_EVENT, () => void quickMark());
    const form = listen(MARK_FORM_EVENT, () => setPanel("mark"));
    const undone = listen<{ id: string; name: string }>(
      UNDO_MARK_EVENT,
      (event) => void undo(event.payload.id, event.payload.name),
    );
    return () => {
      for (const pending of [mark, form, undone]) {
        void pending.then((stop) => stop()).catch(() => {});
      }
    };
  }, [queryClient]);

  async function removeArrivedMarker(id: string) {
    setArrivalError(null);
    try {
      await deleteMarker(id);
      await setDestination(null);
      markersChanged(queryClient);
    } catch (error) {
      setArrivalError(markerErrorMessage(error));
    }
  }

  async function refreshPosition() {
    setCopyError(false);
    try {
      await invoke("nps_copy_command");
      setWaiting(true);
    } catch (error) {
      console.error("cannot copy /showlocation", error);
      setCopyError(true);
    }
  }

  function calibrate() {
    setCalibration(null);
    void invoke("nps_calibrate").catch((error) =>
      console.error("cannot start the NPS calibration", error),
    );
  }

  function close() {
    void invoke("close_nps_overlay");
  }

  const open = panel !== "guide" && !locked;

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden text-slate-200",
        overlaySkin(mode),
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (open) setPanel("guide");
        else close();
      }}
    >
      {/* Sans décorations, l'en-tête tient lieu de barre de titre. */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex shrink-0 cursor-grab items-center gap-2 px-3 py-2",
          mode === "opaque" ? "border-b border-white/10" : null,
        )}
      >
        <Compass className="pointer-events-none size-4 shrink-0 text-slate-400" />
        <p className="pointer-events-none min-w-0 flex-1 truncate text-sm font-medium">
          {t("title")}
        </p>
        <OverlayOpacityButton label="nps" mode={mode} />
        <OverlayLockButton label="nps" locked={locked} />
        <button
          type="button"
          onClick={close}
          title={t("close")}
          className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        >
          <span className="sr-only">{t("close")}</span>
          <X className="size-4" />
        </button>
      </div>

      {open && panel === "destination" ? (
        <DestinationPicker
          places={places}
          markers={markers}
          players={others ?? []}
          fix={fix}
          bodies={bodies}
          system={system}
          onPick={(slug) => {
            setPanel("guide");
            void setDestination({ slug });
          }}
          onPickMarker={(marker) => {
            setPanel("guide");
            void setDestination({
              marker: {
                id: marker.id,
                name: marker.name,
                systemSlug: marker.systemSlug,
                position: marker.position,
              },
            });
          }}
          onPickPlayer={(player) => {
            setPanel("guide");
            void setDestination({
              player: {
                id: player.userId,
                name: player.name,
                systemSlug: player.systemSlug,
                position: player.position,
                at: player.at,
              },
            });
          }}
          onCancel={() => setPanel("guide")}
        />
      ) : open && panel === "share" ? (
        <SharePanel
          share={share}
          header={
            <PickerHeader
              title={t("share.panelTitle")}
              onCancel={() => setPanel("guide")}
            />
          }
          onDone={() => setPanel("guide")}
        />
      ) : open && panel === "coordinates" ? (
        <CoordinatesPanel
          bodies={bodies}
          system={system}
          currentBody={body}
          loadFailed={data.isError}
          retrying={data.isFetching}
          onRetry={() => void data.refetch()}
          onPick={(point) => {
            setPanel("guide");
            void setDestination({ point });
          }}
          onCancel={() => setPanel("guide")}
        />
      ) : open && panel === "record" && fix ? (
        <RecordPanel
          fix={fix}
          system={system}
          onDone={() => setPanel("guide")}
          positionFor={() => positionOf(fix, bodies)}
        />
      ) : open && panel === "mark" ? (
        <MarkPanel
          fix={fix}
          live={live}
          bodies={bodies}
          bodiesReady={data.isSuccess}
          system={system}
          waiting={waiting}
          onRefresh={() => void refreshPosition()}
          onDone={() => setPanel("guide")}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
          <section className="space-y-1.5">
            <button
              type="button"
              onClick={() => void refreshPosition()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-medium transition hover:bg-white/10"
            >
              <Crosshair className="size-4" />
              {t("refresh")}
            </button>
            <ScreenTracking
              settings={screen}
              status={screenStatus}
              calibration={calibration}
              locked={locked}
              onChange={setScreen}
              onCalibrate={calibrate}
            />
            {copyError ? (
              <p className="text-[11px] text-red-300">{t("copyFailed")}</p>
            ) : waiting ? (
              <p className="text-[11px] text-sky-200">{t("waiting")}</p>
            ) : !fix && !live ? (
              <p className="text-[11px] text-slate-400">{t("hint")}</p>
            ) : null}
          </section>

          {fix ? (
            <section className="space-y-0.5 text-[12px]">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                {t("here")}
              </p>
              <p className="font-medium">
                {body ? body.name : t("space")}
                {systemName ? (
                  <span className="font-normal text-slate-400">
                    {" · "}
                    {systemName}
                  </span>
                ) : null}
                <span className="ml-2 font-normal text-slate-400">
                  {t("age", { age: formatAge(now - fix.at, t) })}
                </span>
              </p>
              {geo ? (
                <p className="text-slate-400">
                  {t("geo", {
                    altitude: formatDistance(geo.altitude, format),
                    latitude: format.number(geo.latitude, {
                      maximumFractionDigits: 2,
                    }),
                    longitude: format.number(geo.longitude, {
                      maximumFractionDigits: 2,
                    }),
                  })}
                </p>
              ) : null}
              {bodyFrame ? (
                // As r_displayInfo writes them on the body's line: to check
                // against the game, and to share.
                <p className="text-slate-400 tabular-nums">
                  {t("local", {
                    x: kilometres(bodyFrame.x, format),
                    y: kilometres(bodyFrame.y, format),
                    z: kilometres(bodyFrame.z, format),
                  })}
                </p>
              ) : null}
              {nearest ? (
                <p className="text-slate-400">
                  {t("nearest", {
                    name: nearest.place.name,
                    distance: formatDistance(nearest.distance, format),
                  })}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* Sans relevé, le formulaire invite à actualiser. */}
          <button
            type="button"
            onClick={() => setPanel("mark")}
            disabled={locked}
            className="flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-40"
            style={{
              color: DEFAULT_MARKER_COLOR,
              borderColor: `${DEFAULT_MARKER_COLOR}55`,
              backgroundColor: `${DEFAULT_MARKER_COLOR}14`,
            }}
          >
            <MapPinned className="size-4" />
            {t("mark.button")}
          </button>

          <ShareCard
            share={share}
            error={shareError}
            now={now}
            locked={locked}
            formatAge={(ms) => formatAge(ms, t)}
            onChoose={() => setPanel("share")}
          />

          <section className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[11px] uppercase tracking-wide text-slate-500">
                {t("destination")}
              </p>
              <button
                type="button"
                onClick={() => setPanel("destination")}
                disabled={locked}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
              >
                <Search className="size-3" />
                {t("choose")}
              </button>
              <button
                type="button"
                onClick={() => setPanel("coordinates")}
                disabled={locked}
                title={t("coordinatesHint")}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
              >
                <Keyboard className="size-3" />
                {t("coordinates")}
              </button>
              {destination ? (
                <button
                  type="button"
                  onClick={() => void setDestination(null)}
                  disabled={locked}
                  title={t("clearDestination")}
                  className="rounded p-0.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
                >
                  <span className="sr-only">{t("clearDestination")}</span>
                  <X className="size-3" />
                </button>
              ) : null}
            </div>

            {data.isPending ? (
              <p className="text-[12px] text-slate-500">…</p>
            ) : data.isError ? (
              <p className="text-[12px] text-slate-400">
                {t("loadFailed")}
                <button
                  type="button"
                  onClick={() => void data.refetch()}
                  className="ml-1 underline underline-offset-2 hover:text-slate-200"
                >
                  {t("retry")}
                </button>
              </p>
            ) : !target ? (
              <p className="text-[12px] text-slate-400">
                {places.length === 0 && markers.length === 0
                  ? t("noPlaces")
                  : t("noDestination")}
              </p>
            ) : (
              <>
                {target.player ? (
                  <p
                    className="text-[10px] uppercase tracking-wide"
                    style={{ color: PLAYER_COLOR }}
                  >
                    {t("players.label")}
                  </p>
                ) : null}
                <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                  {target.player ? (
                    <PlayerAvatar
                      player={{
                        name: target.name,
                        friend: target.player.friend,
                      }}
                    />
                  ) : null}
                  {target.marker ? (
                    <MapPinned
                      className="size-3.5 shrink-0"
                      style={{ color: target.marker.color }}
                      aria-label={t("mark.markerLabel")}
                    />
                  ) : null}
                  <span className="truncate">{target.name}</span>
                </p>
                {target.marker?.detail ? (
                  <p className="truncate text-[11px] text-slate-400">
                    {target.marker.detail}
                  </p>
                ) : null}
                {target.player ? (
                  <PlayerReading
                    target={target}
                    player={target.player}
                    now={now}
                  />
                ) : null}
                {target.manual ? (
                  <p className="truncate text-[11px] text-slate-500">
                    {t("manualWhere", {
                      where: target.bodyName ?? target.systemName ?? t("space"),
                    })}
                  </p>
                ) : null}
                {elsewhere ? (
                  <p className="text-[12px] text-slate-400">
                    {t("otherSystem", {
                      system: target.systemName ?? "?",
                    })}
                  </p>
                ) : !fix ? (
                  <p className="text-[12px] text-slate-400">{t("needFix")}</p>
                ) : !guidance ? (
                  <p className="text-[12px] text-slate-400">
                    {t("unknownBody")}
                  </p>
                ) : (
                  <Guidance
                    guidance={guidance}
                    hasPrevious={Boolean(previous)}
                    live={fix.source === "screen"}
                  />
                )}
                {target.marker &&
                guidance &&
                guidance.distance <= MARKER_ARRIVAL_M &&
                keptMarker !== target.marker.id ? (
                  <ArrivedAtMarker
                    canDelete={target.marker.isOwner}
                    error={arrivalError}
                    disabled={locked}
                    onDelete={() => void removeArrivedMarker(target.marker!.id)}
                    onKeep={() => setKeptMarker(target.marker!.id)}
                  />
                ) : null}
              </>
            )}
          </section>

          {fix ? (
            <button
              type="button"
              onClick={() => setPanel("record")}
              disabled={locked}
              className="mt-auto flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-slate-400 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
            >
              <MapPinPlus className="size-4" />
              {t("record")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The destination as stored, with what the overlay shows of it. */
function targetOf(
  destination: NpsDestination | null,
  places: NpsPlace[],
  markers: Marker[],
  /** Les joueurs en jeu, sauf moi ; `undefined` tant que pas lus. */
  players: PlayerInGame[] | undefined,
  bodies: NpsBody[],
  labels: { manualName: string; noCollection: string },
): Target | null {
  if (!destination) return null;
  if ("player" in destination) {
    // Sa dernière position telle que le site la donne ; à défaut, la copie.
    const kept = destination.player;
    const found = players?.find((one) => one.userId === kept.id);
    const position = found?.position ?? kept.position;
    const systemSlug = found?.systemSlug ?? kept.systemSlug;
    const at = found?.at ?? kept.at;
    return {
      name: found?.name ?? kept.name,
      manual: false,
      systemSlug,
      systemName:
        found?.systemName ??
        bodies.find((one) => one.systemSlug === systemSlug)?.systemName,
      bodyName:
        found?.bodyName ??
        bodies.find((one) => one.slug === position.body)?.name,
      position,
      player: {
        id: kept.id,
        friend: found?.friend ?? true,
        at: at ? Date.parse(at) : null,
        activity: found?.activity ?? null,
        gone: players !== undefined && !found,
      },
    };
  }
  if ("marker" in destination) {
    // Le marqueur tel que le site le donne, renommé ou déplacé depuis ; à
    // défaut, la copie gardée avec la destination.
    const kept = destination.marker;
    const found = markers.find((one) => one.id === kept.id);
    const position = found?.position ?? kept.position;
    const systemSlug = found?.systemSlug ?? kept.systemSlug;
    return {
      name: found?.name ?? kept.name,
      manual: false,
      systemSlug,
      systemName:
        found?.systemName ??
        bodies.find((one) => one.systemSlug === systemSlug)?.systemName,
      bodyName:
        found?.bodyName ??
        bodies.find((one) => one.slug === position.body)?.name,
      position,
      marker: {
        id: kept.id,
        color: found?.color ?? DEFAULT_MARKER_COLOR,
        detail: found
          ? [found.collectionName ?? labels.noCollection, found.note]
              .filter(Boolean)
              .join(" · ")
          : undefined,
        isOwner: found?.isOwner ?? false,
      },
    };
  }
  if ("slug" in destination) {
    const place = places.find((one) => one.slug === destination.slug);
    return place
      ? {
          name: place.name,
          manual: false,
          systemSlug: place.systemSlug,
          systemName: place.systemName,
          bodyName: place.bodyName,
          position: place.position,
        }
      : null;
  }
  if (!("point" in destination)) return null;
  const { name, systemSlug, position } = destination.point;
  return {
    name: name || labels.manualName,
    manual: true,
    systemSlug,
    systemName: bodies.find((one) => one.systemSlug === systemSlug)?.systemName,
    bodyName: bodies.find((one) => one.slug === position.body)?.name,
    position,
  };
}

type Formatter = ReturnType<typeof useFormatter>;

/** As `r_displayInfo` writes a coordinate, in km to the metre. */
function kilometres(meters: number, format: Formatter): string {
  return format.number(meters / 1000, { maximumFractionDigits: 3 });
}

function formatAge(
  ms: number,
  t: ReturnType<typeof useTranslations<"NpsOverlay">>,
): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t("seconds", { count: seconds });
  return t("minutes", { count: Math.floor(seconds / 60) });
}

function formatDuration(
  seconds: number,
  t: ReturnType<typeof useTranslations<"NpsOverlay">>,
): string {
  const total = Math.round(seconds);
  if (total < 60) return t("seconds", { count: total });
  if (total < 3600) {
    return t("minutesSeconds", {
      minutes: Math.floor(total / 60),
      seconds: total % 60,
    });
  }
  return t("hoursMinutes", {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
  });
}

/** Où est le joueur suivi, depuis quand, et si sa position a vieilli. */
function PlayerReading({
  target,
  player,
  now,
}: {
  target: Target;
  player: NonNullable<Target["player"]>;
  now: number;
}) {
  const t = useTranslations("NpsOverlay");
  const age = player.at !== null ? Math.max(0, now - player.at) : null;
  return (
    <>
      <p className="truncate text-[11px] text-slate-400">
        {[
          player.activity,
          target.bodyName ?? target.systemName,
          age !== null
            ? t("players.reading", { age: formatAge(age, t) })
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {player.gone ? (
        <p className="text-[11px] text-amber-200">{t("players.gone")}</p>
      ) : age !== null && age > POSITION_STALE_MS ? (
        <p className="text-[11px] text-amber-200">
          {t("players.stale", { age: formatAge(age, t) })}
        </p>
      ) : null}
    </>
  );
}

function Guidance({
  guidance,
  hasPrevious,
  live,
}: {
  guidance: NonNullable<ReturnType<typeof guide>>;
  hasPrevious: boolean;
  /** Followed off the screen: no need to refresh by hand. */
  live: boolean;
}) {
  const t = useTranslations("NpsOverlay");
  const format = useFormatter();
  const { surface, turn } = guidance;

  const TurnIcon = !turn
    ? null
    : !turn.signed || Math.abs(turn.degrees) < AHEAD_DEGREES
      ? ArrowUp
      : turn.degrees < 0
        ? ArrowLeft
        : ArrowRight;

  return (
    <div className="space-y-1.5">
      <NpsCompass guidance={guidance} />
      <p className="text-2xl font-semibold tabular-nums">
        {formatDistance(surface?.distance ?? guidance.distance, format)}
      </p>
      {surface ? (
        <p className="flex items-center gap-1.5 text-[13px]">
          <Navigation
            className="size-3.5 text-sky-300"
            style={{ transform: `rotate(${surface.heading - 45}deg)` }}
          />
          {t("heading", {
            degrees: Math.round(surface.heading),
            point: t(`compass.${compassPoint(surface.heading)}`),
          })}
          <span className="text-slate-400">
            ·{" "}
            {t("straight", {
              distance: formatDistance(guidance.distance, format),
            })}
          </span>
        </p>
      ) : null}

      {turn && TurnIcon ? (
        <p className="flex items-center gap-1.5 text-[13px]">
          <TurnIcon className="size-4 text-sky-300" />
          {!turn.signed
            ? t("offCourse", { degrees: Math.round(turn.degrees) })
            : Math.abs(turn.degrees) < AHEAD_DEGREES
              ? t("ahead")
              : turn.degrees < 0
                ? t("turnLeft", { degrees: Math.round(-turn.degrees) })
                : t("turnRight", { degrees: Math.round(turn.degrees) })}
        </p>
      ) : (
        <p className="text-[11px] text-slate-400">
          {live
            ? t("moveLive")
            : hasPrevious
              ? t("moveMore")
              : t("moveThenRefresh")}
        </p>
      )}

      {guidance.closingSpeed !== undefined ? (
        <p className="text-[12px] text-slate-400">
          {guidance.closingSpeed > MIN_CLOSING_SPEED
            ? t("closing", {
                speed: format.number(guidance.closingSpeed, {
                  maximumFractionDigits: 0,
                }),
                eta: formatDuration(guidance.eta ?? 0, t),
              })
            : guidance.closingSpeed < -MIN_CLOSING_SPEED
              ? t("receding")
              : t("steady")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Following the player off the screen: the game's debug lines, read every
 * second or so in the box the player drew around them.
 */
function ScreenTracking({
  settings,
  status,
  calibration,
  locked,
  onChange,
  onCalibrate,
}: {
  settings: NpsScreenSettings;
  status: ScreenStatus;
  calibration: "found" | "empty" | "tooSmall" | null;
  locked: boolean;
  onChange: (settings: NpsScreenSettings) => void;
  onCalibrate: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  const format = useFormatter();
  const calibrated = settings.region !== null;

  const message =
    calibration === "tooSmall"
      ? { tone: "text-amber-200", text: t("screen.tooSmall") }
      : !calibrated
        ? { tone: "text-slate-400", text: t("screen.setup") }
        : calibration === "empty"
          ? { tone: "text-amber-200", text: t("screen.calibrationEmpty") }
          : !settings.enabled
            ? null
            : status.state === "unreadable"
              ? { tone: "text-amber-200", text: t("screen.unreadable") }
              : status.state === "failed"
                ? {
                    tone: "text-red-300",
                    text: t("screen.failed", { message: status.message }),
                  }
                : status.state === "reading"
                  ? { tone: "text-sky-200", text: t("screen.reading") }
                  : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={locked || !calibrated}
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          aria-pressed={settings.enabled}
          title={settings.enabled ? t("screen.stop") : t("screen.start")}
          className={cn(
            "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition disabled:opacity-40",
            settings.enabled && calibrated
              ? "border-sky-300/40 bg-sky-300/10 text-sky-100 hover:bg-sky-300/20"
              : "border-white/15 bg-white/5 hover:bg-white/10",
          )}
        >
          <Radar className="size-3.5 shrink-0" />
          <span className="truncate">
            {settings.enabled && calibrated ? t("screen.on") : t("screen.off")}
          </span>
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={onCalibrate}
          title={t("screen.calibrateHint")}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[12px] transition hover:bg-white/10 disabled:opacity-40"
        >
          <ScanText className="size-3.5" />
          {calibrated ? t("screen.recalibrate") : t("screen.calibrate")}
        </button>
        <select
          value={settings.intervalMs}
          disabled={locked}
          onChange={(event) =>
            onChange({ ...settings, intervalMs: Number(event.target.value) })
          }
          title={t("screen.interval")}
          aria-label={t("screen.interval")}
          className="shrink-0 rounded-lg border border-white/15 bg-black/40 px-1 py-1 text-[12px] text-slate-200 focus:outline-none disabled:opacity-40"
        >
          {SCREEN_INTERVALS.map((ms) => (
            <option key={ms} value={ms}>
              {t("screen.every", {
                seconds: format.number(ms / 1000, {
                  maximumFractionDigits: 1,
                }),
              })}
            </option>
          ))}
        </select>
      </div>
      {message ? (
        <p className={cn("text-[11px]", message.tone)}>{message.text}</p>
      ) : null}
    </div>
  );
}

/**
 * The recorded places, filtered as one types: there are hundreds, not more.
 * Les joueurs en jeu passent devant, puis les marqueurs du joueur, les plus
 * proches d'abord.
 */
function DestinationPicker({
  places,
  markers,
  players,
  fix,
  bodies,
  system,
  onPick,
  onPickMarker,
  onPickPlayer,
  onCancel,
}: {
  places: NpsPlace[];
  markers: Marker[];
  /** Les joueurs en jeu dont je vois la position, sauf moi. */
  players: PlayerInGame[];
  fix: Fix | null;
  bodies: NpsBody[];
  system: string | null;
  onPick: (slug: string) => void;
  onPickMarker: (marker: Marker) => void;
  onPickPlayer: (player: PlayerInGame) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  const format = useFormatter();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const shownMarkers = withDistances(
    markers.filter(
      (marker) =>
        !needle ||
        [
          marker.name,
          marker.note,
          marker.collectionName,
          marker.bodyName,
          marker.systemName,
        ].some((name) => name?.toLowerCase().includes(needle)),
    ),
    fix,
    bodies,
    system,
  ).slice(0, 20);
  const shown = places
    .filter(
      (place) =>
        !needle ||
        [place.name, place.parentName, place.bodyName, place.systemName].some(
          (name) => name?.toLowerCase().includes(needle),
        ),
    )
    .slice(0, 30);
  const shownPlayers = playersWithDistances(
    players.filter(
      (player) =>
        !needle ||
        [
          player.name,
          player.bodyName,
          player.systemName,
          ...player.orgs.flatMap((org) => [org.name, org.tag]),
        ].some((name) => name?.toLowerCase().includes(needle)),
    ),
    fix,
    bodies,
    system,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      <PickerHeader title={t("chooseTitle")} onCancel={onCancel} />
      <input
        autoFocus
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={
          players.length > 0
            ? t("players.searchPlaceholder")
            : markers.length > 0
              ? t("mark.searchPlaceholder")
              : t("searchPlaceholder")
        }
        className="shrink-0 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
      />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {shownPlayers.length > 0 ? (
          <>
            <p
              className="px-1 pt-1 text-[11px] uppercase tracking-wide"
              style={{ color: PLAYER_COLOR }}
            >
              {t("players.section")}
            </p>
            {shownPlayers.map(({ player, distance }) => (
              <button
                key={player.userId}
                type="button"
                onClick={() => onPickPlayer(player)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10"
              >
                <PlayerAvatar player={player} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-slate-100">
                    {player.name}
                    {player.orgs.map((org) =>
                      org.tag ? <Tag key={org.id}>{org.tag}</Tag> : null,
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {[
                      player.bodyName ?? player.systemName,
                      distance !== null
                        ? formatDistance(distance, format)
                        : undefined,
                      player.activity,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            ))}
            {shownMarkers.length === 0 ? (
              <p className="px-1 pt-2 text-[11px] uppercase tracking-wide text-slate-500">
                {t("mark.placesSection")}
              </p>
            ) : null}
          </>
        ) : null}
        {shownMarkers.length > 0 ? (
          <>
            <p
              className="px-1 pt-1 text-[11px] uppercase tracking-wide"
              style={{ color: DEFAULT_MARKER_COLOR }}
            >
              {t("mark.section")}
            </p>
            {shownMarkers.map(({ marker, distance }) => (
              <button
                key={marker.id}
                type="button"
                onClick={() => onPickMarker(marker)}
                className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10"
              >
                <span className="flex items-center gap-1.5 truncate text-[13px] text-slate-100">
                  <MapPinned
                    className="size-3 shrink-0"
                    style={{ color: marker.color }}
                  />
                  <span className="truncate">{marker.name}</span>
                </span>
                <span className="block truncate text-[11px] text-slate-400">
                  {[
                    distance !== null
                      ? formatDistance(distance, format)
                      : undefined,
                    marker.bodyName ?? marker.systemName,
                    marker.collectionName,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ))}
            <p className="px-1 pt-2 text-[11px] uppercase tracking-wide text-slate-500">
              {t("mark.placesSection")}
            </p>
          </>
        ) : null}
        {places.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-slate-400">
            {t("noPlaces")}
          </p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-slate-500">
            {t("noResults")}
          </p>
        ) : (
          shown.map((place) => (
            <button
              key={place.slug}
              type="button"
              onClick={() => onPick(place.slug)}
              className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10"
            >
              <span className="flex items-center gap-1.5 truncate text-[13px] text-slate-100">
                {/* Un lieu privé, à soi ou à son organisation. */}
                {place.private ? (
                  <Lock
                    className="size-3 shrink-0 text-[#c4b2ff]"
                    aria-label={
                      place.private.org
                        ? t("privateShared", { org: place.private.org })
                        : t("privateOwn")
                    }
                  />
                ) : null}
                <span className="truncate">{place.name}</span>
              </span>
              <span className="block truncate text-[11px] text-slate-400">
                {[place.systemName, place.bodyName, place.parentName]
                  .filter(
                    (name, index, all) => !!name && all.indexOf(name) === index,
                  )
                  .join(" › ")}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Les joueurs et leur distance au relevé, les plus proches d'abord, puis ceux
 * d'un autre système, les relevés les plus récents d'abord. Comme les
 * marqueurs : d'un autre système, la distance ne veut rien dire.
 */
function playersWithDistances(
  players: PlayerInGame[],
  fix: Fix | null,
  bodies: NpsBody[],
  system: string | null,
): { player: PlayerInGame; distance: number | null }[] {
  return players
    .map((player) => {
      if (!fix || player.systemSlug !== system) {
        return { player, distance: null };
      }
      const point = systemPositionOf(player.position, bodies, fix.at);
      return {
        player,
        distance: point
          ? Math.hypot(point.x - fix.x, point.y - fix.y, point.z - fix.z)
          : null,
      };
    })
    .sort((a, b) =>
      a.distance !== null && b.distance !== null
        ? a.distance - b.distance
        : a.distance !== null
          ? -1
          : b.distance !== null
            ? 1
            : b.player.at.localeCompare(a.player.at),
    );
}

/**
 * Proposes the latest reading as the position of a place. Any place of the
 * catalogue, recorded or not: correcting a position is a contribution too.
 */
function RecordPanel({
  fix,
  system,
  positionFor,
  onDone,
}: {
  fix: Fix;
  /** Where the player is, if known: a place of another system is refused. */
  system: string | null;
  positionFor: () => ReturnType<typeof positionOf>;
  onDone: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const [picked, setPicked] = useState<{
    slug: string;
    name: string;
    systemSlug?: string;
    systemName?: string;
  } | null>(null);
  const elsewhere = picked ? !inSystem(picked, system) : false;
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<
    { ok: true; published: boolean } | { ok: false; message: string } | null
  >(null);

  const results = useQuery({
    queryKey: ["nps-record-picker", query],
    queryFn: () => listPlaces({ query: query || undefined, limit: 8 }),
    enabled: !picked,
  });

  async function send() {
    if (!picked || elsewhere) return;
    setSending(true);
    try {
      const answer = await submitPlacePosition(picked.slug, positionFor());
      setResult({
        ok: true,
        published: answer.contribution.status === "published",
      });
      void queryClient.invalidateQueries({ queryKey: ["nps"] });
    } catch (error) {
      setResult({ ok: false, message: positionErrorMessage(error) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      <PickerHeader title={t("recordTitle")} onCancel={onDone} />

      {result?.ok ? (
        <div className="space-y-2 text-[13px]">
          <p>{result.published ? t("recordPublished") : t("recordPending")}</p>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-white/15 px-3 py-1 text-[12px] transition hover:bg-white/10"
          >
            {t("back")}
          </button>
        </div>
      ) : picked ? (
        <div className="space-y-2 text-[13px]">
          <p>{t("recordConfirm", { name: picked.name })}</p>
          <p className="text-[11px] text-slate-400">
            {t("recordHint", { age: Math.round((Date.now() - fix.at) / 1000) })}
          </p>
          {elsewhere ? (
            <p className="text-[12px] text-red-300">
              {t("recordOtherSystem", { system: picked.systemName ?? "?" })}
            </p>
          ) : null}
          {result && !result.ok ? (
            <p className="text-[12px] text-red-300">{result.message}</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={sending || elsewhere}
              onClick={() => void send()}
              className="rounded-lg border border-sky-300/40 bg-sky-300/10 px-3 py-1 text-[12px] font-medium transition hover:bg-sky-300/20 disabled:opacity-50"
            >
              {sending ? "…" : t("recordSend")}
            </button>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setResult(null);
              }}
              className="rounded-lg px-3 py-1 text-[12px] text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
            >
              {t("recordOther")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="shrink-0 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {results.isPending ? (
              <p className="px-1 py-2 text-[12px] text-slate-500">…</p>
            ) : results.isError ? (
              <p className="px-1 py-2 text-[12px] text-slate-500">
                {t("searchFailed")}
              </p>
            ) : results.data.places.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-slate-500">
                {t("noResults")}
              </p>
            ) : (
              results.data.places.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() =>
                    setPicked({
                      slug: place.slug,
                      name: place.name,
                      systemSlug: place.systemSlug,
                      systemName: place.systemName,
                    })
                  }
                  className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10"
                >
                  <span className="block truncate text-[13px] text-slate-100">
                    {place.name}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {[place.systemName, place.bodyName, place.parentName]
                      .filter(
                        (name, index, all) =>
                          !!name && all.indexOf(name) === index,
                      )
                      .join(" › ")}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * À moins de 50 m d'un marqueur visé : le rocher est miné, l'épave pillée,
 * on peut s'en défaire. Seul son créateur le supprime ; les autres le gardent
 * dans la collection partagée.
 */
function ArrivedAtMarker({
  canDelete,
  error,
  disabled,
  onDelete,
  onKeep,
}: {
  canDelete: boolean;
  error: string | null;
  disabled: boolean;
  onDelete: () => void;
  onKeep: () => void;
}) {
  const t = useTranslations("NpsOverlay.mark");
  return (
    <div
      className="space-y-1.5 rounded-lg border px-2.5 py-2 text-[12px]"
      style={{
        borderColor: `${DEFAULT_MARKER_COLOR}55`,
        backgroundColor: `${DEFAULT_MARKER_COLOR}14`,
      }}
    >
      <p style={{ color: DEFAULT_MARKER_COLOR }}>{t("arrived")}</p>
      {error ? <p className="text-red-300">{error}</p> : null}
      <div className="flex gap-2">
        {canDelete ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            className="rounded-lg border border-red-300/40 bg-red-300/10 px-2.5 py-1 text-red-200 transition hover:bg-red-300/20 disabled:opacity-40"
          >
            {t("delete")}
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={onKeep}
          className="rounded-lg px-2.5 py-1 text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
        >
          {t("keep")}
        </button>
      </div>
    </div>
  );
}

/** « Sans collection », et « Nouvelle collection… » dans la liste. */
const NO_COLLECTION = "";
const NEW_COLLECTION = "\u0000new";

/**
 * Un nouveau marqueur au dernier relevé, sous « Ma position ». Le relevé est
 * figé à l'ouverture : le suivi à l'écran continue pendant qu'on remplit, et
 * le marqueur doit rester où l'on était. Trop vieux, il est relancé comme
 * par « Actualiser ma position » et le premier qui arrive est pris.
 */
function MarkPanel({
  fix,
  live,
  bodies,
  bodiesReady,
  system,
  waiting,
  onRefresh,
  onDone,
}: {
  fix: Fix | null;
  /** Le suivi à l'écran tourne : un relevé arrive sans rien faire. */
  live: boolean;
  bodies: NpsBody[];
  /** Les corps sont lus : la position peut se mettre dans leur repère. */
  bodiesReady: boolean;
  system: string | null;
  /** `/showlocation` est dans le presse-papiers, à coller dans le jeu. */
  waiting: boolean;
  onRefresh: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("NpsOverlay.mark");
  const tk = useTranslations("Markers.kinds");
  const queryClient = useQueryClient();
  const [openedAt] = useState(() => Date.now());
  const [frozen, setFrozen] = useState<Fix | null>(() =>
    isFresh(fix, openedAt) ? fix : null,
  );
  const [defaults, setDefaults] = useState<MarkerDefaults | null>(null);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [kind, setKind] = useState<MarkerDefaults["kind"] | null>(null);
  const [collection, setCollection] = useState<string | null>(null);
  const [newCollection, setNewCollection] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["markers"],
    queryFn: () => listMarkers(),
  });
  // On ne range un marqueur que dans ses propres collections.
  const collections = useMemo(
    () => list.data?.collections.filter((one) => one.isOwner) ?? [],
    [list.data],
  );

  useEffect(() => {
    let alive = true;
    void getMarkerDefaults()
      .then((stored) => {
        if (alive) setDefaults(stored);
      })
      .catch(() => {
        if (alive) setDefaults(DEFAULT_MARKER_DEFAULTS);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Un relevé trop vieux est relancé une fois, à l'ouverture ; sans relevé
  // du tout, le panneau invite à actualiser.
  useEffect(() => {
    if (!isFresh(fix, openedAt) && fix && !live) onRefresh();
    // Une fois, à l'ouverture : pas à chaque relevé qui arrive ensuite.
  }, []);

  useEffect(() => {
    if (!frozen && fix && fix.at >= openedAt) setFrozen(fix);
  }, [fix, frozen, openedAt]);

  const where = frozen ? whereOf(frozen, bodies, system) : null;
  const defaultName = frozen
    ? defaultMarkerName(
        where?.body?.name ?? where?.systemName ?? t("defaultWhere"),
        frozen.at,
      )
    : "";
  const name = typedName ?? defaultName;
  const chosenKind = kind ?? defaults?.kind ?? DEFAULT_MARKER_DEFAULTS.kind;
  // La dernière collection, si elle existe encore.
  const remembered = defaults?.collectionId ?? NO_COLLECTION;
  const chosenCollection =
    collection ??
    (collections.some((one) => one.id === remembered)
      ? remembered
      : NO_COLLECTION);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!frozen || !bodiesReady || sending) return;
    setError(null);
    const located = markerPositionOf(frozen, bodies, system);
    if (!located.position?.body && !located.systemSlug) {
      setError(t("noSystem"));
      return;
    }
    if (chosenCollection === NEW_COLLECTION && !newCollection.trim()) {
      setError(t("newCollectionMissing"));
      return;
    }

    setSending(true);
    try {
      let collectionId: string | null =
        chosenCollection === NO_COLLECTION ? null : chosenCollection;
      if (chosenCollection === NEW_COLLECTION) {
        const made = await createMarkerCollection({
          name: newCollection.trim(),
          color: nextCollectionColor(collections),
        });
        collectionId = made.id;
      }
      const label = name.trim() || defaultName;
      await createMarker({
        name: label,
        kind: chosenKind,
        collectionId: collectionId ?? undefined,
        note: note.trim() || undefined,
        ...located,
      });
      await setMarkerDefaults({ collectionId, kind: chosenKind }).catch(
        (cause) => console.error("cannot save the marker defaults", cause),
      );
      markersChanged(queryClient);
      setCreated(label);
    } catch (cause) {
      setError(markerErrorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  if (created) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <PickerHeader title={t("title")} onCancel={onDone} />
        <p className="text-[13px]">{t("created", { name: created })}</p>
        <button
          type="button"
          autoFocus
          onClick={onDone}
          className="self-start rounded-lg border border-white/15 px-3 py-1 text-[12px] transition hover:bg-white/10"
        >
          {translator("NpsOverlay")("back")}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={save}
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3"
    >
      <PickerHeader title={t("title")} onCancel={onDone} />

      {!frozen ? (
        <div className="space-y-2 text-[12px]">
          <p className="text-slate-300">
            {live
              ? t("waitingScreen")
              : fix || waiting
                ? t("waitingPaste")
                : t("needFix")}
          </p>
          {!live ? (
            <button
              type="button"
              onClick={onRefresh}
              className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-[12px] transition hover:bg-white/10"
            >
              <Crosshair className="size-3.5" />
              {translator("NpsOverlay")("refresh")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <label className="space-y-0.5 text-[11px] text-slate-400">
            <span>{t("name")}</span>
            <input
              autoFocus
              value={name}
              maxLength={MAX_MARKER_NAME_LENGTH}
              onChange={(event) => setTypedName(event.target.value)}
              className={cn(FIELD, "block w-full")}
            />
          </label>

          <div className="space-y-0.5 text-[11px] text-slate-400">
            <span>{t("kind")}</span>
            <div className="flex flex-wrap gap-1">
              {MARKER_KINDS.map((one) => (
                <button
                  key={one}
                  type="button"
                  aria-pressed={chosenKind === one}
                  onClick={() => setKind(one)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] transition",
                    chosenKind === one
                      ? "font-medium"
                      : "border-white/15 text-slate-300 hover:bg-white/10",
                  )}
                  style={
                    chosenKind === one
                      ? {
                          color: DEFAULT_MARKER_COLOR,
                          borderColor: `${DEFAULT_MARKER_COLOR}80`,
                          backgroundColor: `${DEFAULT_MARKER_COLOR}1f`,
                        }
                      : undefined
                  }
                >
                  {tk(one)}
                </button>
              ))}
            </div>
          </div>

          <label className="space-y-0.5 text-[11px] text-slate-400">
            <span>{t("collection")}</span>
            <select
              value={chosenCollection}
              onChange={(event) => setCollection(event.target.value)}
              className={cn(FIELD, "block w-full")}
            >
              <option value={NO_COLLECTION}>{t("noCollection")}</option>
              {collections.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
              <option value={NEW_COLLECTION}>{t("newCollection")}</option>
            </select>
          </label>
          {chosenCollection === NEW_COLLECTION ? (
            <input
              value={newCollection}
              maxLength={MAX_MARKER_COLLECTION_NAME_LENGTH}
              placeholder={t("newCollectionPlaceholder")}
              onChange={(event) => setNewCollection(event.target.value)}
              className={cn(FIELD, "block w-full")}
            />
          ) : null}
          {list.isError ? (
            <p className="text-[11px] text-amber-200">
              {t("collectionsFailed")}
            </p>
          ) : null}

          <label className="space-y-0.5 text-[11px] text-slate-400">
            <span>{t("note")}</span>
            <textarea
              value={note}
              rows={2}
              maxLength={MAX_MARKER_NOTE_LENGTH}
              placeholder={t("notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                // Entrée enregistre, ici aussi ; Maj+Entrée va à la ligne.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              className={cn(FIELD, "block w-full resize-none")}
            />
          </label>

          <p className="text-[11px] text-slate-500">
            {t("reading", {
              age: Math.max(0, Math.round((Date.now() - frozen.at) / 1000)),
              where: where?.body
                ? t("bodyFrame", { body: where.body.name })
                : (where?.systemName ?? t("defaultWhere")),
            })}
          </p>
        </>
      )}

      {error ? <p className="text-[12px] text-red-300">{error}</p> : null}

      {frozen ? (
        <button
          type="submit"
          disabled={sending || !bodiesReady}
          className="flex shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-50"
          style={{
            color: DEFAULT_MARKER_COLOR,
            borderColor: `${DEFAULT_MARKER_COLOR}66`,
            backgroundColor: `${DEFAULT_MARKER_COLOR}1f`,
          }}
        >
          <MapPinned className="size-3.5" />
          {sending || !bodiesReady ? "…" : t("save")}
        </button>
      ) : null}
    </form>
  );
}

function PickerHeader({
  title,
  onCancel,
}: {
  title: string;
  onCancel: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        title={t("back")}
        className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
      >
        <span className="sr-only">{t("back")}</span>
        <ArrowLeft className="size-4" />
      </button>
      <p className="text-[13px] font-medium">{title}</p>
    </div>
  );
}

type ManualPoint = Extract<NpsDestination, { point: unknown }>["point"];

type Xyz = { x: string; y: string; z: string };
type Unit = "m" | "km";

const EMPTY_XYZ: Xyz = { x: "", y: "", z: "" };

/**
 * Within this many radii of a body's centre, typed X, Y, Z are plausible;
 * past it, they were most likely typed in metres with the unit left on km.
 */
const MAX_BODY_RADII = 3;

/**
 * A destination typed in by hand. On a planet or a moon, in its own frame:
 * the X, Y, Z `r_displayInfo` shows on the line of its zone, or latitude,
 * longitude and altitude as the NPS shows them under « Ma position ». The
 * ground turns, so a position in the system frame would be wrong a minute
 * later. In space, by the system coordinates `/showlocation` gives, which
 * can be pasted whole.
 *
 * The planets and moons may arrive after it opens: what it picks by default
 * is worked out from them on each render, so nothing typed is lost.
 */
function CoordinatesPanel({
  bodies,
  system,
  currentBody,
  loadFailed,
  retrying,
  onRetry,
  onPick,
  onCancel,
}: {
  bodies: NpsBody[];
  /** The system the player is in, if known: its bodies come first. */
  system: string | null;
  currentBody: NpsBody | null;
  /** The planets and moons could not be loaded from the site. */
  loadFailed: boolean;
  /** They are being asked for again. */
  retrying: boolean;
  onRetry: () => void;
  onPick: (point: ManualPoint) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("NpsOverlay");
  const format = useFormatter();
  const noBodies = bodies.length === 0;
  // Unset until the player picks: then the default follows the bodies.
  const [pickedMode, setMode] = useState<"body" | "space" | null>(null);
  const mode = noBodies
    ? "space"
    : (pickedMode ?? (currentBody ? "body" : "space"));
  const [name, setName] = useState("");
  const [pickedSlug, setBodySlug] = useState("");
  const bodySlug =
    pickedSlug ||
    currentBody?.slug ||
    bodies.find((one) => inSystem(one, system))?.slug ||
    bodies[0]?.slug ||
    "";
  // In-game, a body's frame is what one sees: r_displayInfo gives X, Y, Z.
  const [bodyInput, setBodyInput] = useState<"local" | "geo">("local");
  const [local, setLocal] = useState<Xyz>(EMPTY_XYZ);
  // r_displayInfo writes kilometres, /showlocation metres.
  const [localUnit, setLocalUnit] = useState<Unit>("km");
  const [geo, setGeo] = useState({ latitude: "", longitude: "", altitude: "" });
  const [xyz, setXyz] = useState<Xyz>(EMPTY_XYZ);
  const [unit, setUnit] = useState<Unit>("m");
  // When the pasted coordinates were read: close to a body, they place the
  // point as the body stood then. Typed by hand, they are taken as of now.
  const [pastedAt, setPastedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // By system, the player's own first, then by name.
  const groups = useMemo(() => {
    const bySystem = new Map<string, NpsBody[]>();
    for (const one of bodies) {
      const key = one.systemName ?? one.systemSlug ?? "";
      bySystem.set(key, [...(bySystem.get(key) ?? []), one]);
    }
    return [...bySystem.entries()]
      .map(([label, list]) => ({
        label,
        mine: list.some((one) => one.systemSlug === system),
        list: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort(
        (a, b) =>
          Number(b.mine) - Number(a.mine) || a.label.localeCompare(b.label),
      );
  }, [bodies, system]);

  /**
   * Fills the fields from a line of the game, if `read` makes one out; a
   * line from the game it cannot place is not pasted raw into a field.
   */
  function pasting(
    event: ClipboardEvent,
    read: (text: string) => boolean,
    unknown: string,
  ) {
    const text = event.clipboardData.getData("text");
    if (read(text)) {
      event.preventDefault();
      setError(null);
    } else if (looksLikeGameCoordinates(text)) {
      event.preventDefault();
      setError(unknown);
    }
  }

  function pasted(event: ClipboardEvent) {
    pasting(
      event,
      (text) => {
        const point = parseGameCoordinates(text);
        if (!point) return false;
        setUnit("m");
        setXyz(asFields(point));
        setPastedAt(Date.now());
        return true;
      },
      t("manual.pasteSpaceUnknown"),
    );
  }

  function pastedLocal(event: ClipboardEvent) {
    pasting(
      event,
      (text) => {
        const found = parseBodyCoordinates(text, bodies, system);
        if (!found) return false;
        setBodySlug(found.body.slug);
        setLocalUnit("m");
        setLocal(asFields(found.point));
        return true;
      },
      t("manual.pasteBodyUnknown"),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const label = name.trim() || undefined;
    const body = bodies.find((one) => one.slug === bodySlug);

    if (mode === "body" && bodyInput === "local") {
      const point = parseXyz(local, localUnit);
      if (!body || !point) {
        setError(t("manual.invalidXyz"));
        return;
      }
      const distance = Math.hypot(point.x, point.y, point.z);
      if (
        distance < body.radius / 2 ||
        distance > body.radius * MAX_BODY_RADII
      ) {
        setError(
          t("manual.implausibleXyz", {
            distance: formatDistance(distance, format),
            body: body.name,
            radius: formatDistance(body.radius, format),
          }),
        );
        return;
      }
      // The body's frame turns with it, as the one places are stored in.
      onPick({
        name: label,
        systemSlug: body.systemSlug,
        position: { body: body.slug, ...point },
      });
      return;
    }

    if (mode === "body") {
      const latitude = parseNumber(geo.latitude);
      const longitude = parseNumber(geo.longitude);
      const altitude = geo.altitude.trim() ? parseNumber(geo.altitude) : 0;
      if (
        !body ||
        latitude === null ||
        longitude === null ||
        altitude === null ||
        body.radius + altitude <= 0 ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      ) {
        setError(t("manual.invalidGeo"));
        return;
      }
      const position = fromGeo({ latitude, longitude, altitude }, body);
      onPick({
        name: label,
        systemSlug: body.systemSlug,
        position: { body: body.slug, ...position },
      });
      return;
    }

    const point = parseXyz(xyz, unit);
    if (!point) {
      setError(t("manual.invalidXyz"));
      return;
    }
    // Close to a body, the point turns with it from now on.
    const position = positionOf(
      { ...point, at: pastedAt ?? Date.now() },
      bodies,
    );
    onPick({
      name: label,
      systemSlug: bodyAt(point, bodies)?.systemSlug ?? system ?? undefined,
      position,
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3"
    >
      <PickerHeader title={t("coordinatesTitle")} onCancel={onCancel} />

      <div className="flex shrink-0 gap-1 rounded-lg border border-white/10 p-0.5 text-[12px]">
        {(["body", "space"] as const).map((one) => (
          <button
            key={one}
            type="button"
            aria-pressed={mode === one}
            // Without the planets and moons from the site, only system
            // coordinates can be placed.
            disabled={one === "body" && noBodies}
            onClick={() => {
              setMode(one);
              setError(null);
            }}
            className={cn(
              "flex-1 rounded-md px-2 py-1 transition disabled:opacity-40",
              mode === one
                ? "bg-white/15 text-slate-100"
                : "text-slate-400 hover:bg-white/10",
            )}
          >
            {one === "body" ? t("manual.onBody") : t("manual.inSpace")}
          </button>
        ))}
      </div>

      {noBodies ? (
        <p className="text-[11px] text-amber-200">
          {loadFailed ? t("manual.bodiesFailed") : t("manual.noBodies")}
          {loadFailed ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="ml-1 underline underline-offset-2 hover:text-amber-100 disabled:no-underline disabled:opacity-60"
            >
              {retrying ? "…" : t("retry")}
            </button>
          ) : null}
        </p>
      ) : null}

      {mode === "body" ? (
        <>
          <label className="space-y-0.5 text-[11px] text-slate-400">
            <span>{t("manual.body")}</span>
            <select
              value={bodySlug}
              onChange={(event) => {
                setBodySlug(event.target.value);
                setError(null);
              }}
              className={cn(FIELD, "block w-full")}
            >
              {groups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.list.map((one) => (
                    <option key={one.slug} value={one.slug}>
                      {one.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="flex shrink-0 gap-3 text-[11px] text-slate-400">
            {(["local", "geo"] as const).map((one) => (
              <label key={one} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="bodyInput"
                  checked={bodyInput === one}
                  onChange={() => {
                    setBodyInput(one);
                    setError(null);
                  }}
                />
                {one === "local" ? t("manual.localXyz") : t("manual.latLong")}
              </label>
            ))}
          </div>
          {bodyInput === "local" ? (
            <>
              <XyzFields
                value={local}
                unit={localUnit}
                onChange={(value) => {
                  setLocal(value);
                  setError(null);
                }}
                onUnit={setLocalUnit}
                onPaste={pastedLocal}
              />
              <p className="text-[11px] text-slate-500">
                {t("manual.localHint")}
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {(["latitude", "longitude", "altitude"] as const).map((key) => (
                  <label
                    key={key}
                    className="space-y-0.5 text-[11px] text-slate-400"
                  >
                    <span>{t(`manual.${key}`)}</span>
                    <input
                      value={geo[key]}
                      inputMode="decimal"
                      autoFocus={key === "latitude"}
                      placeholder={key === "altitude" ? "0" : undefined}
                      onChange={(event) => {
                        setGeo({ ...geo, [key]: event.target.value });
                        setError(null);
                      }}
                      className={cn(FIELD, "block w-full")}
                    />
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                {t("manual.bodyHint")}
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <XyzFields
            value={xyz}
            unit={unit}
            onChange={(value) => {
              setXyz(value);
              setPastedAt(null);
              setError(null);
            }}
            onUnit={(value) => {
              setUnit(value);
              setPastedAt(null);
            }}
            onPaste={pasted}
          />
          <p className="text-[11px] text-slate-500">{t("manual.spaceHint")}</p>
        </>
      )}

      <label className="space-y-0.5 text-[11px] text-slate-400">
        <span>{t("manual.name")}</span>
        <input
          value={name}
          maxLength={60}
          placeholder={t("manualName")}
          onChange={(event) => setName(event.target.value)}
          className={cn(FIELD, "block w-full")}
        />
      </label>

      {error ? <p className="text-[12px] text-red-300">{error}</p> : null}

      <button
        type="submit"
        className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-sky-300/40 bg-sky-300/10 px-3 py-1.5 text-[12px] font-medium transition hover:bg-sky-300/20"
      >
        <Navigation className="size-3.5" />
        {t("manual.go")}
      </button>
    </form>
  );
}

const FIELD =
  "min-w-0 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[13px] text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none";

function asFields(point: { x: number; y: number; z: number }): Xyz {
  return { x: String(point.x), y: String(point.y), z: String(point.z) };
}

/** The three fields in metres, or `null` if one is not a number. */
function parseXyz(
  value: Xyz,
  unit: Unit,
): { x: number; y: number; z: number } | null {
  const factor = unit === "km" ? 1000 : 1;
  const [x, y, z] = [value.x, value.y, value.z].map(parseNumber);
  if (x === null || y === null || z === null) return null;
  return { x: x * factor, y: y * factor, z: z * factor };
}

/** X, Y, Z and their unit; a pasted line of the game can fill all three. */
function XyzFields({
  value,
  unit,
  onChange,
  onUnit,
  onPaste,
}: {
  value: Xyz;
  unit: Unit;
  onChange: (value: Xyz) => void;
  onUnit: (unit: Unit) => void;
  onPaste: (event: ClipboardEvent) => void;
}) {
  const t = useTranslations("NpsOverlay");
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-1.5">
      {(["x", "y", "z"] as const).map((key) => (
        <label key={key} className="space-y-0.5 text-[11px] text-slate-400">
          <span>{key.toUpperCase()}</span>
          <input
            value={value[key]}
            inputMode="decimal"
            autoFocus={key === "x"}
            onPaste={onPaste}
            onChange={(event) =>
              onChange({ ...value, [key]: event.target.value })
            }
            className={cn(FIELD, "block w-full")}
          />
        </label>
      ))}
      <select
        value={unit}
        onChange={(event) => onUnit(event.target.value as Unit)}
        aria-label={t("manual.unit")}
        className={cn(FIELD, "px-1")}
      >
        <option value="m">m</option>
        <option value="km">km</option>
      </select>
    </div>
  );
}
