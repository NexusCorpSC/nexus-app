import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createRaid,
  createRaidSquad,
  createSquad,
  createSquadRole,
  deleteSquadRole,
  getMySquad,
  joinRaid,
  joinSquad,
  leaveRaid,
  leaveSquad,
  removeSquadMember,
  renameSquad,
  setSquadAnnouncements,
  transferSquadLeadership,
  unlinkRaidSquad,
  updateRaid,
  updateSquadMember,
  updateSquadRole,
} from "@/lib/api/squads";
import type {
  Squad,
  SquadMemberPatch,
  SquadRoleIcon,
  SquadView,
} from "@/types/nexus";

/** Emitted by Rust whenever the squad window is shown or hidden. */
const SQUAD_VISIBILITY_EVENT = "squad://visibility";

/** Shared by every squad mutation, so the poll can tell one is running. */
const SQUAD_KEY = ["squad"] as const;

/**
 * The cached view, one per squad the overlay may be looking at.
 *
 * `null` is «whatever the API picks», which is the one squad nearly everyone
 * is in. An organiser who switches to a squad they opened reads under that
 * squad's id, so switching back does not refetch what was already there.
 */
function keyFor(current: string | null) {
  return [...SQUAD_KEY, current ?? ""] as const;
}

/** How often the squad is re-read while the overlay is up. */
const POLL_INTERVAL = 2_000;

/**
 * Whether the squad overlay is on screen.
 *
 * Asked to Rust rather than worked out here. A hidden window and an unfocused
 * one look identical from the webview, and over a game this one is *always*
 * unfocused — pausing on blur would stop the refresh exactly when it matters.
 * The initial answer is asked for because the window is created hidden at
 * startup, so this code runs long before anyone opens it.
 */
export function useSquadOverlayVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let gone = false;

    void invoke<boolean>("is_squad_overlay_visible")
      .then((initial) => {
        if (!gone) setVisible(initial);
      })
      .catch((error) => {
        console.error("cannot read the squad overlay visibility", error);
      });

    void listen<boolean>(SQUAD_VISIBILITY_EVENT, (event) => {
      setVisible(event.payload);
    })
      .then((stop) => {
        if (gone) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        console.error("cannot follow the squad overlay visibility", error);
      });

    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  return visible;
}

/**
 * One squad rewritten, everywhere it appears in the view.
 *
 * The squad on screen and its copy inside the raid come from the same document
 * server-side, so they must not drift: a «prêt» toggled from the raid view has
 * to light up in the row the click landed on, not only in the squad view nobody
 * is looking at. Matched by id rather than assumed to be `view.squad`, because
 * an organiser acts on the squads they opened from the raid board without
 * switching to them.
 */
function withSquad(
  view: SquadView,
  squadId: string,
  next: (squad: Squad) => Squad,
): SquadView {
  return {
    ...view,
    squad:
      view.squad && view.squad.id === squadId ? next(view.squad) : view.squad,
    raid: view.raid
      ? {
          ...view.raid,
          squads: view.raid.squads.map((other) =>
            other.id === squadId ? next(other) : other,
          ),
        }
      : null,
  };
}

/**
 * One mutation of the squad, shown before the server has agreed.
 *
 * Three pieces make a click feel immediate without the poll undoing it:
 *
 * 1. whatever request is in flight is cancelled, and the new value goes into
 *    the cache at once;
 * 2. the poll is held off while any squad mutation runs (see `useSquad`) — that
 *    is what stops an answer sent *before* the click from landing *after* it;
 * 3. the API answers with the whole view, so success replaces the guess with
 *    the truth rather than waiting two seconds for it.
 *
 * The answer is the view *of the squad acted on*, which is not always the one
 * on screen: from the raid board, an organiser toggles rows in a squad they
 * opened while still looking at their own. `settle` puts the answer under the
 * key it belongs to.
 */
