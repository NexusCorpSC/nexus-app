import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createRaid,
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

const SQUAD_KEY = ["squad"] as const;

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
 * The caller's own squad, rewritten — and the same rewrite carried into the
 * raid, where that squad appears a second time.
 *
 * Both copies come from the same document server-side, so they must not drift
 * on screen: a «prêt» toggled from the raid view has to light up in the row the
 * click landed on, not only in the squad view nobody is looking at.
 */
function withSquad(view: SquadView, next: (squad: Squad) => Squad): SquadView {
  if (!view.squad) return view;

  const squad = next(view.squad);

  return {
    squad,
    raid: view.raid
      ? {
          ...view.raid,
          squads: view.raid.squads.map((other) =>
            other.id === squad.id ? squad : other,
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
 */
function useSquadMutation<TVariables>(
  call: (variables: TVariables) => Promise<SquadView>,
  guess?: (view: SquadView, variables: TVariables) => SquadView,
) {
  const queryClient = useQueryClient();

  return useMutation({
    // Shared by every squad mutation so the poll can tell one is running.
    mutationKey: SQUAD_KEY,
    mutationFn: call,
    onMutate: async (variables: TVariables) => {
      // Started, not awaited: cancelling marks the queries synchronously, so no
      // answer already on the wire can land after this — but its promise only
      // settles a microtask later, and nothing should render in between. A
      // `useTypedField` whose blur triggered this would spend that gap showing
      // the value the user just replaced.
      const cancelling = queryClient.cancelQueries({ queryKey: SQUAD_KEY });

      const previous = queryClient.getQueryData<SquadView>(SQUAD_KEY);

      if (guess && previous) {
        queryClient.setQueryData<SquadView>(SQUAD_KEY, guess(previous, variables));
      }

      // Awaited before the request goes out all the same: the point of
      // cancelling is that nothing is in flight beside it.
      await cancelling;

      return { previous };
    },
    onError: (_error, _variables, context) => {
      // Put back what was on screen: the click did not take.
      if (context) queryClient.setQueryData(SQUAD_KEY, context.previous);
    },
    onSuccess: (view) => {
      queryClient.setQueryData<SquadView>(SQUAD_KEY, view);
    },
  });
}

export interface SquadState {
  squad: Squad | null | undefined;
  /** The raid the squad was linked into, with every sub-squad. */
  raid: SquadView["raid"] | undefined;
  loading: boolean;
  error: unknown;
  /** True while the window is up, which is also while the squad is polled. */
  live: boolean;
}

/**
 * The squad, kept as fresh as polling allows.
 *
 * `enabled` is the session: the overlay is outside the route guard, so it asks
 * for nothing until someone is signed in.
 */
export function useSquad(enabled: boolean) {
  const live = useSquadOverlayVisible();
  const writing = useIsMutating({ mutationKey: SQUAD_KEY }) > 0;

  const query = useQuery({
    queryKey: SQUAD_KEY,
    queryFn: getMySquad,
    enabled,
    // Nothing is worth keeping: the whole point is what the others just did.
    staleTime: 0,
    refetchInterval: live && !writing ? POLL_INTERVAL : false,
  });

  const create = useSquadMutation((name?: string) => createSquad(name));
  const join = useSquadMutation((code: string) => joinSquad(code));
  const leave = useSquadMutation<void>(() => leaveSquad());

  const rename = useSquadMutation(
    (name: string) => renameSquad(name),
    (view, name) => withSquad(view, (squad) => ({ ...squad, name })),
  );

  const patchMember = useSquadMutation(
    ({ userId, patch }: { userId: string; patch: SquadMemberPatch }) =>
      updateSquadMember(userId, patch),
    (view, { userId, patch }) =>
      withSquad(view, (squad) => ({
        ...squad,
        members: squad.members.map((member) =>
          member.userId === userId ? { ...member, ...patch } : member,
        ),
      })),
  );

  const removeMember = useSquadMutation(
    (userId: string) => removeSquadMember(userId),
    (view, userId) =>
      withSquad(view, (squad) => ({
        ...squad,
        members: squad.members.filter((member) => member.userId !== userId),
      })),
  );

  const makeLeader = useSquadMutation(
    (userId: string) => transferSquadLeadership(userId),
    // Guessed the way the API does it, so the two ranks change together on
    // screen: the squad has one leader, and the outgoing one keeps a say.
    (view, userId) =>
      withSquad(view, (squad) => ({
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
    (announcements: string) => setSquadAnnouncements(announcements),
    (view, announcements) =>
      withSquad(view, (squad) => ({ ...squad, announcements })),
  );

  /*
   * Roles are not guessed. The id of a new one is the server's to mint, and
   * every other role write reshuffles a list several rows read from — a wrong
   * guess would show a glyph that is about to change. They are also the rare
   * click nobody makes mid-firefight.
   */
  const addRole = useSquadMutation(
    ({ label, icon }: { label: string; icon: SquadRoleIcon }) =>
      createSquadRole(label, icon),
  );

  const editRole = useSquadMutation(
    ({
      roleId,
      patch,
    }: {
      roleId: string;
      patch: { label?: string; icon?: SquadRoleIcon };
    }) => updateSquadRole(roleId, patch),
  );

  const removeRole = useSquadMutation((roleId: string) =>
    deleteSquadRole(roleId),
  );

  const startRaid = useSquadMutation((name?: string) => createRaid(name));
  const enterRaid = useSquadMutation((code: string) => joinRaid(code));
  const quitRaid = useSquadMutation<void>(() => leaveRaid());
  const unlinkSquad = useSquadMutation((squadId: string) =>
    unlinkRaidSquad(squadId),
  );

  const announceRaid = useSquadMutation(
    (announcement: string) => updateRaid({ announcement }),
    (view, announcement) =>
      view.raid ? { ...view, raid: { ...view.raid, announcement } } : view,
  );

  const renameRaid = useSquadMutation(
    (name: string) => updateRaid({ name }),
    (view, name) => (view.raid ? { ...view, raid: { ...view.raid, name } } : view),
  );

  return {
    state: {
      squad: query.data?.squad,
      raid: query.data?.raid,
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
    announceRaid,
    renameRaid,
  };
}
