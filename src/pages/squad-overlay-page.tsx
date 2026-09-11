import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Crown,
  Flag,
  Loader2,
  LogOut,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  Shield,
  Skull,
  Tag,
  Trash2,
  Unlink,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { useSquad } from "@/hooks/use-squad";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { useOverlayOpaque } from "@/hooks/use-overlay-opacity";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { RoleIcon, roleOf, rolesOf } from "@/components/squad/role-icon";
import { overlaySkin } from "@/lib/overlay-opacity";
import {
  ANNOUNCEMENTS_MAX_LENGTH,
  POSITION_MAX_LENGTH,
  RAID_NAME_MAX_LENGTH,
  ROLE_ICON_GROUPS,
  ROLE_LABEL_MAX_LENGTH,
  SQUAD_NAME_MAX_LENGTH,
  type Raid,
  type Squad,
  type SquadMember,
  type SquadMemberPatch,
  type SquadRoleIcon,
} from "@/types/nexus";
import { cn } from "@/lib/utils";

/**
 * The squad, over the game.
 *
 * This one is see-through by default: it is meant to sit on the cockpit and be
 * read through, so there is no panel and only light blue text is left.
 * Legibility over arbitrary pixels comes from a shadow behind every glyph
 * rather than from a surface. What has to be *clicked*, on the other hand, does
 * get a faint tint whichever mode is on: a button nobody can find is not a
 * button.
 *
 * The panel can be brought back from the header button, or from the global
 * shortcut that lines the three overlays up (`src/lib/overlay-opacity.ts`).
 *
 * It also carries its own management — create, join by code, leave, roles,
 * raids — because there is no squad screen in the main window. So it has three
 * states: signed out, no squad, and in a squad.
 *
 * **One line per member, and never two.** The window is 420 pixels of cockpit;
 * everything that is not a name, a role and a state hides behind the `⋯` at the
 * end of the row, and the position only takes a second line when there is one
 * to show.
 */

/** Long enough that typing a position does not send a request per keystroke. */
const COMMIT_DELAY = 600;

/**
 * The faint tint every control gets. The window has no background on purpose,
 * but a field or a button with nothing behind it is unusable over a game.
 */
const SURFACE =
  "border border-nexus-accent/20 bg-nexus-abyss/50 backdrop-blur-sm focus:border-nexus-accent/50 focus:outline-none";

/** A sheet that takes the whole window: at 420px there is no room for two. */
const SHEET =
  "absolute inset-0 z-30 flex flex-col rounded-xl border border-white/10 bg-nexus-abyss/[0.98] backdrop-blur-xl";

