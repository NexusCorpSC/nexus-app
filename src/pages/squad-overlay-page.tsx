import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  Copy,
  Crown,
  Loader2,
  LogOut,
  Plus,
  Skull,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { useSquad } from "@/hooks/use-squad";
import { useTransparentWindow } from "@/hooks/use-transparent-window";
import { useOverlayOpaque } from "@/hooks/use-overlay-opacity";
import { OverlayOpacityButton } from "@/components/overlay-opacity-button";
import { overlaySkin } from "@/lib/overlay-opacity";
import {
  ANNOUNCEMENTS_MAX_LENGTH,
  POSITION_MAX_LENGTH,
  type Squad,
  type SquadMember,
  type SquadMemberPatch,
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
 * It also carries its own management — create, join by code, leave — because
 * there is no squad screen in the main window. So it has three states: signed
 * out, no squad, and in a squad.
 */

/** Long enough that typing a position does not send a request per keystroke. */
const COMMIT_DELAY = 600;

export default function SquadOverlayPage() {
  const { user, loading: session } = useAuth();
  const { state, create, join, leave, patchMember, removeMember, announce } =
    useSquad(Boolean(user));

  useTransparentWindow();

  // This one alone starts see-through: it was built that way. The header
  // button brings its panel back, and the global shortcut lines the three
  // overlays up on the same mode.
  const opaque = useOverlayOpaque("squad");

  function close() {
    void invoke("close_squad_overlay");
  }

  const squad = state.squad ?? null;

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden text-nexus-accent",
        // See-through, this is a shadow behind every glyph; opaque, it is the
        // same panel the other two overlays wear.
        overlaySkin(opaque),
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close();
      }}
    >
      {/* No decorations, so the header doubles as the title bar. */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 cursor-grab items-center gap-2 px-3 py-2"
      >
        <Users className="pointer-events-none size-4 text-nexus-accent/70" />
        <p className="pointer-events-none flex-1 truncate text-sm font-medium text-nexus-bright">
          {squad ? squad.name : "Escouade"}
        </p>

        {squad ? <CodeButton code={squad.code} /> : null}

        <OverlayOpacityButton
          label="squad"
          opaque={opaque}
          className="text-nexus-accent/70 hover:bg-nexus-abyss/60 hover:text-nexus-bright"
        />

        <IconButton label="Fermer" onClick={close}>
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        {session ? (
          <p className="text-xs text-nexus-accent/70">Session…</p>
        ) : !user ? (
          <p className="text-xs text-nexus-accent/80">
            Connectez-vous dans la fenêtre principale pour créer une escouade ou
            en rejoindre une.
          </p>
        ) : state.loading ? (
          <p className="text-xs text-nexus-accent/70">Chargement…</p>
        ) : squad ? (
          <SquadDashboard
            squad={squad}
            userId={user.id}
            onPatch={(userId, patch) => patchMember.mutate({ userId, patch })}
            onRemove={(userId) => removeMember.mutate(userId)}
            onAnnounce={(announcements) => announce.mutate(announcements)}
            onLeave={() => leave.mutate()}
            leaving={leave.isPending}
          />
        ) : (
          <NoSquad
            onCreate={() => create.mutate(undefined)}
            creating={create.isPending}
            onJoin={(code) => join.mutate(code)}
            joining={join.isPending}
            joinError={join.error}
          />
        )}
      </div>
    </div>
  );
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
        <input
          aria-label="Code de l'escouade"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="CODE"
          spellCheck={false}
          className={cn(
            "w-28 rounded px-2 py-1 font-mono text-sm uppercase tracking-widest",
            SURFACE,
            "text-nexus-bright placeholder:text-nexus-accent/40",
          )}
        />
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
/* In a squad                                                          */
/* ------------------------------------------------------------------ */

function SquadDashboard({
  squad,
  userId,
  onPatch,
  onRemove,
  onAnnounce,
  onLeave,
  leaving,
}: {
  squad: Squad;
  userId: string;
  onPatch: (userId: string, patch: SquadMemberPatch) => void;
  onRemove: (userId: string) => void;
  onAnnounce: (announcements: string) => void;
  onLeave: () => void;
  leaving: boolean;
}) {
  const isLeader = squad.leaderId === userId;

  // Longest-standing first, which is also the order of succession.
  const members = [...squad.members].sort((a, b) =>
    a.joinedAt.localeCompare(b.joinedAt),
  );

  return (
    <>
      <Announcements
        value={squad.announcements}
        editable={isLeader}
        onCommit={onAnnounce}
      />

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            isSelf={member.userId === userId}
            isLeader={squad.leaderId === member.userId}
            // A member writes to their own row; the leader writes to anyone's.
            editable={member.userId === userId || isLeader}
            // The leader puts people out; leaving is everyone's own business.
            onRemove={
              isLeader && member.userId !== userId
                ? () => onRemove(member.userId)
                : undefined
            }
            onPatch={(patch) => onPatch(member.userId, patch)}
          />
        ))}
      </ul>

      <div className="flex shrink-0 items-center justify-between gap-2">
        {/* Not dimmed like a caption would be on a panel: over a bright scene
            there is nothing to be quiet against. */}
        <p className="text-[11px] text-nexus-accent/80">
          {members.filter((member) => member.ready).length}/{members.length}{" "}
          prêts
        </p>

        <OverlayButton onClick={onLeave} disabled={leaving} tone="danger">
          {leaving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <LogOut className="size-3.5" />
          )}
          Quitter
        </OverlayButton>
      </div>
    </>
  );
}

