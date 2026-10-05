import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslations } from "use-intl";
import { getMyContrib } from "@/lib/api/contrib";
import { getApiBaseUrl } from "@/lib/settings";
import { useAuth } from "@/auth/auth-context";
import { getMyDisplayOrg, setMyDisplayOrg } from "@/lib/api/display-org";
import { Button, Card, Field, Select } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
  SettingsSectionHeader,
} from "@/components/settings/section-header";

const DISPLAY_ORG_KEY = ["display-org"] as const;

/** Without a choice: each friend sees the first organization in common. */
const AUTO = "";

/** Who the app is signed in as on the current instance, and their profile. */
export function AccountSection() {
  const t = useTranslations("SettingsAccount");
  const { user } = useAuth();

  return (
    <section>
      <SettingsSectionHeader
        title={t("title")}
        description={t("description")}
      />

      <div className="space-y-4">
        <Card>
          <SettingsCardTitle>{t("session")}</SettingsCardTitle>
          <dl className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
            <dt className="text-nexus-muted">{t("signedInAs")}</dt>
            <dd className="text-nexus-white">
              {user ? user.email : t("signedOut")}
            </dd>
          </dl>
        </Card>

        {user ? <ContribCard /> : null}
        {user ? <DisplayOrgCard /> : null}
      </div>
    </section>
  );
}

/** The organization shown with the reader's name, saved as soon as picked. */
function DisplayOrgCard() {
  const t = useTranslations("SettingsAccount.profile");
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: DISPLAY_ORG_KEY,
    queryFn: getMyDisplayOrg,
  });
  const save = useMutation({
    mutationFn: setMyDisplayOrg,
    onSuccess: (value) => queryClient.setQueryData(DISPLAY_ORG_KEY, value),
  });

  const organizations = current.data?.organizations ?? [];

  return (
    <Card>
      <SettingsCardTitle>{t("title")}</SettingsCardTitle>
      <div className="space-y-3 p-4">
        {current.isError ? (
          <SettingsError>{t("loadError")}</SettingsError>
        ) : current.data && organizations.length === 0 ? (
          <p className="text-[13px] text-nexus-muted">{t("noOrganization")}</p>
        ) : (
          <Field label={t("label")}>
            <Select
              value={
                save.isPending
                  ? (save.variables ?? AUTO)
                  : (current.data?.orgId ?? AUTO)
              }
              disabled={current.isPending || save.isPending}
              onChange={(event) =>
                save.mutate(
                  event.target.value === AUTO ? null : event.target.value,
                )
              }
            >
              <option value={AUTO}>{t("auto")}</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.tag ? `${org.name} [${org.tag}]` : org.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {save.isError ? <SettingsError>{t("saveError")}</SettingsError> : null}
        <p className="text-xs leading-relaxed text-nexus-dim">{t("hint")}</p>
      </div>
    </Card>
  );
}

/**
 * The player's level as a contributor, and the way to the site's profile:
 * heavy editing (drawn plans, new items) is done there, not here.
 */
function ContribCard() {
  const t = useTranslations("SettingsAccount.contrib");
  const contrib = useQuery({
    queryKey: ["me-contrib"],
    // Without `since`: this card only reads, the watcher keeps the mark.
    queryFn: () => getMyContrib(),
  });

  const data = contrib.data;
  const progress =
    data?.nextLevelPoints !== undefined
      ? Math.min(100, Math.round((data.points / data.nextLevelPoints) * 100))
      : 100;

  async function openProfile() {
    await openUrl(`${await getApiBaseUrl()}/contributions`);
  }

  return (
    <Card>
      <SettingsCardTitle>{t("title")}</SettingsCardTitle>
      <div className="space-y-3 p-4">
        {contrib.isError ? (
          <SettingsError>{t("loadError")}</SettingsError>
        ) : data ? (
          <>
            <div className="flex items-center gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border-2 border-nexus-accent/60 font-mono text-lg font-bold text-nexus-bright">
                {t("levelBadge", { level: data.level })}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <strong className="text-[15px] text-nexus-white">
                    {data.levelName}
                  </strong>
                  <span className="font-mono text-[13px] font-bold text-amber-200">
                    {data.nextLevelPoints !== undefined
                      ? t("pointsOf", {
                          points: data.points,
                          next: data.nextLevelPoints,
                        })
                      : t("points", { points: data.points })}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-nexus-accent/15">
                  <div
                    className="h-full rounded bg-nexus-accent"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-nexus-muted">
                  {data.nextLevelName
                    ? t("nextLevel", {
                        name: data.nextLevelName,
                        points: data.nextLevelPoints ?? 0,
                      })
                    : t("lastLevel")}{" "}
                  {data.achievements.length > 0
                    ? t("achievements", { count: data.achievements.length })
                    : null}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-relaxed text-nexus-dim">
                {t("siteHint")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void openProfile().catch((error) =>
                    console.error("cannot open the contributions page", error),
                  )
                }
              >
                {t("openSite")}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-nexus-muted">{t("loading")}</p>
        )}
      </div>
    </Card>
  );
}
