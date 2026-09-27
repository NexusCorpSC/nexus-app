import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import {
  Container,
  Map as MapIcon,
  NotebookPen,
  Route as RouteIcon,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { Button, Card, Kbd, SectionTitle } from "@/components/ui";
import { getMySquad } from "@/lib/api/squads";
import { noteQueryKey, readNote } from "@/lib/notes";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getShortcuts,
  type Shortcuts,
} from "@/lib/settings";
import { cn } from "@/lib/utils";
import { showOverlay, type OverlayLabel } from "@/lib/windows";
import type { Squad } from "@/types/nexus";

/** The windows worth opening before the game, with the shortcut each has. */
const LAUNCHERS: {
  label: OverlayLabel;
  title: string;
  icon: LucideIcon;
  shortcut: keyof Shortcuts;
}[] = [
  { label: "overlay", title: "Recherche", icon: Search, shortcut: "search" },
  { label: "squad", title: "Escouade", icon: Users, shortcut: "squad" },
  { label: "map", title: "Carte", icon: MapIcon, shortcut: "map" },
  { label: "plan", title: "Plan de vol", icon: RouteIcon, shortcut: "plan" },
  { label: "notes", title: "Bloc-notes", icon: NotebookPen, shortcut: "notes" },
  { label: "cargo", title: "Cargo", icon: Container, shortcut: "cargo" },
];

const DATABASE: { to: string; title: string; detail: string }[] = [
  { to: "/blueprints", title: "Blueprints", detail: "Recettes et possession" },
  { to: "/items", title: "Objets", detail: "Où les acheter, à quel prix" },
  { to: "/places", title: "Lieux", detail: "Stations, villes, cartes" },
  { to: "/missions", title: "Missions", detail: "Récompenses et blueprints" },
];

/** How often the squad card rereads the squad while the page is open. */
const SQUAD_REFRESH_MS = 30_000;

function open(label: OverlayLabel) {
  void showOverlay(label).catch((error) =>
    console.error(`cannot open the ${label} overlay`, error),
  );
}

/**
 * The first screen: the overlays to open before launching the game, where the
 * squad stands, the start of the notes, and the way into the database.
 */