function MemberRow({
  member,
  isSelf,
  isLeader,
  editable,
  onRemove,
  onPatch,
}: {
  member: SquadMember;
  isSelf: boolean;
  isLeader: boolean;
  editable: boolean;
  /** Absent for everyone but the leader, and for the leader's own row. */
  onRemove?: () => void;
  onPatch: (patch: SquadMemberPatch) => void;
}) {
  return (
    <li className="space-y-1 py-1">
      <div className="flex items-center gap-1.5">
        {isLeader ? (
          <span title="Chef de l'escouade" className="shrink-0">
            <Crown className="size-3 text-amber-300" />
            <span className="sr-only">Chef de l'escouade</span>
          </span>
        ) : null}

        <p
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            member.alive
              ? "text-nexus-bright"
              : "text-red-300/80 line-through decoration-red-300/60",
            isSelf ? "font-medium" : null,
          )}
        >
          {member.name}
        </p>

        <Toggle
          on={member.ready}
          disabled={!editable}
          onClick={() => onPatch({ ready: !member.ready })}
          onLabel="Prêt"
          offLabel="Pas prêt"
          onTone="text-emerald-300"
        />

        <Toggle
          on={member.alive}
          disabled={!editable}
          onClick={() => onPatch({ alive: !member.alive })}
          onLabel="Actif"
          offLabel="Éliminé"
          onTone="text-nexus-bright"
          offTone="text-red-300"
          offIcon={<Skull className="size-3" />}
        />

        {onRemove ? (
          <RemoveMember name={member.name} onConfirm={onRemove} />
        ) : null}
      </div>

      <PositionField
        value={member.position}
        editable={editable}
        onCommit={(position) => onPatch({ position })}
      />
    </li>
  );
}

/**
 * Putting someone out of the squad, asked twice.
 *
 * Once would be wrong here: the button sits a few pixels from two toggles that
 * are pressed constantly, over a game, often in a hurry — and a misfire costs
 * the other player the code and a rejoin, mid-drop. The second click is the same
 * bargain `CloseSheetButton` strikes on the cargo sheet.
 */
function RemoveMember({
  name,
  onConfirm,
}: {
  name: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        title={`Retirer ${name} de l'escouade`}
        onClick={() => setAsking(true)}
        className={cn(
          "flex shrink-0 items-center rounded px-1.5 py-0.5",
          SURFACE,
          "text-nexus-accent/60 transition hover:bg-red-500/20 hover:text-red-300",
        )}
      >
        <span className="sr-only">Retirer {name} de l'escouade</span>
        <UserMinus className="size-3" />
      </button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        title={`Retirer ${name} de l'escouade`}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
          SURFACE,
          "text-red-300 transition hover:bg-red-500/20",
        )}
      >
        <Check className="size-3" />
        Retirer
      </button>

      <button
        type="button"
        title="Annuler"
        onClick={() => setAsking(false)}
        className={cn(
          "flex items-center rounded px-1.5 py-0.5",
          SURFACE,
          "text-nexus-accent/70 transition hover:text-nexus-bright",
        )}
      >
        <span className="sr-only">Annuler</span>
        <X className="size-3" />
      </button>
    </span>
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

function PositionField({
  value,
  editable,
  onCommit,
}: {
  value: string;
  editable: boolean;
  onCommit: (value: string) => void;
}) {
  const field = useTypedField(value, onCommit);

  if (!editable) {
    return (
      <p className="truncate pl-1 text-xs text-nexus-accent/70">
        {value || "—"}
      </p>
    );
  }

  return (
    <input
      aria-label="Position"
      value={field.draft}
      maxLength={POSITION_MAX_LENGTH}
      onChange={(event) => field.type(event.target.value)}
      onBlur={field.flush}
      placeholder="Position"
      spellCheck={false}
      className={cn(
        "w-full rounded px-2 py-0.5 text-xs",
        SURFACE,
        "text-nexus-accent placeholder:text-nexus-accent/40",
      )}
    />
  );
}

function Announcements({
  value,
  editable,
  onCommit,
}: {
  value: string;
  editable: boolean;
  onCommit: (value: string) => void;
}) {
  const field = useTypedField(value, onCommit);

  if (!editable) {
    return value ? (
      <p className="shrink-0 whitespace-pre-wrap text-xs text-nexus-soft">
        {value}
      </p>
    ) : null;
  }

  return (
    <textarea
      aria-label="Annonces"
      value={field.draft}
      maxLength={ANNOUNCEMENTS_MAX_LENGTH}
      rows={2}
      onChange={(event) => field.type(event.target.value)}
      onBlur={field.flush}
      placeholder="Annonces à l'escouade"
      className={cn(
        "shrink-0 resize-none rounded px-2 py-1 text-xs",
        SURFACE,
        "text-nexus-soft placeholder:text-nexus-accent/40",
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Bits and pieces                                                     */
/* ------------------------------------------------------------------ */

/**
 * The faint tint every control gets. The window has no background on purpose,
 * but a field or a button with nothing behind it is unusable over a game.
 */
const SURFACE =
  "border border-nexus-accent/20 bg-nexus-abyss/50 backdrop-blur-sm focus:border-nexus-accent/50 focus:outline-none";

function Toggle({
  on,
  disabled,
  onClick,
  onLabel,
  offLabel,
  onTone,
  offTone = "text-nexus-accent/50",
  offIcon,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
  onTone: string;
  offTone?: string;
  offIcon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      title={on ? onLabel : offLabel}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition",
        SURFACE,
        on ? onTone : offTone,
        disabled ? "cursor-default opacity-70" : "hover:bg-nexus-abyss/80",
      )}
    >
      {on ? <Check className="size-3" /> : (offIcon ?? null)}
      {on ? onLabel : offLabel}
    </button>
  );
}

/** The code, and a click to put it on the clipboard for whoever asks. */
function CodeButton({ code }: { code: string }) {
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
        "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs tracking-widest",
        SURFACE,
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
      )}
    >
      {children}
    </button>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
