import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, UserMinus, UserPlus } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import { FRIENDS_KEY, useFriends } from "@/hooks/use-friends";
import {
  addFriend,
  cleanFriendCode,
  createFriendCode,
  formatFriendCode,
  friendErrorMessage,
  getFriendCode,
  removeFriend,
} from "@/lib/api/friends";
import { cn, formatElapsed } from "@/lib/utils";
import type { Friend } from "@/types/nexus";

const CODE_KEY = ["friends", "code"] as const;

/**
 * The reader's friends: the code to hand out, the field to type one in, and
 * who is playing — as each declared it, here or on the site.
 */
export default function FriendsPage() {
  const friends = useFriends(true);
  const [removing, setRemoving] = useState<Friend | null>(null);

  // Durations move on between refreshes too.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const list = friends.data ?? [];
  const playing = list.filter((friend) => friend.playing);
  const offline = list.filter((friend) => !friend.playing);

  return (
    <>
      <PageHeader
        title="Amis"
        description="Qui est en jeu, et à quoi. Chacun le déclare depuis Nexus App ou le site."
        actions={
          friends.data ? (
            <span className="text-[13px] text-nexus-muted">
              <span className="font-semibold text-emerald-300">
                {playing.length} en jeu
              </span>
              {" · "}
              {list.length} {list.length > 1 ? "amis" : "ami"}
            </span>
          ) : null
        }
      />

      <div className="mb-7 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FriendCodeCard />
        <AddFriendCard />
      </div>

      {friends.isPending ? (
        <LoadingState />
      ) : friends.isError ? (
        <ErrorState
          error={friends.error}
          onRetry={() => void friends.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          title="Pas encore d'amis"
          description="Partagez votre code ou saisissez celui d'un ami : vous serez ajoutés l'un à l'autre."
        />
      ) : (
        <>
          <section className="mb-7">
            <SectionTitle aside={`${playing.length} sur ${list.length}`}>
              En jeu
            </SectionTitle>
            {playing.length === 0 ? (
              <p className="text-[13px] text-nexus-muted">
                Aucun ami en jeu pour le moment.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {playing.map((friend) => (
                  <FriendCard
                    key={friend.userId}
                    friend={friend}
                    now={now}
                    onRemove={() => setRemoving(friend)}
                  />
                ))}
              </ul>
            )}
          </section>

          {offline.length > 0 ? (
            <section>
              <SectionTitle>Pas en jeu</SectionTitle>
              <ul className="grid grid-cols-1 gap-x-3 md:grid-cols-2 xl:grid-cols-3">
                {offline.map((friend) => (
                  <FriendCard
                    key={friend.userId}
                    friend={friend}
                    now={now}
                    onRemove={() => setRemoving(friend)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {removing ? (
        <RemoveFriendModal
          friend={removing}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}

function FriendCodeCard() {
  const queryClient = useQueryClient();
  const code = useQuery({
    queryKey: CODE_KEY,
    queryFn: async () => (await getFriendCode()).code,
    // A code someone just used is gone: the card goes back to «Générer».
    refetchInterval: 30_000,
  });
  const create = useMutation({
    mutationFn: async () => (await createFriendCode()).code,
    onSuccess: (value) => queryClient.setQueryData(CODE_KEY, value),
  });

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const shown = code.data ? formatFriendCode(code.data) : null;

  const copy = () => {
    // Absent outside a secure context, and in some webviews: the code stays
    // on screen to be copied by hand.
    if (!shown || !navigator.clipboard?.writeText) return;
    void navigator.clipboard
      .writeText(shown)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <KeyRound className="size-4 text-nexus-accent" />
        <h2 className="font-display text-base font-semibold text-nexus-white">
          Mon code ami
        </h2>
      </div>

      {shown ? (
        <>
          <div className="flex items-center gap-2">
            <span className="flex h-10 flex-1 items-center rounded-lg border border-dashed border-nexus-accent/40 bg-nexus-abyss px-3.5 font-mono text-lg font-medium tracking-[0.12em] text-nexus-white select-all">
              {shown}
            </span>
            <Button variant="outline" onClick={copy} className="h-10">
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? "Copié" : "Copier"}
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-nexus-dim">
            Usage unique : il disparaît dès qu'un ami l'utilise. Un nouveau code
            sera créé à votre prochaine demande.
          </p>
        </>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-nexus-muted">
            Générez un code et partagez-le. Il ne sert qu'une fois.
          </p>
          <Button
            onClick={() => create.mutate()}
            disabled={code.isPending || create.isPending}
            className="h-10"
          >
            Générer un code
          </Button>
          {create.isError ? (
            <p className="text-xs text-red-300">
              {friendErrorMessage(create.error)}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function AddFriendCard() {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");

  const add = useMutation({
    mutationFn: (code: string) => addFriend(code),
    onSuccess: () => {
      setValue("");
      void queryClient.invalidateQueries({ queryKey: FRIENDS_KEY });
    },
  });

  return (
    <Card className="p-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const code = cleanFriendCode(value);
          if (code) add.mutate(code);
        }}
      >
        <div className="flex items-center gap-2.5">
          <UserPlus className="size-4 text-nexus-accent" />
          <h2 className="font-display text-base font-semibold text-nexus-white">
            Ajouter un ami
          </h2>
        </div>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">Code ami</span>
            <Input
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (add.isError || add.isSuccess) add.reset();
              }}
              placeholder="XXXX-XXXX"
              maxLength={12}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={add.isError || undefined}
              className={cn(
                "h-10 font-mono text-[15px] tracking-[0.12em] uppercase",
                add.isError && "border-red-300/70 focus:border-red-300",
              )}
            />
          </label>
          <Button
            type="submit"
            disabled={add.isPending || cleanFriendCode(value) === ""}
            className="h-10"
          >
            Ajouter
          </Button>
        </div>
        {add.isError ? (
          <p role="alert" className="text-[13px] text-red-300">
            {friendErrorMessage(add.error)}
          </p>
        ) : add.isSuccess ? (
          <p
            role="status"
            className="flex items-center gap-2 text-[13px] text-emerald-300"
          >
            <Check className="size-4" />
            Vous êtes maintenant ami avec {add.data.name}.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-nexus-dim">
            Saisissez le code qu'un ami vous a transmis. Vous serez ajoutés l'un
            à l'autre.
          </p>
        )}
      </form>
    </Card>
  );
}

function Avatar({ friend, size }: { friend: Friend; size: string }) {
  const [failed, setFailed] = useState(false);

  return friend.avatar && !failed ? (
    <img
      src={friend.avatar}
      alt=""
      onError={() => setFailed(true)}
      className={cn("rounded-full object-cover", size)}
    />
  ) : (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-nexus-panel text-sm font-semibold text-nexus-accent",
        size,
      )}
    >
      {friend.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function FriendCard({
  friend,
  now,
  onRemove,
}: {
  friend: Friend;
  now: number;
  onRemove: () => void;
}) {
  const playing = friend.playing;

  return (
    <li
      className={cn(
        "group flex items-center gap-3",
        playing
          ? "rounded-xl border border-emerald-300/20 bg-nexus-card p-3.5"
          : "px-3.5 py-2",
      )}
    >
      <div className="relative shrink-0">
        <Avatar
          friend={friend}
          size={playing ? "size-10" : "size-8 opacity-80"}
        />
        {playing ? (
          <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-nexus-card bg-emerald-300" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm",
            playing ? "font-semibold text-nexus-white" : "text-nexus-soft",
          )}
        >
          {friend.name}
        </p>
        <p
          className={cn(
            "truncate text-xs",
            playing ? "text-emerald-300" : "text-nexus-dim",
          )}
        >
          {playing
            ? (playing.activity ?? "Pas d'activité précisée")
            : (friend.sharedOrg ?? "Aucune organisation commune")}
        </p>
      </div>

      {playing ? (
        <span className="shrink-0 text-xs text-nexus-dim" title="En jeu depuis">
          {formatElapsed(playing.since, now)}
        </span>
      ) : null}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer ${friend.name} de vos amis`}
        title="Retirer des amis"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-nexus-dim opacity-0 transition-opacity group-hover:opacity-100 hover:bg-nexus-accent/10 hover:text-red-300 focus-visible:opacity-100"
      >
        <UserMinus className="size-4" />
      </button>
    </li>
  );
}

function RemoveFriendModal({
  friend,
  onClose,
}: {
  friend: Friend;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeFriend(friend.userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FRIENDS_KEY });
      onClose();
    },
  });

  return (
    <Modal
      open
      title={`Retirer ${friend.name} ?`}
      description="Vous disparaîtrez aussi de sa liste. Pour redevenir amis, il faudra un nouveau code."
      icon={<UserMinus className="size-5" />}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} className="ml-auto">
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            Retirer des amis
          </Button>
        </>
      }
    >
      {remove.isError ? (
        <p className="text-[13px] text-red-300">
          {friendErrorMessage(remove.error)}
        </p>
      ) : (
        <p className="text-[13px] text-nexus-muted">
          Vous ne verrez plus quand {friend.name} est en jeu.
        </p>
      )}
    </Modal>
  );
}
