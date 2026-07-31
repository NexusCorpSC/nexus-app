import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
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
  Boxes,
  Container,
  Flag,
  Hammer,
  LogIn,
  LogOut,
  NotebookPen,
  Rocket,
  Settings as SettingsIcon,
  Star,
  Users,
} from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { Spinner } from "@/components/ui";
import { useUpdateWatcher } from "@/hooks/use-update-watcher";
import { useBlueprintOwnershipSync } from "@/hooks/use-blueprint-ownership";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Hammer;
  /** Hidden while signed out. */
  requiresAuth?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/blueprints", label: "Blueprints", icon: Hammer },
  { to: "/missions", label: "Missions", icon: Rocket },
  { to: "/factions", label: "Factions", icon: Flag },
  { to: "/reputations", label: "Réputations", icon: Star, requiresAuth: true },
  { to: "/inventory", label: "Inventaire", icon: Boxes, requiresAuth: true },
  { to: "/cargo", label: "Cargo", icon: Container },
  { to: "/orgs", label: "Organisations", icon: Users },
  { to: "/notes", label: "Bloc-notes", icon: NotebookPen },
];

/** Route requests sent by the overlay when a search result is picked. */
const NAVIGATE_EVENT = "main://navigate";

export default function AppLayout() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  // Only the main window looks: the check is per application, not per window,
  // and this is the one that can show what to do about it.
  useUpdateWatcher();

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
  useEffect(() => {
    void getShortcuts()
      .then(applyShortcuts)
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
      <aside className="flex w-60 shrink-0 flex-col border-r border-nexus-accent/10 bg-nexus-deep/40">
        <div className="px-5 py-6">
          <p className="text-lg font-bold tracking-tight text-nexus-bright">
            Nexus
          </p>
          <p className="text-[11px] uppercase tracking-widest text-nexus-accent/40">
            Star Citizen Tools
          </p>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.filter((item) => !item.requiresAuth || user).map(
            ({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-nexus-accent/15 text-nexus-bright"
                      : "text-nexus-accent/70 hover:bg-nexus-accent/8 hover:text-nexus-bright",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="space-y-1 border-t border-nexus-accent/10 p-3">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-nexus-accent/15 text-nexus-bright"
                  : "text-nexus-accent/70 hover:bg-nexus-accent/8 hover:text-nexus-bright",
              )
            }
          >
            <SettingsIcon className="h-4 w-4" />
            Paramètres
          </NavLink>

          {loading ? (
            <div className="flex items-center gap-3 px-3 py-2 text-sm text-nexus-accent/50">
              <Spinner />
              Session…
            </div>
          ) : user ? (
            <div className="rounded-lg px-3 py-2">
              <p
                className="truncate text-sm text-nexus-bright"
                title={user.name}
              >
                {user.name}
              </p>
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-1 flex items-center gap-1.5 text-xs text-nexus-accent/50 transition-colors hover:text-nexus-accent"
              >
                <LogOut className="h-3 w-3" />
                Se déconnecter
              </button>
            </div>
          ) : (
            <NavLink
              to="/login"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-nexus-accent/70 transition-colors hover:bg-nexus-accent/8 hover:text-nexus-bright"
            >
              <LogIn className="h-4 w-4" />
              Se connecter
            </NavLink>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
