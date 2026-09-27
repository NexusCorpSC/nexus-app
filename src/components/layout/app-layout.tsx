import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
  formatShortcut,
  getNotificationCorner,
  getOverlayOpacity,
  getShortcuts,
  setOverlayOpacity,
} from "@/lib/settings";
import { applyNotificationCorner } from "@/lib/notifications";
import { applyShortcuts } from "@/lib/shortcuts";
import {
  applyOverlayOpacity,
  OVERLAY_OPACITY_EVENT,
  type OverlayOpacity,
} from "@/lib/overlay-opacity";
import {
  Archive,
  Container,
  Flag,
  Hammer,
  House,
  LogIn,
  Map as MapIcon,
  MapPin,
  NotebookPen,
  Package,
  Rocket,
  Search,
  Settings as SettingsIcon,
  Star,
  Users,
} from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { Spinner } from "@/components/ui";
import { useUpdateWatcher } from "@/hooks/use-update-watcher";
import { usePresenceRenewal } from "@/hooks/use-presence";
import { SessionMenu } from "@/components/layout/session-menu";
import { useBlueprintOwnershipSync } from "@/hooks/use-blueprint-ownership";
import { cn } from "@/lib/utils";
import { showOverlay, type OverlayLabel } from "@/lib/windows";
import nexusLogo from "@/assets/nexus-logo.png";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Hammer;
  /** Hidden while signed out. */
  requiresAuth?: boolean;
};

type NavGroup = { title: string | null; items: NavItem[] };

/**
 * The menu, in the order a session goes: the home page, then what the game
 * is made of, then what is the reader's own.
 */
const NAV_GROUPS: NavGroup[] = [
  { title: null, items: [{ to: "/home", label: "Accueil", icon: House }] },
  {
    title: "Base de données",
    items: [
      { to: "/blueprints", label: "Blueprints", icon: Hammer },
      { to: "/items", label: "Objets", icon: Package },
      { to: "/places", label: "Lieux", icon: MapPin },
      { to: "/missions", label: "Missions", icon: Rocket },
      { to: "/factions", label: "Factions", icon: Flag },
    ],
  },
  {
    title: "Mon espace",
    items: [
      {
        to: "/inventory",
        label: "Inventaire",
        icon: Archive,
        requiresAuth: true,
      },
      {
        to: "/reputations",
        label: "Réputations",
        icon: Star,
        requiresAuth: true,
      },
      { to: "/notes", label: "Bloc-notes", icon: NotebookPen },
      { to: "/cargo", label: "Cargo", icon: Container },
      { to: "/orgs", label: "Organisations", icon: Users },
    ],
  },
];

/** The two overlays the menu opens directly: the ones used in every session. */
const MENU_OVERLAYS: { label: OverlayLabel; title: string; icon: typeof Hammer }[] =
  [
    { label: "squad", title: "Escouade", icon: Users },
    { label: "map", title: "Carte", icon: MapIcon },
  ];

function open(label: OverlayLabel) {
  void showOverlay(label).catch((error) =>
    console.error(`cannot open the ${label} overlay`, error),
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
    isActive
      ? "bg-nexus-accent/13 font-medium text-nexus-white"
      : "text-nexus-accent/70 hover:bg-nexus-accent/8 hover:text-nexus-bright",
  );
}

/** Route requests sent by the overlay when a search result is picked. */
const NAVIGATE_EVENT = "main://navigate";