function useSquadMutation<TVariables>(
  current: string | null,
  call: (variables: TVariables) => Promise<SquadView>,
  guess?: (view: SquadView, variables: TVariables) => SquadView,
  settle?: (view: SquadView) => void,
) {
  const queryClient = useQueryClient();
  const key = keyFor(current);

  return useMutation({
    mutationKey: SQUAD_KEY,
    mutationFn: call,
    onMutate: async (variables: TVariables) => {
      // Started, not awaited: cancelling marks the queries synchronously, so no
      // answer already on the wire can land after this — but its promise only
      // settles a microtask later, and nothing should render in between. A
      // `useTypedField` whose blur triggered this would spend that gap showing
      // the value the user just replaced.
      const cancelling = queryClient.cancelQueries({ queryKey: SQUAD_KEY });

      const previous = queryClient.getQueryData<SquadView>(key);

      if (guess && previous) {
        queryClient.setQueryData<SquadView>(key, guess(previous, variables));
      }

      // Awaited before the request goes out all the same: the point of
      // cancelling is that nothing is in flight beside it.
      await cancelling;

      return { previous };
    },
    onError: (_error, _variables, context) => {
      // Put back what was on screen: the click did not take.
      if (context) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (view) => {
      if (settle) {
        settle(view);
        return;
      }

      // The squad this key shows: the chosen one, else whatever the API had
      // picked for it last time — an organiser acting on Bravo from the raid
      // board while looking at the API's pick must not find the overlay on
      // Bravo afterwards. Only a key that has never been filled takes the
      // answer's squad as its own.
      const shown =
        current ??
        queryClient.getQueryData<SquadView>(key)?.squad?.id ??
        view.squad?.id ??
        null;

      if (!view.squad || view.squad.id === shown) {
        queryClient.setQueryData<SquadView>(key, view);
        return;
      }

      // Answered for another squad of the same raid: the one on screen is in
      // there too, so the view is re-centred on it rather than refetched.
      const mine = view.raid?.squads.find((squad) => squad.id === shown);

      if (mine) {
        queryClient.setQueryData<SquadView>(key, { ...view, squad: mine });
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export interface SquadState {
  squad: Squad | null | undefined;
  /** The raid the squad was linked into, with every sub-squad. */
  raid: SquadView["raid"] | undefined;
  /** Every squad the reader is in — more than one only for a raid's organiser. */
  memberships: SquadView["memberships"];
  loading: boolean;
  error: unknown;
  /** True while the window is up, which is also while the squad is polled. */
  live: boolean;
}

/**
 * The squad, kept as fresh as polling allows.
 *
 * `enabled` is the session: the overlay is outside the route guard, so it asks
 * for nothing until someone is signed in. `current` is the squad the overlay
 * chose to look at, or `null` for the one the API picks — the only one, for
 * nearly everybody.
 *
 * Every squad-scoped mutation takes the squad it acts on: the one on screen
 * for most of them, and any squad the reader is in for the rows of the raid
 * board.
 */
export function useSquad(enabled: boolean, current: string | null) {
  const queryClient = useQueryClient();
  const live = useSquadOverlayVisible();
  const writing = useIsMutating({ mutationKey: SQUAD_KEY }) > 0;

  const query = useQuery({
    queryKey: keyFor(current),
    queryFn: () => getMySquad(current),
    enabled,
    // Nothing is worth keeping: the whole point is what the others just did.
    staleTime: 0,
    refetchInterval: live && !writing ? POLL_INTERVAL : false,
    // Switching squads must not flash «Chargement…» over the cockpit: the last
    // view stays up until the next one lands.
    placeholderData: keepPreviousData,
  });

  /**
   * The answer to leaving or starting over is the view the API picks — which
   * is what the overlay shows once it drops its choice — so it goes under that
   * key, whatever squad was on screen.
   */
  function settleDefault(view: SquadView) {
    queryClient.setQueryData<SquadView>(keyFor(null), view);
    if (current) queryClient.setQueryData<SquadView>(keyFor(current), view);
  }

  const create = useSquadMutation(
    current,
    (name?: string) => createSquad(name),
    undefined,
    settleDefault,
  );
  const join = useSquadMutation(
    current,
    (code: string) => joinSquad(code),
    undefined,
    settleDefault,
  );
  const leave = useSquadMutation(
    current,
    (squadId: string) => leaveSquad(squadId),
    undefined,
    settleDefault,
  );

  const rename = useSquadMutation(
    current,
    ({ squadId, name }: { squadId: string; name: string }) =>
      renameSquad(squadId, name),
    (view, { squadId, name }) =>
      withSquad(view, squadId, (squad) => ({ ...squad, name })),
  );

  const patchMember = useSquadMutation(
    current,
    ({
      squadId,
      userId,
      patch,
    }: {
      squadId: string;
      userId: string;
      patch: SquadMemberPatch;
    }) => updateSquadMember(squadId, userId, patch),
    (view, { squadId, userId, patch }) =>
      withSquad(view, squadId, (squad) => ({
        ...squad,
        members: squad.members.map((member) =>
          member.userId === userId ? { ...member, ...patch } : member,
        ),
      })),
  );

  const removeMember = useSquadMutation(
    current,
    ({ squadId, userId }: { squadId: string; userId: string }) =>
      removeSquadMember(squadId, userId),
    (view, { squadId, userId }) =>
      withSquad(view, squadId, (squad) => ({
        ...squad,
        members: squad.members.filter((member) => member.userId !== userId),
      })),
  );

  const makeLeader = useSquadMutation(
    current,
    ({ squadId, userId }: { squadId: string; userId: string }) =>
      transferSquadLeadership(squadId, userId),
    // Guessed the way the API does it, so the two ranks change together on
    // screen: the squad has one leader, and the outgoing one keeps a say.
    (view, { squadId, userId }) =>
      withSquad(view, squadId, (squad) => ({
        ...squad,
        leaderId: userId,
        members: squad.members.map((member) => {
          if (member.userId === userId) return { ...member, lieutenant: false };
          if (member.userId === squad.leaderId) {
            return { ...member, lieutenant: true };
          }
          return member;
        }),
      })),
  );

  const announce = useSquadMutation(
    current,
    ({ squadId, announcements }: { squadId: string; announcements: string }) =>
      setSquadAnnouncements(squadId, announcements),
    (view, { squadId, announcements }) =>
      withSquad(view, squadId, (squad) => ({ ...squad, announcements })),
  );

  /*
   * Roles are not guessed. The id of a new one is the server's to mint, and
   * every other role write reshuffles a list several rows read from — a wrong
   * guess would show a glyph that is about to change. They are also the rare
   * click nobody makes mid-firefight.
   */
  const addRole = useSquadMutation(
    current,
    ({
      squadId,
      label,
      icon,
    }: {
      squadId: string;
      label: string;
      icon: SquadRoleIcon;
    }) => createSquadRole(squadId, label, icon),
  );

  const editRole = useSquadMutation(
    current,
    ({
      squadId,
      roleId,
      patch,
    }: {
      squadId: string;
      roleId: string;
      patch: { label?: string; icon?: SquadRoleIcon };
    }) => updateSquadRole(squadId, roleId, patch),
  );

  const removeRole = useSquadMutation(
    current,
    ({ squadId, roleId }: { squadId: string; roleId: string }) =>
      deleteSquadRole(squadId, roleId),
  );

  const startRaid = useSquadMutation(
    current,
    ({ squadId, name }: { squadId: string; name?: string }) =>
      createRaid(squadId, name),
  );
  const enterRaid = useSquadMutation(
    current,
    ({ squadId, code }: { squadId: string; code: string }) =>
      joinRaid(squadId, code),
  );
  const quitRaid = useSquadMutation(current, (squadId: string) =>
    leaveRaid(squadId),
  );
  const unlinkSquad = useSquadMutation(
    current,
    ({ squadId, targetSquadId }: { squadId: string; targetSquadId: string }) =>
      unlinkRaidSquad(squadId, targetSquadId),
  );
  const openRaidSquad = useSquadMutation(
    current,
    ({ squadId, name }: { squadId: string; name?: string }) =>
      createRaidSquad(squadId, name),
  );

  const announceRaid = useSquadMutation(
    current,
    ({ squadId, announcement }: { squadId: string; announcement: string }) =>
      updateRaid(squadId, { announcement }),
    (view, { announcement }) =>
      view.raid ? { ...view, raid: { ...view.raid, announcement } } : view,
  );

  const renameRaid = useSquadMutation(
    current,
    ({ squadId, name }: { squadId: string; name: string }) =>
      updateRaid(squadId, { name }),
    (view, { name }) =>
      view.raid ? { ...view, raid: { ...view.raid, name } } : view,
  );

  return {
    state: {
      squad: query.data?.squad,
      raid: query.data?.raid,
      memberships: query.data?.memberships ?? [],
      loading: query.isPending && enabled,
      error: query.error,
      live,
    } satisfies SquadState,
    create,
    join,
    leave,
    rename,
    patchMember,
    removeMember,
    makeLeader,
    announce,
    addRole,
    editRole,
    removeRole,
    startRaid,
    enterRaid,
    quitRaid,
    unlinkSquad,
    openRaidSquad,
    announceRaid,
    renameRaid,
  };
}