export default function SquadOverlayPage() {
  const { user, loading: session } = useAuth();
  const squadApi = useSquad(Boolean(user));
  const { state } = squadApi;

  useTransparentWindow();

  // This one alone starts see-through: it was built that way. The header
  // button brings its panel back, and the global shortcut lines the three
  // overlays up on the same mode.
  const opaque = useOverlayOpaque("squad");

  /**
   * Which of the two rosters is on screen.
   *
   * `null` is «whatever fits»: a squad in a raid opens on the raid, because
   * that is the thing you cannot see anywhere else. Touching the toggle pins a
   * choice until the window is closed.
   */
  const [pinned, setPinned] = useState<"squad" | "raid" | null>(null);

  /** A sheet covers the roster whole; only one at a time. */
  const [sheet, setSheet] = useState<"roles" | "raid" | null>(null);

  const squad = state.squad ?? null;
  const raid = state.raid ?? null;

  const raiding = Boolean(raid) && (pinned ?? "raid") === "raid";

  function close() {
    void invoke("close_squad_overlay");
  }

  useEffect(() => {
    // The raid ended, or the squad did: a pin on a roster that is gone would
    // leave the window on an empty view until someone thought to press a button.
    if (!raid && pinned === "raid") setPinned(null);
    if (!squad && sheet) setSheet(null);
  }, [raid, squad, pinned, sheet]);

  return (
    <div
      className={cn(
        "relative flex h-screen w-screen flex-col overflow-hidden text-nexus-accent",
        // See-through, this is a shadow behind every glyph; opaque, it is the
        // same panel the other two overlays wear.
        overlaySkin(opaque),
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (sheet) setSheet(null);
        else close();
      }}
    >
      {/* No decorations, so the header doubles as the title bar. */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 cursor-grab items-center gap-1.5 px-3 py-2"
      >
        {raiding ? (
          <Flag className="pointer-events-none size-4 shrink-0 text-nexus-accent/70" />
        ) : (
          <Users className="pointer-events-none size-4 shrink-0 text-nexus-accent/70" />
        )}

        <Title
          squad={squad}
          raid={raid}
          raiding={raiding}
          onRename={(name) =>
            raiding
              ? squadApi.renameRaid.mutate(name)
              : squadApi.rename.mutate(name)
          }
          editable={Boolean(
            squad &&
              user &&
              commandsSquad(squad, user.id) &&
              (!raiding || raid?.leadSquadId === squad.id),
          )}
        />

        {raiding && raid ? <CodeButton code={raid.code} tone="raid" /> : null}
        {!raiding && squad ? <CodeButton code={squad.code} /> : null}

        {squad && raid ? (
          <IconButton
            label={raiding ? "Voir mon escouade" : "Voir le raid"}
            onClick={() => setPinned(raiding ? "squad" : "raid")}
          >
            {raiding ? (
              <Users className="size-4" />
            ) : (
              <Flag className="size-4" />
            )}
          </IconButton>
        ) : null}

        <OverlayOpacityButton
          label="squad"
          opaque={opaque}
          className="text-nexus-accent/70 hover:bg-nexus-abyss/60 hover:text-nexus-bright"
        />

        <IconButton label="Fermer" onClick={close}>
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 pb-2.5">
        {session ? (
          <p className="text-xs text-nexus-accent/70">Session…</p>
        ) : !user ? (
          <p className="text-xs text-nexus-accent/80">
            Connectez-vous dans la fenêtre principale pour créer une escouade ou
            en rejoindre une.
          </p>
        ) : state.loading ? (
          <p className="text-xs text-nexus-accent/70">Chargement…</p>
        ) : !squad ? (
          <NoSquad
            onCreate={() => squadApi.create.mutate(undefined)}
            creating={squadApi.create.isPending}
            onJoin={(code) => squadApi.join.mutate(code)}
            joining={squadApi.join.isPending}
            joinError={squadApi.join.error}
          />
        ) : raiding && raid ? (
          <RaidBoard
            raid={raid}
            squad={squad}
            userId={user.id}
            api={squadApi}
            onCompose={() => setSheet("raid")}
            onRoles={() => setSheet("roles")}
          />
        ) : (
          <SquadBoard
            squad={squad}
            raid={raid}
            userId={user.id}
            api={squadApi}
            onCompose={() => setSheet("raid")}
            onRoles={() => setSheet("roles")}
          />
        )}
      </div>

      {squad && sheet === "roles" ? (
        <RolesSheet
          squad={squad}
          editable={Boolean(user && commandsSquad(squad, user.id))}
          api={squadApi}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {squad && sheet === "raid" ? (
        <RaidSheet
          squad={squad}
          raid={raid}
          editable={Boolean(user && commandsSquad(squad, user.id))}
          api={squadApi}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

type SquadApi = ReturnType<typeof useSquad>;

/*
 * The one question the whole screen turns on, and the same one the API asks:
 * the leader and the lieutenants they appointed have identical powers, so
 * nothing below tells them apart.
 *
 * Disabling a button is a courtesy, not a rule — every one of these acts is
 * refused server-side too.
 */
function commandsSquad(squad: Squad, userId: string): boolean {
  return (
    squad.leaderId === userId ||
    squad.members.some(
      (member) => member.userId === userId && member.lieutenant,
    )
  );
}

/** Longest-standing first, which is also the order of succession. */
function inJoinOrder(members: SquadMember[]): SquadMember[] {
  return [...members].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

function tally(squads: Squad[]) {
  const members = squads.flatMap((squad) => squad.members);

  return {
    total: members.length,
    // A member who is down is not «prêt», whatever their row last said. The
    // API clears the flag on elimination, so this only matters for a squad
    // whose rows were written before it did — counting them would make a wiped
    // squad read as ready.
    ready: members.filter((member) => member.ready && member.alive).length,
    down: members.filter((member) => !member.alive).length,
  };
}

/* ------------------------------------------------------------------ */
/* No squad yet                                                        */
/* ------------------------------------------------------------------ */

function NoSquad({
  onCreate,
  creating,
  onJoin,
  joining,
  joinError,
}: {
  onCreate: () => void;
  creating: boolean;
  onJoin: (code: string) => void;
  joining: boolean;
  joinError: unknown;
}) {
  const [code, setCode] = useState("");

  return (
    <div className="space-y-3">
      <p className="text-xs text-nexus-accent/70">
        Créez une escouade et partagez son code, ou saisissez celui qu'on vous a
        donné.
      </p>

      <OverlayButton onClick={onCreate} disabled={creating}>
        {creating ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Plus className="size-3.5" />
        )}
        Créer une escouade
      </OverlayButton>

      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          // Trimmed here as well as by the API: what the button checks and what
          // the request carries should be the same string.
          const typed = code.trim();
          if (typed) onJoin(typed);
        }}
      >
        <CodeInput value={code} onChange={setCode} label="Code de l'escouade" />
        <OverlayButton type="submit" disabled={joining || !code.trim()}>
          {joining ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Rejoindre
        </OverlayButton>
      </form>

      {joinError ? (
        <p className="text-xs text-red-300">{errorText(joinError)}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One squad                                                           */
/* ------------------------------------------------------------------ */

function SquadBoard({
  squad,
  raid,
  userId,
  api,
  onCompose,
  onRoles,
}: {
  squad: Squad;
  raid: Raid | null;
  userId: string;
  api: SquadApi;
  onCompose: () => void;
  onRoles: () => void;
}) {
  const commands = commandsSquad(squad, userId);
  const counts = tally([squad]);

  return (
    <>
      {raid ? <RaidBanner raid={raid} editable={false} /> : null}

      <Announcement
        value={squad.announcements}
        editable={commands}
        onCommit={(text) => api.announce.mutate(text)}
        placeholder="Annonce à l'escouade"
      />

      <MemberList
        squad={squad}
        userId={userId}
        commands={commands}
        api={api}
        onRoles={onRoles}
      />

      <Footer counts={counts}>
        <OverlayButton onClick={onCompose} title="Raid">
          <Flag className="size-3.5" />
          {raid ? "Raid" : "Créer un raid"}
        </OverlayButton>

        <OverlayButton
          onClick={() => api.leave.mutate()}
          disabled={api.leave.isPending}
          tone="danger"
        >
          {api.leave.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <LogOut className="size-3.5" />
          )}
          Quitter
        </OverlayButton>
      </Footer>
    </>
  );
}

function MemberList({
  squad,
  userId,
  commands,
  api,
  onRoles,
  indent = false,
}: {
  squad: Squad;
  /** Empty on a sub-squad the reader is not in: those rows are read-only. */
  userId: string | null;
  commands: boolean;
  api: SquadApi;
  onRoles: () => void;
  indent?: boolean;
}) {
  return (
    <ul className={cn("min-h-0 flex-1 overflow-y-auto", indent && "flex-none")}>
      {inJoinOrder(squad.members).map((member) => (
        <MemberRow
          key={member.userId}
          squad={squad}
          member={member}
          isSelf={member.userId === userId}
          isLeader={squad.leaderId === member.userId}
          // A member writes to their own row; whoever commands writes to
          // anyone's — in their own squad only, which is all the API allows.
          editable={member.userId === userId || commands}
          commands={commands}
          indent={indent}
          onPatch={(patch) =>
            api.patchMember.mutate({ userId: member.userId, patch })
          }
          // Nobody is put out of their own squad, and the leader is never
          // removed — they leave, or hand over first.
          onRemove={
            commands &&
            member.userId !== userId &&
            member.userId !== squad.leaderId
              ? () => api.removeMember.mutate(member.userId)
              : undefined
          }
          // The rank is never self-reported, and the leader outranks it. Own
          // row included: whoever commands may resign the rank, or take the
          // squad — the same act on themselves as on anyone else.
          onMakeLeader={
            commands && member.userId !== squad.leaderId
              ? () => api.makeLeader.mutate(member.userId)
              : undefined
          }
          onRank={
            commands && member.userId !== squad.leaderId
              ? (lieutenant: boolean) =>
                  api.patchMember.mutate({
                    userId: member.userId,
                    patch: { lieutenant },
                  })
              : undefined
          }
          onRoles={onRoles}
        />
      ))}
    </ul>
  );
}

/**
 * One member, one line.
 *
 * Left to right: the rank, the role, the name, and the two states worth a
 * glance. Everything else — the position, the rank, the succession, the
 * removal — is behind the `⋯`, which only appears for whoever may use it.
 *
 * The colour is the state and nothing else: green is ready, plain blue is alive
 * and not ready yet, red struck through is down. The role stays monochrome so
 * it cannot be mistaken for any of the three.
 */
function MemberRow({
  squad,
  member,
  isSelf,
  isLeader,
  editable,
  commands,
  indent,
  onPatch,
  onRemove,
  onMakeLeader,
  onRank,
  onRoles,
}: {
  squad: Squad;
  member: SquadMember;
  isSelf: boolean;
  isLeader: boolean;
  editable: boolean;
  commands: boolean;
  indent: boolean;
  onPatch: (patch: SquadMemberPatch) => void;
  onRemove?: () => void;
  onMakeLeader?: () => void;
  /**
   * Absent unless the reader commands, and on the leader's row — the rank is
   * beneath them. Present on the reader's own row, though: a lieutenant may
   * resign, exactly as they may take the rank off anybody else.
   */
  onRank?: (lieutenant: boolean) => void;
  onRoles: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editingPosition, setEditingPosition] = useState(false);

  const role = roleOf(squad, member.role);
  const down = !member.alive;

  return (
    <li
      className={cn(
        "group relative rounded px-1 py-px hover:bg-nexus-accent/5",
        indent && "pl-4",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex size-3 shrink-0 items-center justify-center">
          {isLeader ? (
            <span title="Chef de l'escouade">
              <Crown className="size-3 text-amber-300" />
              <span className="sr-only">Chef de l'escouade</span>
            </span>
          ) : member.lieutenant ? (
            <span title="Lieutenant">
              <Shield className="size-3 text-sky-300" />
              <span className="sr-only">Lieutenant</span>
            </span>
          ) : null}
        </span>

        <button
          type="button"
          title={role ? `Rôle : ${role.label}` : "Aucun rôle"}
          disabled={!editable}
          onClick={() => setPicking((open) => !open)}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded transition",
            role ? "text-nexus-accent/90" : "text-nexus-accent/35",
            editable ? "hover:bg-nexus-accent/15" : "cursor-default",
            picking && "bg-nexus-accent/15",
          )}
        >
          <span className="sr-only">
            {role ? `Rôle : ${role.label}` : "Choisir un rôle"}
          </span>
          <RoleIcon icon={role?.icon} />
        </button>

        <p
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            down
              ? "text-red-300 line-through decoration-red-300/60"
              : member.ready
                ? "text-emerald-300"
                : "text-nexus-bright",
            isLeader || isSelf ? "font-medium" : null,
          )}
        >
          {member.name}
        </p>

        <RowToggle
          title={member.ready ? "Prêt" : "Pas prêt"}
          // A member who is down is not «prêt»: the toggle says so by refusing
          // rather than by hiding, so the row keeps its shape as people fall.
          disabled={!editable || down}
          dimmed={down}
          onClick={() => onPatch({ ready: !member.ready })}
        >
          {member.ready ? (
            <Check className="size-3.5 text-emerald-300" />
          ) : (
            <X className="size-3.5 text-red-300" />
          )}
        </RowToggle>

        <RowToggle
          title={down ? "Éliminé" : "Actif"}
          disabled={!editable}
          onClick={() => onPatch({ alive: down })}
        >
          <Skull
            className={cn(
              "size-3.5",
              down ? "text-red-300" : "text-nexus-accent/25",
            )}
          />
        </RowToggle>

        {editable ? (
          <button
            type="button"
            title="Actions"
            onClick={() => setMenu((open) => !open)}
            className={cn(
              "flex h-5 w-4 shrink-0 items-center justify-center rounded text-nexus-accent/70 transition hover:bg-nexus-accent/15",
              menu ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <span className="sr-only">Actions sur {member.name}</span>
            <MoreHorizontal className="size-3.5" />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
      </div>

      {editingPosition ? (
        <PositionField
          value={member.position}
          onCommit={(position) => onPatch({ position })}
          onDone={() => setEditingPosition(false)}
        />
      ) : member.position ? (
        <button
          type="button"
          disabled={!editable}
          onClick={() => setEditingPosition(true)}
          className={cn(
            "ml-[44px] block max-w-[calc(100%-44px)] truncate text-left text-[11px] text-nexus-accent/60",
            editable && "hover:text-nexus-accent",
          )}
        >
          {member.position}
        </button>
      ) : null}

      {picking ? (
        <RolePicker
          squad={squad}
          current={member.role}
          onPick={(roleId) => {
            onPatch({ role: roleId });
            setPicking(false);
          }}
          onManage={() => {
            setPicking(false);
            onRoles();
          }}
          onClose={() => setPicking(false)}
          canManage={commands}
        />
      ) : null}

      {menu ? (
        <RowMenu
          member={member}
          onClose={() => setMenu(false)}
          onPosition={() => setEditingPosition(true)}
          onRank={
            onRank ? () => onRank(!member.lieutenant) : undefined
          }
          onMakeLeader={onMakeLeader}
          onRemove={onRemove}
        />
      ) : null}
    </li>
  );
}

/** The squad's roles, two to a row, and the way into the list that holds them. */
function RolePicker({
  squad,
  current,
  onPick,
  onManage,
  onClose,
  canManage,
}: {
  squad: Squad;
  current: string | undefined;
  onPick: (roleId: string) => void;
  onManage: () => void;
  onClose: () => void;
  canManage: boolean;
}) {
  const roles = rolesOf(squad);

  return (
    <Popover onClose={onClose} className="left-3 top-6 w-64">
      <div className="grid grid-cols-2 gap-0.5">
        <RoleChip
          label="Aucun"
          selected={!current}
          onClick={() => onPick("")}
        />

        {roles.map((role) => (
          <RoleChip
            key={role.id}
            label={role.label}
            icon={role.icon}
            selected={role.id === current}
            onClick={() => onPick(role.id)}
          />
        ))}
      </div>

      {canManage ? (
        <button
          type="button"
          onClick={onManage}
          className="mt-1 flex w-full items-center gap-1.5 border-t border-nexus-accent/15 px-1.5 pt-1.5 text-[11px] text-nexus-accent/70 transition hover:text-nexus-bright"
        >
          <Tag className="size-3" />
          Gérer les rôles…
        </button>
      ) : null}
    </Popover>
  );
}

function RoleChip({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string;
  icon?: SquadRoleIcon;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] transition",
        selected
          ? "bg-nexus-accent/20 text-nexus-bright"
          : "text-nexus-accent/75 hover:bg-nexus-accent/10",
      )}
    >
      <RoleIcon icon={icon} className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/** Everything a row can do that is not worth a pixel of its own. */
function RowMenu({
  member,
  onClose,
  onPosition,
  onRank,
  onMakeLeader,
  onRemove,
}: {
  member: SquadMember;
  onClose: () => void;
  onPosition: () => void;
  onRank?: () => void;
  onMakeLeader?: () => void;
  onRemove?: () => void;
}) {
  return (
    <Popover onClose={onClose} className="right-1 top-6 w-48">
      <MenuItem
        icon={<Pencil className="size-3 text-nexus-accent/60" />}
        onClick={() => {
          onPosition();
          onClose();
        }}
      >
        Position
      </MenuItem>

      {onRank ? (
        <MenuItem
          icon={<Shield className="size-3 text-sky-300" />}
          onClick={() => {
            onRank();
            onClose();
          }}
        >
          {member.lieutenant ? "Retirer le grade" : "Nommer lieutenant"}
        </MenuItem>
      ) : null}

      {onMakeLeader ? (
        <MenuItem
          icon={<Crown className="size-3 text-amber-300" />}
          onClick={() => {
            onMakeLeader();
            onClose();
          }}
        >
          Passer chef
        </MenuItem>
      ) : null}

      {onRemove ? (
        <MenuItem
          icon={<UserMinus className="size-3" />}
          tone="danger"
          onClick={() => {
            onRemove();
            onClose();
          }}
        >
          Retirer de l'escouade
        </MenuItem>
      ) : null}
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* The raid                                                            */
/* ------------------------------------------------------------------ */

/**
 * Every squad of the raid, each foldable.
 *
 * Folded, a sub-squad is one line and a row of dots — one per member, green for
 * ready, red for down. That is the whole reason the raid view exists: fifteen
 * players do not fit on a cockpit, and fifteen dots do.
 *
 * Only the reader's own squad is interactive. The API refuses a write on
 * anybody else's member, so the rows say so by not offering.
 */
function RaidBoard({
  raid,
  squad,
  userId,
  api,
  onCompose,
  onRoles,
}: {
  raid: Raid;
  squad: Squad;
  userId: string;
  api: SquadApi;
  onCompose: () => void;
  onRoles: () => void;
}) {
  const commands = commandsSquad(squad, userId);
  const leads = raid.leadSquadId === squad.id && commands;
  const counts = tally(raid.squads);

  const [folded, setFolded] = useState<Record<string, boolean>>({});

  return (
    <>
      <RaidBanner
        raid={raid}
        editable={leads}
        onCommit={(text) => api.announceRaid.mutate(text)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {raid.squads.map((sub, index) => {
          const mine = sub.id === squad.id;
          const open = !folded[sub.id];

          return (
            <section key={sub.id} className="mb-1">
              <SubSquadHeader
                squad={sub}
                hue={SQUAD_HUES[index % SQUAD_HUES.length]}
                open={open}
                mine={mine}
                isLead={raid.leadSquadId === sub.id}
                onToggle={() =>
                  setFolded((previous) => ({
                    ...previous,
                    [sub.id]: !previous[sub.id],
                  }))
                }
              />

              {sub.announcements ? (
                <p className="truncate pl-[26px] text-[10.5px] text-nexus-accent/55">
                  {sub.announcements}
                </p>
              ) : null}

              {open ? (
                <MemberList
                  squad={sub}
                  userId={mine ? userId : null}
                  commands={mine && commands}
                  api={api}
                  onRoles={onRoles}
                  indent
                />
              ) : null}
            </section>
          );
        })}
      </div>

      <Footer counts={counts}>
        <OverlayButton onClick={onCompose}>
          <Flag className="size-3.5" />
          Composer
        </OverlayButton>
      </Footer>
    </>
  );
}

/**
 * A hue per sub-squad, so a dot is enough to tell them apart.
 *
 * Blues through pinks only: green, amber and red already mean ready, leader and
 * down on the rows underneath, and a squad colour that borrowed one of them
 * would make a glance ambiguous exactly where it has to be quick.
 */
const SQUAD_HUES = [250, 300, 340, 200, 275, 320];

/**
 * How many dots a folded squad draws before it gives up and counts.
 *
 * Twenty of them plus their gaps is 177 pixels of a 420-pixel window, which
 * would push the name and the tally off the row the dots are there to summarise.
 */
const PIPS_SHOWN = 10;

function SubSquadHeader({
  squad,
  hue,
  open,
  mine,
  isLead,
  onToggle,
}: {
  squad: Squad;
  hue: number;
  open: boolean;
  mine: boolean;
  isLead: boolean;
  onToggle: () => void;
}) {
  const counts = tally([squad]);

  return (
    <div className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-nexus-accent/5">
      <button
        type="button"
        title={open ? `Replier ${squad.name}` : `Déplier ${squad.name}`}
        onClick={onToggle}
        className="flex size-4 shrink-0 items-center justify-center text-nexus-accent/65 transition hover:text-nexus-bright"
      >
        <span className="sr-only">
          {open ? `Replier ${squad.name}` : `Déplier ${squad.name}`}
        </span>
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
      </button>

      <span
        className="size-[7px] shrink-0 rounded-full"
        style={{ background: `oklch(0.74 0.13 ${hue})` }}
      />

      <span
        className={cn(
          "min-w-0 max-w-[45%] truncate text-xs font-semibold",
          mine ? "text-nexus-bright" : "text-nexus-accent",
        )}
      >
        {squad.name}
      </span>

      {isLead ? (
        <span title="Escouade meneuse du raid">
          <Crown className="size-3 shrink-0 text-amber-300" />
          <span className="sr-only">Escouade meneuse du raid</span>
        </span>
      ) : null}

      {/* Folded, this row is all there is to read: one dot per member. */}
      {!open ? (
        <span className="flex shrink-0 items-center gap-[3px]">
          {inJoinOrder(squad.members)
            .slice(0, PIPS_SHOWN)
            .map((member) => (
              <span
                key={member.userId}
                title={`${member.name} — ${
                  !member.alive ? "éliminé" : member.ready ? "prêt" : "pas prêt"
                }`}
                className={cn(
                  "size-1.5 rounded-full",
                  !member.alive
                    ? "bg-red-300"
                    : member.ready
                      ? "bg-emerald-300"
                      : "bg-nexus-accent/35",
                )}
              />
            ))}

          {squad.members.length > PIPS_SHOWN ? (
            <span className="text-[10px] text-nexus-accent/50">
              +{squad.members.length - PIPS_SHOWN}
            </span>
          ) : null}
        </span>
      ) : null}

      <span className="flex-1" />

      <span
        className={cn(
          "shrink-0 text-[11px] tabular-nums",
          counts.ready === counts.total
            ? "text-emerald-300"
            : "text-nexus-accent/80",
        )}
      >
        {counts.ready}/{counts.total}
      </span>

      {counts.down ? (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-red-300">
          <Skull className="size-3" />
          {counts.down}
        </span>
      ) : null}
    </div>
  );
}

/** The raid's one message, read by every player of every sub-squad. */
function RaidBanner({
  raid,
  editable,
  onCommit,
}: {
  raid: Raid;
  editable: boolean;
  onCommit?: (text: string) => void;
}) {
  if (!editable && !raid.announcement) return null;

  return (
    <div className="shrink-0 border-l-2 border-amber-300/55 bg-amber-300/[0.07] pl-1.5">
      <Announcement
        value={raid.announcement}
        editable={editable}
        onCommit={onCommit ?? (() => undefined)}
        placeholder="Annonce à tout le raid"
        icon={<Megaphone className="mt-0.5 size-3 shrink-0 text-amber-300/80" />}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

/** The squad's own list of jobs: rename, re-draw, invent, remove. */
function RolesSheet({
  squad,
  editable,
  api,
  onClose,
}: {
  squad: Squad;
  editable: boolean;
  api: SquadApi;
  onClose: () => void;
}) {
  const roles = rolesOf(squad);
  const [draft, setDraft] = useState<Draft | null>(null);

  const busy =
    api.addRole.isPending || api.editRole.isPending || api.removeRole.isPending;

  return (
    <div className={SHEET}>
      <SheetHeader
        icon={<Tag className="size-4 text-nexus-accent/70" />}
        title={
          draft ? (draft.id ? "Modifier un rôle" : "Nouveau rôle") : "Rôles"
        }
        onBack={draft ? () => setDraft(null) : undefined}
        onClose={onClose}
      />

      {draft ? (
        <RoleEditor
          draft={draft}
          busy={busy}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => {
            const label = draft.label.trim();
            if (!label) return;

            if (draft.id) {
              api.editRole.mutate({
                roleId: draft.id,
                patch: { label, icon: draft.icon },
              });
            } else {
              api.addRole.mutate({ label, icon: draft.icon });
            }

            setDraft(null);
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          <p className="mb-2 text-[11px] leading-relaxed text-nexus-accent/65">
            Partagés par toute l'escouade. Les sept fournis se renomment et
            changent d'icône, mais ne s'effacent pas.
          </p>

          <ul className="min-h-0 flex-1 space-y-px overflow-y-auto">
            {roles.map((role) => (
              <li
                key={role.id}
                className="group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-nexus-accent/5"
              >
                <RoleIcon icon={role.icon} className="size-3.5 shrink-0 text-nexus-accent/90" />
                <span className="min-w-0 flex-1 truncate text-xs text-nexus-bright">
                  {role.label}
                </span>
                <span className="shrink-0 text-[9.5px] uppercase tracking-wider text-nexus-accent/35">
                  {role.base ? "fourni" : "perso"}
                </span>

                {editable ? (
                  <button
                    type="button"
                    title={`Modifier ${role.label}`}
                    onClick={() =>
                      setDraft({
                        id: role.id,
                        label: role.label,
                        icon: role.icon,
                        group: groupOf(role.icon),
                      })
                    }
                    className="flex size-5 shrink-0 items-center justify-center rounded text-nexus-accent/70 opacity-0 transition hover:bg-nexus-accent/15 group-hover:opacity-100"
                  >
                    <span className="sr-only">Modifier {role.label}</span>
                    <Pencil className="size-3" />
                  </button>
                ) : null}

                <span className="flex size-5 shrink-0 items-center justify-center">
                  {editable && !role.base ? (
                    <button
                      type="button"
                      title={`Supprimer ${role.label}`}
                      onClick={() => api.removeRole.mutate(role.id)}
                      className="flex size-5 items-center justify-center rounded text-red-300 opacity-0 transition hover:bg-red-500/20 group-hover:opacity-100"
                    >
                      <span className="sr-only">Supprimer {role.label}</span>
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          {editable ? (
            <OverlayButton
              className="mt-2 self-start"
              onClick={() =>
                setDraft({ id: null, label: "", icon: "crosshair", group: "combat" })
              }
            >
              <Plus className="size-3.5" />
              Nouveau rôle
            </OverlayButton>
          ) : null}

          {api.removeRole.error ? (
            <p className="mt-2 text-[11px] text-red-300">
              {errorText(api.removeRole.error)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

type Draft = {
  /** `null` while inventing one; the role's id while editing it. */
  id: string | null;
  label: string;
  icon: SquadRoleIcon;
  group: string;
};

function groupOf(icon: SquadRoleIcon): string {
  const group = ROLE_ICON_GROUPS.find((candidate) =>
    (candidate.icons as readonly string[]).includes(icon),
  );

  return group?.id ?? ROLE_ICON_GROUPS[0].id;
}

/** A name, and a glyph out of the bank — nothing else makes a role. */
function RoleEditor({
  draft,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const group =
    ROLE_ICON_GROUPS.find((candidate) => candidate.id === draft.group) ??
    ROLE_ICON_GROUPS[0];

  const named = Boolean(draft.label.trim());

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label className="block shrink-0 space-y-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-nexus-accent/55">
          Nom du rôle
        </span>
        <input
          value={draft.label}
          maxLength={ROLE_LABEL_MAX_LENGTH}
          autoFocus
          placeholder="Sniper, Boarder, Quartier-maître…"
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
          className={cn(
            "w-full rounded px-2 py-1 text-[13px]",
            SURFACE,
            "text-nexus-bright placeholder:text-nexus-accent/35",
          )}
        />
      </label>

      <div className="flex shrink-0 flex-col">
        <span className="mb-1 shrink-0 text-[10px] font-medium uppercase tracking-wider text-nexus-accent/55">
          Icône
        </span>

        <div className="mb-1.5 flex shrink-0 flex-wrap gap-1">
          {ROLE_ICON_GROUPS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onChange({ ...draft, group: candidate.id })}
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] transition",
                candidate.id === group.id
                  ? "bg-nexus-accent/20 text-nexus-bright"
                  : "bg-nexus-abyss/50 text-nexus-accent/65 hover:text-nexus-bright",
              )}
            >
              {candidate.label}
            </button>
          ))}
        </div>

        <div className="grid auto-rows-min grid-cols-8 gap-1">
          {group.icons.map((icon) => (
            <button
              key={icon}
              type="button"
              title={icon}
              onClick={() => onChange({ ...draft, icon })}
              className={cn(
                "flex h-8 items-center justify-center rounded border transition",
                icon === draft.icon
                  ? "border-nexus-accent/55 bg-nexus-accent/20 text-nexus-bright"
                  : "border-nexus-accent/15 bg-nexus-abyss/50 text-nexus-accent/70 hover:text-nexus-bright",
              )}
            >
              <span className="sr-only">{icon}</span>
              <RoleIcon icon={icon} className="size-4" />
            </button>
          ))}
        </div>
      </div>

      {/* The preview is the real row, because that is where it will be read. */}
      <div className="flex shrink-0 items-center gap-2 rounded border border-dashed border-nexus-accent/20 px-2 py-1.5">
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-nexus-accent/45">
          Sur la ligne
        </span>
        <RoleIcon icon={draft.icon} className="size-3.5 shrink-0 text-nexus-accent/90" />
        <span className="shrink-0 text-[13px] text-emerald-300">Kalaghan</span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px]",
            named ? "text-nexus-accent/70" : "text-nexus-accent/35",
          )}
        >
          — {draft.label.trim() || "nommez-le"}
        </span>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-xs text-nexus-accent/70 transition hover:text-nexus-bright"
        >
          Annuler
        </button>

        <OverlayButton type="submit" disabled={!named || busy}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5 text-emerald-300" />
          )}
          Enregistrer
        </OverlayButton>
      </div>
    </form>
  );
}

/**
 * What the raid is made of: link a squad in by code, start one, put one out.
 *
 * Commanding your own squad is enough to take it in or out. The rest — the
 * name, the unlinking of somebody else's squad — asks for the lead squad, and
 * the buttons simply do not appear otherwise.
 */
function RaidSheet({
  squad,
  raid,
  editable,
  api,
  onClose,
}: {
  squad: Squad;
  raid: Raid | null;
  editable: boolean;
  api: SquadApi;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const leads = Boolean(raid && raid.leadSquadId === squad.id && editable);

  const error =
    api.enterRaid.error ?? api.startRaid.error ?? api.unlinkSquad.error;

  return (
    <div className={SHEET}>
      <SheetHeader
        icon={<Flag className="size-4 text-nexus-accent/70" />}
        title={raid ? "Composer le raid" : "Créer un raid"}
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3 pb-3">
        <p className="shrink-0 text-[11px] leading-relaxed text-nexus-accent/65">
          Un raid regroupe plusieurs escouades sous une même annonce. Chacune
          garde son code, son chef et ses rôles.
        </p>

        {raid ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-1 flex shrink-0 items-baseline justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-nexus-accent/55">
                  Escouades liées
                </span>
                <span className="text-[10px] text-nexus-accent/45">
                  {raid.squads.length} ·{" "}
                  {raid.squads.reduce(
                    (total, sub) => total + sub.members.length,
                    0,
                  )}{" "}
                  joueurs
                </span>
              </div>

              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {raid.squads.map((sub) => (
                  <li
                    key={sub.id}
                    className={cn(
                      "group flex items-center gap-2 rounded px-2 py-1.5",
                      SURFACE,
                    )}
                  >
                    <span className="shrink-0 text-xs font-semibold text-nexus-bright">
                      {sub.name}
                    </span>

                    {raid.leadSquadId === sub.id ? (
                      <span title="Escouade meneuse">
                        <Crown className="size-3 shrink-0 text-amber-300" />
                        <span className="sr-only">Escouade meneuse</span>
                      </span>
                    ) : null}

                    <span className="min-w-0 flex-1 truncate text-[11px] text-nexus-accent/60">
                      {sub.members.length} joueur
                      {sub.members.length > 1 ? "s" : ""}
                    </span>

                    {/* Only your own squad's code is yours to hand out. */}
                    <span className="shrink-0 font-mono text-[10px] tracking-widest text-nexus-accent/40">
                      {sub.id === squad.id ? sub.code : null}
                    </span>

                    {leads && sub.id !== squad.id ? (
                      <button
                        type="button"
                        title={`Retirer ${sub.name} du raid`}
                        onClick={() => api.unlinkSquad.mutate(sub.id)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-red-300 opacity-0 transition hover:bg-red-500/20 group-hover:opacity-100"
                      >
                        <span className="sr-only">
                          Retirer {sub.name} du raid
                        </span>
                        <Unlink className="size-3" />
                      </button>
                    ) : (
                      <span className="size-5 shrink-0" />
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="shrink-0 space-y-1.5">
              <p className="flex items-center gap-1.5 text-[10.5px] text-nexus-accent/55">
                <Copy className="size-3" />
                Code du raid :{" "}
                <span className="font-mono tracking-widest text-nexus-bright">
                  {raid.code}
                </span>
              </p>

              {editable ? (
                <OverlayButton
                  tone="danger"
                  onClick={() => {
                    api.quitRaid.mutate();
                    onClose();
                  }}
                  disabled={api.quitRaid.isPending}
                >
                  <Unlink className="size-3.5" />
                  Quitter le raid
                </OverlayButton>
              ) : null}
            </div>
          </>
        ) : editable ? (
          <div className="shrink-0 space-y-3">
            <OverlayButton
              onClick={() => api.startRaid.mutate(undefined)}
              disabled={api.startRaid.isPending}
            >
              {api.startRaid.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Créer un raid
            </OverlayButton>

            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                const typed = code.trim();
                if (typed) api.enterRaid.mutate(typed);
              }}
            >
              <CodeInput
                value={code}
                onChange={setCode}
                label="Code du raid"
              />
              <OverlayButton
                type="submit"
                disabled={api.enterRaid.isPending || !code.trim()}
              >
                {api.enterRaid.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Lier mon escouade
              </OverlayButton>
            </form>
          </div>
        ) : (
          <p className="shrink-0 text-[11px] text-nexus-accent/70">
            Seuls le chef de l'escouade et ses lieutenants peuvent l'emmener
            dans un raid.
          </p>
        )}

        {error ? (
          <p className="shrink-0 text-[11px] text-red-300">{errorText(error)}</p>
        ) : null}
      </div>
    </div>
  );
}

function SheetHeader({
  icon,
  title,
  onBack,
  onClose,
}: {
  icon: React.ReactNode;
  title: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-3 py-2">
      {onBack ? (
        <IconButton label="Retour" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>
      ) : (
        icon
      )}

      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-nexus-bright">
        {title}
      </p>

      <IconButton label="Fermer" onClick={onClose}>
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fields that are typed into                                          */
/* ------------------------------------------------------------------ */

/**
 * A field whose value is being written by someone while the poll keeps handing
 * over the server's.
 *
 * The rule: what the user typed wins until it has been sent. Nothing else is
 * acceptable — a refresh landing mid-word must never take the word away.
 */
function useTypedField(value: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  // Kept in a ref because the caller passes a fresh closure on every render,
  // and the timer below must not restart every time the poll re-renders us.
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  }, [onCommit]);

  // The server's value only flows in while the field is clean.
  useEffect(() => {
    if (!dirty) setDraft(value);
  }, [value, dirty]);

  useEffect(() => {
    if (!dirty) return;

    const timer = setTimeout(() => {
      commit.current(draft);
      setDirty(false);
    }, COMMIT_DELAY);

    return () => clearTimeout(timer);
  }, [draft, dirty]);

  return {
    draft,
    type(next: string) {
      setDraft(next);
      setDirty(true);
    },
    /** On the way out, without waiting for the delay. */
    flush() {
      if (!dirty) return;
      commit.current(draft);
      setDirty(false);
    },
  };
}

/** The name of the squad, or of the raid — the same click either way. */
function Title({
  squad,
  raid,
  raiding,
  editable,
  onRename,
}: {
  squad: Squad | null;
  raid: Raid | null;
  raiding: boolean;
  editable: boolean;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const name = raiding && raid ? raid.name : (squad?.name ?? "Escouade");

  if (!squad) {
    return (
      <p className="pointer-events-none flex-1 truncate text-sm font-medium text-nexus-bright">
        Escouade
      </p>
    );
  }

  if (editing) {
    return (
      <NameField
        value={name}
        max={raiding ? RAID_NAME_MAX_LENGTH : SQUAD_NAME_MAX_LENGTH}
        onDone={(next) => {
          setEditing(false);
          const trimmed = next.trim();
          if (trimmed && trimmed !== name) onRename(trimmed);
        }}
      />
    );
  }

  /*
   * The name itself stays inert, and the pencil beside it is what is clicked.
   *
   * The header *is* the title bar — the window has no decorations — so anything
   * that swallows a drag there costs the only handle the overlay has. A button
   * over the name would take most of it.
   */
  return (
    <>
      <p className="pointer-events-none min-w-0 flex-1 truncate text-sm font-medium text-nexus-bright">
        {name}
      </p>

      {editable ? (
        <IconButton
          label={raiding ? "Renommer le raid" : "Renommer l'escouade"}
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3" />
        </IconButton>
      ) : null}
    </>
  );
}

/**
 * Committed on Enter or on the way out, not per keystroke: a name is read by
 * everyone, and half of one flashing through four other overlays is noise.
 */
function NameField({
  value,
  max,
  onDone,
}: {
  value: string;
  max: number;
  onDone: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <input
      aria-label="Nom"
      value={draft}
      maxLength={max}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onDone(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onDone(draft);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onDone(value);
        }
      }}
      className={cn(
        "min-w-0 flex-1 rounded px-1.5 py-0.5 text-sm font-medium",
        SURFACE,
        "text-nexus-bright",
      )}
    />
  );
}

function PositionField({
  value,
  onCommit,
  onDone,
}: {
  value: string;
  onCommit: (value: string) => void;
  onDone: () => void;
}) {
  const field = useTypedField(value, onCommit);

  return (
    <input
      aria-label="Position"
      value={field.draft}
      maxLength={POSITION_MAX_LENGTH}
      autoFocus
      onChange={(event) => field.type(event.target.value)}
      onBlur={() => {
        field.flush();
        onDone();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
      placeholder="Position"
      spellCheck={false}
      className={cn(
        "ml-[44px] w-[calc(100%-44px)] rounded px-1.5 py-px text-[11px]",
        SURFACE,
        "text-nexus-accent placeholder:text-nexus-accent/40",
      )}
    />
  );
}

/** Text until someone writes it: a field with nothing in it is noise over a game. */
function Announcement({
  value,
  editable,
  onCommit,
  placeholder,
  icon,
}: {
  value: string;
  editable: boolean;
  onCommit: (value: string) => void;
  placeholder: string;
  icon?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const field = useTypedField(value, onCommit);

  if (editing && editable) {
    return (
      <textarea
        aria-label={placeholder}
        value={field.draft}
        maxLength={ANNOUNCEMENTS_MAX_LENGTH}
        rows={2}
        autoFocus
        onChange={(event) => field.type(event.target.value)}
        onBlur={() => {
          field.flush();
          setEditing(false);
        }}
        placeholder={placeholder}
        className={cn(
          "shrink-0 resize-none rounded px-2 py-1 text-[11.5px] leading-relaxed",
          SURFACE,
          "text-nexus-soft placeholder:text-nexus-accent/40",
        )}
      />
    );
  }

  if (!value && !editable) return null;

  const body = (
    <>
      {icon ?? (
        <Megaphone className="mt-0.5 size-3 shrink-0 text-nexus-accent/55" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap text-left text-[11.5px] leading-relaxed",
          value ? "text-nexus-soft" : "text-nexus-accent/40",
        )}
      >
        {value || placeholder}
      </span>
    </>
  );

  if (!editable) {
    return (
      <div className="flex shrink-0 items-start gap-1.5 px-1 py-0.5">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      title={placeholder}
      onClick={() => setEditing(true)}
      className="flex shrink-0 items-start gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-nexus-accent/10"
    >
      {body}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Bits and pieces                                                     */
/* ------------------------------------------------------------------ */

function Footer({
  counts,
  children,
}: {
  counts: { ready: number; total: number; down: number };
  children: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2">
      {/* Not dimmed like a caption would be on a panel: over a bright scene
          there is nothing to be quiet against. */}
      <p className="text-[11px] text-nexus-accent/80">
        {counts.ready}/{counts.total} prêts
        {counts.down ? (
          <span className="text-red-300">
            {" · "}
            {counts.down} éliminé{counts.down > 1 ? "s" : ""}
          </span>
        ) : null}
      </p>

      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * A little panel hung off a row, and the invisible sheet that closes it.
 *
 * The backdrop is what makes a click anywhere else dismiss the thing, which is
 * the only behaviour anyone expects from a menu — and over a game, the only one
 * that does not leave a popover stranded on the cockpit.
 */
function Popover({
  onClose,
  className,
  children,
}: {
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        className={cn(
          "absolute z-20 rounded-lg border border-nexus-accent/25 bg-nexus-deep p-1.5 shadow-xl shadow-black/50",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

function MenuItem({
  icon,
  tone,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  tone?: "danger";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition hover:bg-nexus-accent/10",
        tone === "danger" ? "text-red-300" : "text-nexus-bright",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** The two states a row shows without being asked. */
function RowToggle({
  title,
  disabled,
  dimmed,
  onClick,
  children,
}: {
  title: string;
  disabled: boolean;
  dimmed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded transition",
        disabled ? "cursor-default" : "hover:bg-nexus-accent/15",
        dimmed && "opacity-30",
      )}
    >
      <span className="sr-only">{title}</span>
      {children}
    </button>
  );
}

function CodeInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value.toUpperCase())}
      placeholder="CODE"
      spellCheck={false}
      className={cn(
        "w-28 rounded px-2 py-1 font-mono text-sm uppercase tracking-widest",
        SURFACE,
        "text-nexus-bright placeholder:text-nexus-accent/40",
      )}
    />
  );
}

/** The code, and a click to put it on the clipboard for whoever asks. */
function CodeButton({ code, tone }: { code: string; tone?: "raid" }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      title="Copier le code"
      onClick={() => {
        void navigator.clipboard
          .writeText(code)
          .then(() => setCopied(true))
          // The code is written right there and selectable, so a refused
          // clipboard costs nothing worth reporting.
          .catch(() => undefined);
      }}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] tracking-widest",
        SURFACE,
        tone === "raid" && "border-amber-300/35",
        "text-nexus-bright hover:bg-nexus-abyss/80",
      )}
    >
      {code}
      {copied ? (
        <Check className="size-3 text-emerald-300" />
      ) : (
        <Copy className="size-3 text-nexus-accent/60" />
      )}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="shrink-0 rounded p-1 text-nexus-accent/70 transition hover:bg-nexus-abyss/60 hover:text-nexus-bright"
    >
      <span className="sr-only">{label}</span>
      {children}
    </button>
  );
}

function OverlayButton({
  children,
  tone = "normal",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "normal" | "danger";
}) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition",
        SURFACE,
        tone === "danger"
          ? "text-red-300 hover:bg-red-500/20"
          : "text-nexus-bright hover:bg-nexus-abyss/80",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
