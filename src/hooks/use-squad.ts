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
  createSquad,
  getMySquad,
  joinSquad,
  leaveSquad,
  removeSquadMember,
  setSquadAnnouncements,
  transferSquadLeadership,
  updateSquadMember,
} from "@/lib/api/squads";
import type { Squad, SquadMemberPatch } from "@/types/nexus";

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
 * One mutation of the squad, shown before the server has agreed.
 *
 * Three pieces make a click feel immediate without the poll undoing it:
 *
 * 1. whatever request is in flight is cancelled, and the new value goes into
 *    the cache at once;
 * 2. the poll is held off while any squad mutation runs (see `useSquad`) — that
 *    is what stops an answer sent *before* the click from landing *after* it;
 * 3. the API answers with the whole squad, so success replaces the guess with
 *    the truth rather than waiting two seconds for it.
 */
function useSquadMutation<TVariables>(
  call: (variables: TVariables) => Promise<Squad | null>,
  guess?: (squad: Squad, variables: TVariables) => Squad,
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

      const previous = queryClient.getQueryData<Squad | null>(SQUAD_KEY);

      if (guess && previous) {
        queryClient.setQueryData<Squad | null>(
          SQUAD_KEY,
          guess(previous, variables),
        );
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
    onSuccess: (squad) => {
      queryClient.setQueryData<Squad | null>(SQUAD_KEY, squad);
    },
  });
}

export interface SquadState {
  squad: Squad | null | undefined;
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

  const patchMember = useSquadMutation(
    ({ userId, patch }: { userId: string; patch: SquadMemberPatch }) =>
      updateSquadMember(userId, patch),
    (squad, { userId, patch }) => ({
      ...squad,
      members: squad.members.map((member) =>
        member.userId === userId ? { ...member, ...patch } : member,
      ),
    }),
  );

  const removeMember = useSquadMutation(
    (userId: string) => removeSquadMember(userId),
    (squad, userId) => ({
      ...squad,
      members: squad.members.filter((member) => member.userId !== userId),
    }),
  );

  const makeLeader = useSquadMutation(
    (userId: string) => transferSquadLeadership(userId),
    // Guessed the way the API does it, so the two ranks change together on
    // screen: the squad has one leader, and the outgoing one keeps a say.
    (squad, userId) => ({
      ...squad,
      leaderId: userId,
      members: squad.members.map((member) => {
        if (member.userId === userId) return { ...member, lieutenant: false };
        if (member.userId === squad.leaderId) {
          return { ...member, lieutenant: true };
        }
        return member;
      }),
    }),
  );

  const announce = useSquadMutation(
    (announcements: string) => setSquadAnnouncements(announcements),
    (squad, announcements) => ({ ...squad, announcements }),
  );

  return {
    state: {
      squad: query.data,
      loading: query.isPending && enabled,
      error: query.error,
      live,
    } satisfies SquadState,
    create,
    join,
    leave,
    patchMember,
    removeMember,
    makeLeader,
    announce,
  };
}