export default function HomePage() {
  const { user, loading } = useAuth();
  const signedIn = Boolean(user);

  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void getShortcuts().then(setShortcuts);
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="flex flex-col gap-7">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[30px] leading-tight font-bold text-nexus-white">
            {user ? `Bonjour, ${user.name}` : "Bienvenue"}
          </h1>
          <p className="mt-1 text-sm text-nexus-muted">
            Tout ce qu'il faut avant de lancer le jeu, et les fenêtres à garder
            par-dessus.
          </p>
        </div>
        {version ? (
          <span className="rounded-full border border-nexus-accent/14 bg-nexus-accent/8 px-2.5 py-1 font-mono text-[11px] text-nexus-accent/70">
            v{version}
          </span>
        ) : null}
      </header>

      <section>
        <SectionTitle
          aside={
            <>
              En jeu, maintenez{" "}
              <span className="font-mono text-nexus-bright">
                {formatShortcut(shortcuts.radial)}
              </span>{" "}
              pour le menu radial
            </>
          }
        >
          Superpositions
        </SectionTitle>
        <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
          {LAUNCHERS.map(({ label, title, icon: Icon, shortcut }) => (
            <button
              key={label}
              type="button"
              onClick={() => open(label)}
              className="flex h-26 flex-col items-start justify-between rounded-xl border border-nexus-accent/12 bg-nexus-card p-3.5 text-left transition-colors hover:border-nexus-accent/35"
            >
              <Icon className="size-5 text-nexus-accent" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-nexus-white">
                  {title}
                </span>
                <Kbd>{formatShortcut(shortcuts[shortcut])}</Kbd>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <SquadCard signedIn={signedIn} sessionLoading={loading} />
        <NotesCard signedIn={signedIn} sessionLoading={loading} />
      </div>

      <section>
        <SectionTitle>Base de données</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {DATABASE.map(({ to, title, detail }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-col gap-1 rounded-xl border border-nexus-accent/10 bg-nexus-accent/5 px-4 py-3.5 transition-colors hover:border-nexus-accent/30"
            >
              <span className="text-sm font-semibold text-nexus-white">
                {title}
              </span>
              <span className="text-xs text-nexus-muted">{detail}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Where the squad stands, at a glance.
 *
 * Read on its own rather than through `useSquad`: that hook steers which squad
 * the event stream follows, and the squad overlay is the one that decides. This
 * card only reads the squad the API picks — the only one, for nearly everybody.
 */
function SquadCard({
  signedIn,
  sessionLoading,
}: {
  signedIn: boolean;
  sessionLoading: boolean;
}) {
  const query = useQuery({
    queryKey: ["home", "squad"],
    queryFn: () => getMySquad(null),
    enabled: signedIn,
    refetchInterval: SQUAD_REFRESH_MS,
  });

  const squad: Squad | null = query.data?.squad ?? null;
  const ready = squad
    ? squad.members.filter((member) => member.ready && member.alive).length
    : 0;

  return (
    <Card className="flex flex-col gap-3.5 px-5 py-4.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-semibold text-nexus-white">
            {squad ? squad.name : "Escouade"}
          </h2>
          {squad ? (
            <p className="text-xs text-nexus-muted">
              Code d'invitation{" "}
              <span className="font-mono text-nexus-bright">{squad.code}</span>
            </p>
          ) : null}
        </div>
        {squad ? (
          <span className="shrink-0 rounded-full bg-emerald-300/12 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            {ready}/{squad.members.length} prêts
          </span>
        ) : null}
      </div>

      {sessionLoading || (signedIn && query.isPending) ? (
        <p className="text-sm text-nexus-dim">Chargement…</p>
      ) : !signedIn ? (
        <p className="text-sm text-nexus-muted">
          Connectez-vous pour retrouver votre escouade.
        </p>
      ) : !squad ? (
        <p className="text-sm text-nexus-muted">
          Vous n'êtes dans aucune escouade. Créez-en une ou rejoignez-la depuis
          la superposition.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
          {squad.members.map((member) => {
            const down = !member.alive;
            const isReady = member.ready && member.alive;
            return (
              <li
                key={member.userId}
                className={cn(
                  "flex min-w-0 items-center gap-2",
                  down
                    ? "text-red-300 line-through decoration-red-300/60"
                    : isReady
                      ? "text-emerald-300"
                      : "text-nexus-bright",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    down
                      ? "bg-red-300"
                      : isReady
                        ? "bg-emerald-300"
                        : "bg-nexus-dim",
                  )}
                />
                <span className="truncate">{member.name}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto flex gap-2 pt-1">
        <Button size="sm" onClick={() => open("squad")}>
          Ouvrir la superposition
        </Button>
        {squad ? (
          <Button size="sm" variant="outline" onClick={() => open("plan")}>
            Plan de vol
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** The first lines of the note, headings kept as headings. */
function NotesCard({
  signedIn,
  sessionLoading,
}: {
  signedIn: boolean;
  sessionLoading: boolean;
}) {
  const query = useQuery({
    queryKey: noteQueryKey(signedIn),
    queryFn: () => readNote(signedIn),
    enabled: !sessionLoading,
  });

  const lines = (query.data?.content ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  const saved = query.data?.updatedAt
    ? new Date(query.data.updatedAt).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;

  return (
    <Card className="flex flex-col gap-3 px-5 py-4.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-nexus-white">
          Bloc-notes
        </h2>
        {saved ? (
          <span className="text-xs text-nexus-dim">Enregistré {saved}</span>
        ) : null}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-nexus-muted">
          {/* The query waits for the session, and is not pending meanwhile. */}
          {sessionLoading || query.isPending
            ? "Chargement…"
            : "Rien de noté pour l'instant."}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5 text-[13.5px] leading-relaxed text-nexus-bright">
          {lines.map((line, index) => {
            const heading = /^#{1,6}\s+/.test(line);
            const text = line
              .replace(/^#{1,6}\s+/, "")
              .replace(/^[-*]\s+/, "• ")
              .replace(/\*\*(.+?)\*\*/g, "$1")
              .replace(/[*_`]/g, "");
            return (
              <p
                key={index}
                className={cn(
                  "truncate",
                  heading &&
                    "font-display text-[15px] font-semibold text-nexus-white",
                )}
              >
                {text}
              </p>
            );
          })}
        </div>
      )}

      <div className="mt-auto flex gap-2 pt-1">
        <Link
          to="/notes"
          className="inline-flex h-8 items-center rounded-lg border border-nexus-accent/25 px-3 text-xs font-medium text-nexus-bright transition-colors hover:border-nexus-accent/45"
        >
          Ouvrir le bloc-notes
        </Link>
      </div>
    </Card>
  );
}
