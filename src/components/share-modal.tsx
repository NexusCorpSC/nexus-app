import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Share2, UserPlus, Users, X } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button, Modal, SearchField, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api-client";
import {
  disableShareLink,
  getSharePanel,
  inviteToShare,
  removeFromShare,
  renewShareLink,
  searchShareCandidates,
} from "@/lib/api/shares";
import { cn } from "@/lib/utils";
import type { ShareEntry, ShareKind, SharePanelData } from "@/types/nexus";

/** The site's refusals, by code, said the app's way. */
function errorMessage(
  error: unknown,
  t: ReturnType<typeof useTranslations<"Share">>,
): string {
  const code =
    error instanceof ApiError
      ? (error.body as { error?: string } | undefined)?.error
      : undefined;
  switch (code) {
    case "self":
    case "userNotFound":
    case "tooManyShares":
    case "tooManyInvites":
    case "forbidden":
      return t(`errors.${code}`);
    default:
      return t("errors.unknown");
  }
}

/**
 * Sharing an event or a private place: invite a player (friends first), see
 * who has access and take it back, and for an event its share link. The same
 * as the site's «Partager» panel.
 */
export function ShareModal({
  kind,
  id,
  open,
  onClose,
}: {
  kind: ShareKind;
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Share");
  const queryClient = useQueryClient();
  const key = ["shares", kind, id];
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const panel = useQuery({
    queryKey: key,
    queryFn: () => getSharePanel(kind, id),
    enabled: open,
  });

  const candidates = useQuery({
    queryKey: ["shares", "candidates", kind, id, debounced],
    queryFn: () => searchShareCandidates(debounced, { kind, id }),
    enabled: open,
  });

  const change = useMutation({
    mutationFn: (run: () => Promise<SharePanelData>) => run(),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      void queryClient.invalidateQueries({
        queryKey: ["shares", "candidates", kind, id],
      });
    },
  });

  const data = panel.data;
  const busy = change.isPending;

  function copy(url: string) {
    // Absent outside a secure context, and in some webviews: the link stays
    // on screen to be copied by hand.
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard
      .writeText(url)
      .then(() => setCopied(true))
      .catch(() => {});
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Share2 className="size-5" />}
      title={data ? t("title", { name: data.title }) : t("loading")}
      description={kind === "event" ? t("introEvent") : t("introPlace")}
    >
      {panel.isPending ? (
        <Spinner />
      ) : panel.isError ? (
        <p className="text-[13px] text-red-300">{errorMessage(panel.error, t)}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className={label}>{t("invite")}</h3>
            <SearchField
              label={t("invite")}
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0"
            />
            {(candidates.data ?? []).length > 0 ? (
              <ul className="divide-y divide-nexus-accent/10 rounded-lg border border-nexus-accent/15">
                {candidates.data!.map((candidate) => (
                  <li
                    key={candidate.userId}
                    className="flex items-center gap-2.5 px-3 py-2 text-[13px]"
                  >
                    <Avatar src={candidate.avatar} name={candidate.name} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate font-semibold text-nexus-white">
                        {candidate.name}
                      </b>
                      {candidate.isFriend ? (
                        <span className="text-xs text-nexus-muted">
                          {t("friend")}
                        </span>
                      ) : null}
                    </span>
                    {candidate.hasAccess ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-300">
                        <Check className="size-3.5" />
                        {t("hasAccess")}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          change.mutate(() =>
                            inviteToShare(kind, id, candidate.userId),
                          )
                        }
                      >
                        <UserPlus className="size-3.5" />
                        {t("inviteButton")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : debounced.trim() && !candidates.isPending ? (
              <p className="text-xs text-nexus-muted">{t("noMatch")}</p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className={label}>{t("haveAccess")}</h3>
            <ul className="divide-y divide-nexus-accent/10 rounded-lg border border-nexus-accent/15">
              {data?.org ? (
                <li className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                  <span className="flex size-7 items-center justify-center rounded-full border border-violet-300/40 text-violet-200">
                    <Users className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-semibold text-nexus-white">
                      {t("orgMembers", { org: data.org.name })}
                    </b>
                    <span className="text-xs text-nexus-muted">
                      {t("memberCount", { count: data.org.memberCount })}
                    </span>
                  </span>
                </li>
              ) : null}
              {(data?.shares ?? []).map((share) => (
                <Guest
                  key={share.userId}
                  share={share}
                  disabled={busy}
                  onRemove={() =>
                    change.mutate(() => removeFromShare(kind, id, share.userId))
                  }
                />
              ))}
              {!data?.org && (data?.shares ?? []).length === 0 ? (
                <li className="px-3 py-2.5 text-[13px] text-nexus-muted">
                  {t("nobody")}
                </li>
              ) : null}
            </ul>
          </section>

          {data?.allowLink ? (
            <section className="flex flex-col gap-2">
              <h3 className={label}>{t("link")}</h3>
              {data.link ? (
                <>
                  <div className="flex min-w-0 gap-2">
                    <input
                      readOnly
                      value={data.link.url}
                      onFocus={(event) => event.currentTarget.select()}
                      className="h-9.5 min-w-0 flex-1 rounded-lg border border-cyan-300/30 bg-nexus-card px-3 font-mono text-xs text-cyan-200"
                    />
                    <Button variant="outline" onClick={() => copy(data.link!.url)}>
                      <Link2 className="size-4" />
                      {copied ? t("copied") : t("copy")}
                    </Button>
                  </div>
                  <p className="text-xs text-nexus-muted">{t("linkHint")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => change.mutate(() => renewShareLink(kind, id))}
                    >
                      {t("newLink")}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        change.mutate(() => disableShareLink(kind, id))
                      }
                    >
                      {t("disableLink")}
                    </Button>
                  </div>
                  <p className="text-xs text-nexus-dim">{t("disableHint")}</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-nexus-muted">{t("noLink")}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start"
                    disabled={busy}
                    onClick={() => change.mutate(() => renewShareLink(kind, id))}
                  >
                    <Link2 className="size-3.5" />
                    {t("createLink")}
                  </Button>
                </>
              )}
            </section>
          ) : null}

          {change.isError ? (
            <p className="text-[13px] text-red-300">
              {errorMessage(change.error, t)}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

const label =
  "font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase";

function Avatar({ src, name }: { src: string | null; name: string }) {
  return src ? (
    <img
      src={src}
      alt=""
      className="size-7 shrink-0 rounded-full border border-nexus-accent/25"
    />
  ) : (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-nexus-accent/25 bg-nexus-panel text-[11px] font-semibold text-nexus-soft">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function Guest({
  share,
  disabled,
  onRemove,
}: {
  share: ShareEntry;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("Share");
  return (
    <li className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
      <Avatar src={share.avatar} name={share.name} />
      <span className="min-w-0 flex-1">
        <b className="block truncate font-semibold text-nexus-white">
          {share.name}
        </b>
        <span className="text-xs text-nexus-muted">
          {share.via === "link"
            ? t("cameByLink", { date: new Date(share.createdAt) })
            : share.invitedByName
              ? t("invitedBy", { name: share.invitedByName })
              : null}
        </span>
      </span>
      <span
        className={cn(
          "text-xs whitespace-nowrap",
          share.via === "link"
            ? "text-cyan-300"
            : share.seen
              ? "text-emerald-300"
              : "text-nexus-muted",
        )}
      >
        {share.via === "link"
          ? t("byLink")
          : share.seen
            ? t("seen")
            : t("unseen")}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={t("remove", { name: share.name })}
        className="inline-flex size-7 items-center justify-center rounded-md text-nexus-muted hover:bg-nexus-panel hover:text-nexus-soft"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}
