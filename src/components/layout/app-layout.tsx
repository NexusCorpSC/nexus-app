import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { useTranslations } from "use-intl";
import {
  House,
  LogIn,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getMicrophone,
  getNotificationCorner,
  getOverlayOpacity,
  getShortcuts,
  setOverlayOpacity,
  type Shortcuts,
} from "@/lib/settings";
import { applyNotificationCorner } from "@/lib/notifications";
import { applyMicrophone } from "@/lib/chat-voice";
import { applyShortcuts } from "@/lib/shortcuts";
import {
  applyOverlayOpacity,
  OVERLAY_OPACITY_EVENT,
  type OverlayOpacity,
} from "@/lib/overlay-opacity";
import { useAuth } from "@/auth/auth-context";
import { Spinner } from "@/components/ui";
import { RailThemeChip } from "@/components/theme/rail-theme-chip";
import { useUpdateWatcher } from "@/hooks/use-update-watcher";
import { useContribWatcher } from "@/hooks/use-contrib-watcher";
import { useInvitationsWatcher } from "@/hooks/use-invitations-watcher";
import { useOrdersWatcher } from "@/hooks/use-orders-watcher";
import { useRequestsWatcher } from "@/hooks/use-requests-watcher";
import {
  useReadyRefiningCount,
  useRefiningWatcher,
} from "@/hooks/use-refining-watcher";
import { usePresenceRenewal } from "@/hooks/use-presence";
import { useFriends } from "@/hooks/use-friends";
import {
  activeGroupForPath,
  isNavItemActive,
  NAV_GROUPS,
  QUICK_OVERLAYS,
  type NavGroup,
  type NavGroupId,
} from "@/components/layout/navigation";
import { OverlaysPopover } from "@/components/layout/overlays-popover";
import { SessionMenu } from "@/components/layout/session-menu";
import { useBlueprintOwnershipSync } from "@/hooks/use-blueprint-ownership";
import { useGameLog } from "@/hooks/use-game-log";
import { syncTelemetry } from "@/lib/telemetry";
import { useNavigationTracker } from "@/hooks/use-navigation-tracker";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";
import { cn } from "@/lib/utils";
import { showOverlay, type OverlayLabel } from "@/lib/windows";
import nexusLogo from "@/assets/nexus-logo.png";

function open(label: OverlayLabel) {
  void showOverlay(label).catch((error) =>
    console.error(`cannot open the ${label} overlay`, error),
  );
}

/** Route requests sent by the overlay when a search result is picked. */
const NAVIGATE_EVENT = "main://navigate";

function railButtonClass(isActive: boolean) {
  return cn(
    "relative flex w-[60px] flex-col items-center gap-1 rounded-nexus-sm border px-1 py-2 transition-colors",
    isActive
      ? "border-nexus-accent/22 bg-nexus-accent/14 text-nexus-white"
      : "border-transparent text-nexus-accent/65 hover:bg-nexus-accent/8 hover:text-nexus-bright",
  );
}

