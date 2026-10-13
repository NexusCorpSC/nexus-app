import { useState, type ReactNode } from "react";
import { Radio } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

import type { usePositionSharing } from "@/hooks/use-position-sharing";
import { cn } from "@/lib/utils";
import type {
  MyPositionSharing,
  PlayerInGame,
} from "@/types/player-positions";

/** La couleur des joueurs, la même que sur la Star Map du site. */
export const PLAYER_COLOR = "#ff9f7a";

type Sharing = ReturnType<typeof usePositionSharing>;

/**
 * « Partager ma position », sous « Ma position » : l'interrupteur, qui me
 * voit, et le dernier envoi. Activer passe d'abord par le choix de l'audience.
 */
export function ShareCard({
  share,
  error,
  now,
  locked,
  formatAge,
  onChoose,
}: {
  share: Sharing;
  /** La dernière erreur d'envoi d'un relevé. */
  error: string | null;
  now: number;
  locked: boolean;
  formatAge: (ms: number) => string;
  onChoose: () => void;
}) {
  const t = useTranslations("NpsOverlay.share");
  const format = useFormatter();
  const { sharing, query } = share;

  if (share.unauthorized) {
    return (
      <section className="rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-slate-400">
        {t("signIn")}
      </section>
    );
  }
  if (!sharing) {
    return query.isError ? (
      <section className="rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-slate-400">
        {t("loadFailed")}
      </section>
    ) : null;
  }

  const enabled = sharing.sharing.enabled;
  const who = audienceOf(sharing, t);
  const failure =
    error ?? (share.save.error ? String(share.save.error.message) : null);

  return (
    <section
      className="space-y-1 rounded-lg border px-2.5 py-2 text-[12px]"
      style={{
        borderColor: enabled ? `${PLAYER_COLOR}66` : "rgb(255 255 255 / 0.1)",
        backgroundColor: enabled ? `${PLAYER_COLOR}0f` : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        <Radio
          className="size-3.5 shrink-0"
          style={{ color: enabled ? PLAYER_COLOR : undefined }}
        />
        <p
          className="flex-1 text-[11px] uppercase tracking-wide"
          style={{ color: enabled ? PLAYER_COLOR : undefined }}
        >
          {t("title")}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={locked || share.save.isPending}
          onClick={() => {
            if (enabled) share.save.mutate({ enabled: false });
            else onChoose();
          }}
          title={enabled ? t("stop") : t("start")}
          className={cn(
            "relative h-4 w-7 shrink-0 rounded-full border transition disabled:opacity-40",
            enabled ? "border-transparent" : "border-white/25 bg-white/10",
          )}
          style={enabled ? { backgroundColor: PLAYER_COLOR } : undefined}
        >
          <span className="sr-only">{enabled ? t("stop") : t("start")}</span>
          <span
            className={cn(
              "absolute top-0.5 size-2.5 rounded-full transition-all",
              enabled ? "left-3.5 bg-slate-950" : "left-0.5 bg-slate-300",
            )}
          />
        </button>
      </div>

      {!enabled ? (
        <p className="text-[11px] text-slate-400">{t("off")}</p>
      ) : (
        <>
          <p className="text-slate-200">
            {who.length > 0
              ? t("audience", {
                  who: format.list(who, { type: "conjunction" }),
                })
              : t("nobody")}
          </p>
          {!sharing.playing ? (
            <p className="text-[11px] text-amber-200">
              {t("notPlaying")}{" "}
              <button
                type="button"
                disabled={locked || share.resume.isPending}
                onClick={() => share.resume.mutate()}
                className="underline underline-offset-2 hover:text-amber-100 disabled:opacity-40"
              >
                {t("resume")}
              </button>
            </p>
          ) : sharing.position ? (
            <p className="text-[11px] text-emerald-300">
              {t("sent", {
                age: formatAge(now - Date.parse(sharing.position.at)),
              })}
              {sharing.position.bodyName ?? sharing.position.systemName
                ? ` · ${sharing.position.bodyName ?? sharing.position.systemName}`
                : null}
            </p>
          ) : (
            <p className="text-[11px] text-slate-400">{t("waitingFix")}</p>
          )}
        </>
      )}
      {failure ? <p className="text-[11px] text-red-300">{failure}</p> : null}
      <button
        type="button"
        disabled={locked}
        onClick={onChoose}
        className="rounded px-1 py-0.5 text-[11px] text-slate-300 transition hover:bg-white/10 hover:text-slate-100 disabled:opacity-40"
      >
        {t("choose")}
      </button>
    </section>
  );
}

/** Ceux qui me voient, tels que la carte les nomme. */
function audienceOf(
  sharing: MyPositionSharing,
  t: ReturnType<typeof useTranslations<"NpsOverlay.share">>,
): string[] {
  const chosen = new Set(sharing.sharing.orgIds);
  return [
    ...(sharing.sharing.friends ? [t("friends")] : []),
    ...sharing.orgs.filter((org) => chosen.has(org.id)).map((org) => org.name),
  ];
}

/**
 * « Qui voit ma position » : mes amis et chacune de mes organisations.
 * À la première activation, tout est coché, comme sur le site.
 */
export function SharePanel({
  share,
  header,
  onDone,
}: {
  share: Sharing;
  header: ReactNode;
  onDone: () => void;
}) {
  const t = useTranslations("NpsOverlay.share");
  const sharing = share.sharing;
  const enabled = sharing?.sharing.enabled ?? false;
  const [friends, setFriends] = useState(
    sharing ? (enabled ? sharing.sharing.friends : true) : true,
  );
  const [orgIds, setOrgIds] = useState<Set<string>>(
    () =>
      new Set(
        !sharing
          ? []
          : enabled || sharing.sharing.orgIds.length > 0
            ? sharing.sharing.orgIds
            : sharing.orgs.map((org) => org.id),
      ),
  );

  function toggleOrg(id: string) {
    setOrgIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    share.save.mutate(
      { enabled: true, friends, orgIds: [...orgIds] },
      { onSuccess: onDone },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      {header}
      {!sharing ? (
        <p className="text-[12px] text-slate-400">
          {share.unauthorized ? t("signIn") : t("loadFailed")}
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto text-[12px]">
          <label className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-white/5">
            <input
              type="checkbox"
              checked={friends}
              onChange={(event) => setFriends(event.target.checked)}
              style={{ accentColor: PLAYER_COLOR }}
            />
            <span className="flex-1">{t("myFriends")}</span>
            <span className="text-[11px] tabular-nums text-slate-500">
              {sharing.friends}
            </span>
          </label>
          {sharing.orgs.length > 0 ? (
            <>
              <p className="px-1 text-[11px] uppercase tracking-wide text-slate-500">
                {t("myOrgs")}
              </p>
              {sharing.orgs.map((org) => (
                <label
                  key={org.id}
                  className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={orgIds.has(org.id)}
                    onChange={() => toggleOrg(org.id)}
                    style={{ accentColor: PLAYER_COLOR }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {org.name}
                    {org.tag ? <Tag>{org.tag}</Tag> : null}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {t("members", { count: org.members })}
                  </span>
                </label>
              ))}
            </>
          ) : null}
          <p className="text-[11px] text-slate-400">{t("explain")}</p>
          {!enabled && !sharing.playing ? (
            <p className="text-[11px] text-amber-200">{t("declares")}</p>
          ) : null}
          {share.save.error ? (
            <p className="text-[11px] text-red-300">
              {share.save.error.message}
            </p>
          ) : null}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onDone}
              className="flex-1 rounded-lg px-3 py-1.5 text-[12px] text-slate-300 transition hover:bg-white/10"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={share.save.isPending}
              className="flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-950 transition hover:brightness-110 disabled:opacity-50"
              style={{ backgroundColor: PLAYER_COLOR }}
            >
              {share.save.isPending
                ? t("saving")
                : enabled
                  ? t("save")
                  : t("confirm")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Le tag d'une organisation, à côté d'un nom. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1.5 rounded border border-white/20 px-1 font-mono text-[10px] text-slate-300">
      {children}
    </span>
  );
}

/**
 * L'initiale d'un joueur dans un rond corail : plein pour un ami, pointillé
 * pour un membre d'organisation, comme sur la Star Map.
 */
export function PlayerAvatar({
  player,
  className,
}: {
  player: Pick<PlayerInGame, "name" | "friend">;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        player.friend ? "text-slate-950" : "border border-dashed",
        className,
      )}
      style={
        player.friend
          ? { backgroundColor: PLAYER_COLOR }
          : { borderColor: PLAYER_COLOR, color: PLAYER_COLOR }
      }
    >
      {player.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