export default function AppLayout() {
  const { user, loading, signOut, signIn } = useAuth();
  const navigate = useNavigate();

  // Only the main window looks: the check is per application, not per window,
  // and this is the one that can show what to do about it.
  useUpdateWatcher();

  // A declaration of playing stays alive while this window does.
  usePresenceRenewal(Boolean(user));

  // A blueprint added from the search palette is added in another window, so
  // the screens here have to be told: the query client never refetches on
  // focus, and would keep showing it as not owned.
  useBlueprintOwnershipSync();

  useEffect(() => {
    const pending = listen<string>(NAVIGATE_EVENT, (event) => {
      navigate(event.payload);
    });
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [navigate]);

  // Rust binds the defaults at startup; the stored combinations replace them as
  // soon as the main window can read the settings store. Rejections are not
  // raised here — Settings lists them, where they can be acted on.
  const [searchShortcut, setSearchShortcut] = useState<string | null>(null);

  useEffect(() => {
    void getShortcuts()
      .then((shortcuts) => {
        // Tight, to fit beside the label in the menu's width.
        setSearchShortcut(
          formatShortcut(shortcuts.search).replace(/ \+ /g, "+"),
        );
        return applyShortcuts(shortcuts);
      })
      .catch((error) => console.error("cannot apply shortcuts", error));
  }, []);

  // Same handover for the notification corner: Rust starts in the bottom-right
  // one and takes the stored choice as soon as the store can be read.
  useEffect(() => {
    void getNotificationCorner()
      .then(applyNotificationCorner)
      .catch((error) =>
        console.error("cannot apply the notification corner", error),
      );
  }, []);

  // And for the overlay opacity, with a second half the other two do not need:
  // it is flipped from the overlays themselves and by a global shortcut, so
  // this window also has to write down what it becomes. Rust holds what is in
  // force; the store is only its memory across restarts, and this window is the
  // one that owns it.
  useEffect(() => {
    // What the store already holds. The handover below makes Rust broadcast it
    // straight back, and every later event that changes nothing would be
    // written again — the store saves itself on each `set`, so an unchanged
    // value must not reach it.
    let saved: string | null = null;

    void getOverlayOpacity()
      .then((opacity) => {
        saved = JSON.stringify(opacity);
        return applyOverlayOpacity(opacity);
      })
      .catch((error) =>
        console.error("cannot apply the overlay opacity", error),
      );

    const pending = listen<OverlayOpacity>(OVERLAY_OPACITY_EVENT, (event) => {
      const announced = JSON.stringify(event.payload);
      if (announced === saved) return;

      // Recorded before the write rather than after: two events in a row must
      // not both get through while the first is still being written.
      saved = announced;

      void setOverlayOpacity(event.payload).catch((error) => {
        console.error("cannot save the overlay opacity", error);
        // Nothing was written, so nothing is known to be on disk: let the next
        // event try again rather than trusting a save that did not happen.
        if (saved === announced) saved = null;
      });
    });

    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <div className="flex h-full">
      <aside className="flex w-58 shrink-0 flex-col border-r border-nexus-accent/8 bg-nexus-night">
        <div className="flex items-center gap-2.5 px-4.5 pt-4.5 pb-3.5">
          <img src={nexusLogo} alt="" className="size-8 shrink-0" />
          <div className="flex flex-col">
            <span className="font-display text-[17px] leading-tight font-bold tracking-[0.06em] text-nexus-white">
              NEXUS
            </span>
            <span className="text-[10px] tracking-[0.14em] text-nexus-dim uppercase">
              Star Citizen Tools
            </span>
          </div>
        </div>

        <div className="px-3 pb-2.5">
          <button
            type="button"
            onClick={() => open("overlay")}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-nexus-accent/12 bg-nexus-accent/6 px-2.5 text-[13px] text-nexus-accent/70 transition-colors hover:border-nexus-accent/30 hover:text-nexus-bright"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Rechercher…</span>
            {searchShortcut ? (
              <span className="shrink-0 font-mono text-[10px] whitespace-nowrap text-nexus-dim">
                {searchShortcut}
              </span>
            ) : null}
          </button>
        </div>

        <nav
          aria-label="Navigation principale"
          className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-3 py-1"
        >
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(
              (item) => !item.requiresAuth || user,
            );
            if (items.length === 0) return null;

            return (
              <div key={group.title ?? "top"} className="flex flex-col gap-0.5">
                {group.title ? (
                  <p className="px-2.5 pb-1 font-display text-[10.5px] font-semibold tracking-[0.14em] text-nexus-dim/90 uppercase">
                    {group.title}
                  </p>
                ) : null}
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} className={navClass}>
                    <Icon className="size-4" />
                    {label}
                  </NavLink>
                ))}
              </div>
            );
          })}

          <div className="flex flex-col gap-1.5">
            <p className="px-2.5 font-display text-[10.5px] font-semibold tracking-[0.14em] text-nexus-dim/90 uppercase">
              En jeu
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {MENU_OVERLAYS.map(({ label, title, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => open(label)}
                  title={`Afficher la superposition ${title}`}
                  className="flex h-13 flex-col items-center justify-center gap-1 rounded-lg border border-nexus-accent/14 bg-nexus-accent/7 text-xs font-medium text-nexus-bright transition-colors hover:border-nexus-accent/35 hover:bg-nexus-accent/12"
                >
                  <Icon className="size-4 text-nexus-accent" />
                  {title}
                </button>
              ))}
            </div>
          </div>
        </nav>

        <div className="relative flex items-center gap-2.5 border-t border-nexus-accent/8 px-3.5 py-3">
          {loading ? (
            <div className="flex flex-1 items-center gap-2 text-sm text-nexus-dim">
              <Spinner />
              Session…
            </div>
          ) : user ? (
            <SessionMenu name={user.name} onSignOut={() => void signOut()} />
          ) : (
            <button
              type="button"
              onClick={() => {
                navigate("/login");
                void signIn();
              }}
              className="flex h-8 flex-1 items-center gap-2 rounded-lg px-2 text-[13px] text-nexus-accent/70 transition-colors hover:bg-nexus-accent/8 hover:text-nexus-bright"
            >
              <LogIn className="size-4" />
              Se connecter
            </button>
          )}

          <NavLink
            to="/settings"
            aria-label="Paramètres"
            title="Paramètres"
            className={({ isActive }) =>
              cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "bg-nexus-accent/13 text-nexus-white"
                  : "text-nexus-accent/70 hover:bg-nexus-accent/8 hover:text-nexus-bright",
              )
            }
          >
            <SettingsIcon className="size-4" />
          </NavLink>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-10 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