export default function AppLayout() {
  const t = useTranslations("Layout");
  const { user, loading, signOut, signIn } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useNavigationTracker();
  const mainRef = useRef<HTMLElement>(null);
  useScrollRestoration(mainRef);

  const activeGroup = activeGroupForPath(pathname);
  const activeGroupId = activeGroup?.id ?? null;

  // Remembers the last page visited in each pole during this session so
  // switching back to a pole returns the reader right where they left off.
  const lastRouteByGroup = useRef<Partial<Record<NavGroupId, string>>>({});
  useEffect(() => {
    if (activeGroupId) {
      lastRouteByGroup.current[activeGroupId] = pathname;
    }
  }, [activeGroupId, pathname]);

  // Re-clicking the active pole collapses its contextual panel to give more
  // room on narrow screens; switching to another pole opens it again.
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const prevGroupId = useRef<NavGroupId | null>(activeGroupId);
  useEffect(() => {
    if (activeGroupId !== prevGroupId.current) {
      setPanelCollapsed(false);
      prevGroupId.current = activeGroupId;
    }
  }, [activeGroupId]);

  // Only the main window looks: the check is per application, not per window,
  // and this is the one that can show what to do about it.
  useUpdateWatcher();

  // A declaration of playing stays alive while this window does.
  usePresenceRenewal(Boolean(user));

  // How many friends are playing, beside «Amis» and on the Social rail pole.
  const friends = useFriends(Boolean(user));
  const friendsPlaying =
    friends.data?.filter((friend) => friend.playing).length ?? 0;

  // A blueprint added from the search palette is added in another window, so
  // the screens here have to be told: the query client never refetches on
  // focus, and would keep showing it as not owned.
  useBlueprintOwnershipSync();

  // Star Citizen's own log, followed from Rust: a blueprint received in game is
  // offered for «mes blueprints» from here, the window holding the session.
  useGameLog(Boolean(user));

  // The game's telemetry, held from Rust: it starts once this window has
  // opened the settings store it reads.
  useEffect(() => {
    void syncTelemetry().catch((error) =>
      console.error("cannot follow the game telemetry", error),
    );
  }, []);

  // What became of the player's contributions on the site: published, sent
  // back, an achievement, a level. Read from here, the window with the session.
  useContribWatcher(user?.id ?? null);
  useInvitationsWatcher(user?.id ?? null);
  useOrdersWatcher(user?.id ?? null);
  useRequestsWatcher(user?.id ?? null);
  // Refining orders reaching their end, told from here as well.
  useRefiningWatcher(user?.id ?? null);

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
  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);

  useEffect(() => {
    void getShortcuts()
      .then((loaded) => {
        setShortcuts(loaded);
        return applyShortcuts(loaded);
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

  // And for the microphone Nexus Chat listens to: the system's default one
  // until the stored choice is read.
  useEffect(() => {
    void getMicrophone()
      .then(applyMicrophone)
      .catch((error) => console.error("cannot apply the microphone", error));
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

  function visibleItemsOf(group: NavGroup) {
    return group.items.filter((item) => !item.requiresAuth || user);
  }

  function handlePoleClick(group: NavGroup) {
    const visible = visibleItemsOf(group);
    if (visible.length === 0) return;

    if (activeGroupId === group.id) {
      setPanelCollapsed((collapsed) => !collapsed);
      return;
    }

    const remembered = lastRouteByGroup.current[group.id];
    const canReuseRemembered =
      remembered && visible.some((item) => isNavItemActive(item, remembered));
    setPanelCollapsed(false);
    navigate(canReuseRemembered ? remembered : visible[0].to);
  }

  const searchShortcut = formatShortcut(shortcuts.search).replace(/ \+ /g, "+");
  const isHome = pathname === "/home";
  const subPanelItems = activeGroup ? visibleItemsOf(activeGroup) : [];
  const showSubPanel =
    Boolean(activeGroup) && !panelCollapsed && subPanelItems.length > 0;

  return (
    <div className="flex h-full">
      {/* Primary navigation rail: fixed width, never scrolls even at 600px height. */}
      <aside className="relative z-20 flex w-[74px] shrink-0 flex-col items-center gap-1.5 border-r border-nexus-accent/9 bg-nexus-rail px-1.5 py-3">
        <NavLink
          to="/home"
          title="NEXUS — Star Citizen Tools"
          aria-label={t("nav.home")}
          className="mb-1 flex size-9 shrink-0 items-center justify-center rounded-nexus transition-transform hover:scale-105"
        >
          <img src={nexusLogo} alt="" className="size-8 shrink-0" />
        </NavLink>

        <button
          type="button"
          onClick={() => open("overlay")}
          title={t("searchWithShortcut", { shortcut: searchShortcut })}
          className="mb-0.5 flex w-[60px] flex-col items-center gap-1 rounded-nexus-sm border border-nexus-accent/14 bg-nexus-accent/6 px-1 py-2 text-nexus-accent/70 transition-colors hover:border-nexus-accent/30 hover:bg-nexus-accent/12 hover:text-nexus-white"
        >
          <Search className="size-[16px]" />
          <span className="text-center text-[10.5px] leading-[1.1] font-medium">
            {t("rail.search")}
          </span>
        </button>

        <nav
          aria-label={t("mainNav")}
          className="flex flex-col items-center gap-1.5"
        >
          <NavLink
            to="/home"
            title={t("nav.home")}
            className={railButtonClass(isHome)}
          >
            {isHome ? <ActiveRailBar /> : null}
            <House className="size-[17px]" />
            <span className="text-center text-[10.5px] leading-[1.1] font-medium">
              {t("rail.home")}
            </span>
          </NavLink>

          {NAV_GROUPS.map((group) => {
            const visible = visibleItemsOf(group);
            if (visible.length === 0) return null;

            const Icon = group.icon;
            const isActive = activeGroupId === group.id;

            return (
              <button
                key={group.id}
                type="button"
                aria-current={isActive ? "true" : undefined}
                title={t(`groups.${group.id}`)}
                onClick={() => handlePoleClick(group)}
                className={railButtonClass(isActive)}
              >
                {isActive ? <ActiveRailBar /> : null}
                <Icon className="size-[17px]" />
                <span className="text-center text-[10.5px] leading-[1.1] font-medium">
                  {t(`rail.${group.id}`)}
                </span>

                {group.id === "economy" ? (
                  <RefiningReadyBadge userId={user?.id} variant="mini" />
                ) : null}

                {group.id === "community" && friendsPlaying > 0 ? (
                  <span
                    title={t("friendsPlaying", { count: friendsPlaying })}
                    className="absolute top-1 right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-300 px-1 font-mono text-[10px] font-bold text-[#053527] ring-2 ring-nexus-rail"
                  >
                    {friendsPlaying}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="my-1 h-px w-9 bg-nexus-accent/12" />

        <OverlaysPopover shortcuts={shortcuts} onOpenOverlay={open} />

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-1.5">
          <RailThemeChip />
          {loading ? (
            <div
              title={t("sessionLoading")}
              aria-label={t("sessionLoading")}
              className="flex size-9 items-center justify-center text-nexus-dim"
            >
              <Spinner />
            </div>
          ) : user ? (
            <SessionMenu name={user.name} onSignOut={() => void signOut()} />
          ) : (
            <button
              type="button"
              title={t("signIn")}
              aria-label={t("signIn")}
              onClick={() => {
                navigate("/login");
                void signIn();
              }}
              className="flex size-9 items-center justify-center rounded-full border border-nexus-accent/18 bg-nexus-accent/6 text-nexus-accent/75 transition-colors hover:border-nexus-accent/35 hover:bg-nexus-accent/12 hover:text-nexus-white"
            >
              <LogIn className="size-4" />
            </button>
          )}

          <NavLink
            to="/settings"
            aria-label={t("settings")}
            title={t("settings")}
            className={({ isActive }) =>
              cn(
                "flex size-8 shrink-0 items-center justify-center rounded-nexus-sm border transition-colors",
                isActive
                  ? "border-nexus-accent/24 bg-nexus-accent/15 text-nexus-white"
                  : "border-transparent text-nexus-accent/65 hover:bg-nexus-accent/8 hover:text-nexus-bright",
              )
            }
          >
            <SettingsIcon className="size-4" />
          </NavLink>
        </div>
      </aside>

      {/* Contextual sub-panel for the active pole (hidden on Home/Settings). */}
      {showSubPanel && activeGroup ? (
        <aside
          aria-label={t(`groups.${activeGroup.id}`)}
          className="flex w-[216px] shrink-0 flex-col border-r border-nexus-accent/9 bg-nexus-night px-3 py-4"
        >
          <div className="mb-3 border-b border-nexus-accent/8 px-2 pb-3">
            <h2 className="nexus-label text-[13px] font-bold text-nexus-white">
              {t(`groups.${activeGroup.id}`)}
            </h2>
            <p className="mt-1 text-[11.5px] leading-snug text-nexus-dim">
              {t(`groupBlurb.${activeGroup.id}`)}
            </p>
          </div>

          <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
            {subPanelItems.map((item) => {
              const Icon = item.icon;
              const isActive = isNavItemActive(item, pathname);

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[9px] border px-2.5 py-2 text-[13px] transition-colors",
                    isActive
                      ? "border-nexus-accent/20 bg-nexus-accent/14 font-medium text-nexus-white"
                      : "border-transparent text-nexus-accent/72 hover:bg-nexus-accent/8 hover:text-nexus-bright",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-nexus-accent" : "text-current",
                    )}
                  />
                  <span className="flex-1 truncate">
                    {t(`nav.${item.label}`)}
                  </span>

                  {item.to === "/friends" && friendsPlaying > 0 ? (
                    <span
                      title={t("friendsPlaying", { count: friendsPlaying })}
                      className="flex items-center gap-1 rounded-full bg-emerald-300/14 px-1.5 text-[11px] font-medium text-emerald-300"
                    >
                      <span className="size-1.5 rounded-full bg-emerald-300" />
                      {friendsPlaying}
                    </span>
                  ) : null}

                  {item.to === "/refining" ? (
                    <RefiningReadyBadge userId={user?.id} variant="pill" />
                  ) : null}
                </NavLink>
              );
            })}
          </div>

          <div className="mt-3 flex flex-col gap-1.5 border-t border-nexus-accent/8 pt-3">
            <p className="nexus-label px-1 text-[10px] font-semibold text-nexus-dim">
              {t("overlaysDrawer.quickAccess")}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_OVERLAYS.map(({ label, icon: Icon }) => {
                const name = t(`overlays.${label}`);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => open(label)}
                    title={t("showOverlay", { name })}
                    className="flex h-8.5 items-center justify-center gap-1.5 rounded-nexus-sm border border-nexus-accent/15 bg-nexus-accent/7 px-1.5 text-[11.5px] font-medium text-nexus-bright transition-colors hover:border-nexus-accent/35 hover:bg-nexus-accent/14 hover:text-nexus-white"
                  >
                    <Icon className="size-3.5 shrink-0 text-nexus-accent" />
                    <span className="truncate">{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      ) : null}

      <main ref={mainRef} className="nexus-backdrop flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-6 xl:px-10 xl:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** Luminous vertical accent bar anchored to the left edge of the active rail item. */
function ActiveRailBar() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-2.5 bottom-2.5 -left-[7px] w-[3px] rounded-r-full nexus-glow bg-nexus-accent"
    />
  );
}

/**
 * How many refining orders are ready to collect, beside «Raffinage» and on the
 * «Économie» rail pole. Its own component: the clock it reads would otherwise
 * redraw the whole layout.
 */
function RefiningReadyBadge({
  userId,
  variant,
}: {
  userId?: string;
  variant: "pill" | "mini";
}) {
  const t = useTranslations("Layout");
  const ready = useReadyRefiningCount(userId);
  if (ready === 0) return null;

  if (variant === "mini") {
    return (
      <span
        title={t("refiningReady", { count: ready })}
        className="absolute top-1 right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-300 px-1 font-mono text-[10px] font-bold text-[#053527] ring-2 ring-nexus-rail"
      >
        {ready}
      </span>
    );
  }

  return (
    <span
      title={t("refiningReady", { count: ready })}
      className="rounded-full bg-emerald-300 px-1.5 font-mono text-[10.5px] font-semibold text-[#053527]"
    >
      {ready}
    </span>
  );
}
