import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import {
  getContribNotifications,
  getNotificationCorner,
  setContribNotifications,
  setNotificationCorner,
} from "@/lib/settings";
import {
  applyNotificationCorner,
  DEFAULT_NOTIFICATION_CORNER,
  notify,
  NOTIFICATION_CORNERS,
  type NotificationCorner,
} from "@/lib/notifications";
import { Button, Card, Field, Select } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
  SettingsSectionHeader,
} from "@/components/settings/section-header";

/** Each corner's key in the messages. */
const CORNER_KEYS = {
  "bottom-right": "bottomRight",
  "bottom-left": "bottomLeft",
  "top-right": "topRight",
  "top-left": "topLeft",
} as const satisfies Record<NotificationCorner, string>;

export function NotificationsSection() {
  const t = useTranslations("SettingsNotifications");
  const [corner, setCorner] = useState<NotificationCorner>(
    DEFAULT_NOTIFICATION_CORNER,
  );
  const [notificationError, setNotificationError] = useState<string | null>(
    null,
  );

  const [contrib, setContrib] = useState(true);

  useEffect(() => {
    void getNotificationCorner().then(setCorner);
    void getContribNotifications().then(setContrib);
  }, []);

  function handleContribChange(next: boolean) {
    setContrib(next);
    void setContribNotifications(next).catch((cause) => {
      setContrib(!next);
      setNotificationError(
        cause instanceof Error ? cause.message : t("contribError"),
      );
    });
  }

  /**
   * The choice is applied and shown at once: a corner is far easier to pick
   * when the example lands in it while the list is still open.
   */
  async function handleCornerChange(next: NotificationCorner) {
    setCorner(next);
    setNotificationError(null);

    try {
      // Persisted before it is applied, so a corner the overlay refuses is
      // still the one taken at the next start — and inside the try, because a
      // store that will not write is exactly what the user needs told.
      await setNotificationCorner(next);
      await applyNotificationCorner(next);
      await notify({
        title: t("title"),
        body: t(`cornerApplied.${CORNER_KEYS[next]}`),
      });
    } catch (cause) {
      setNotificationError(
        cause instanceof Error ? cause.message : t("cornerError"),
      );
    }
  }

  return (
    <section>
      <SettingsSectionHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void notify({
                kind: "success",
                title: "Nexus App",
                body: t("exampleBody"),
              })
            }
          >
            {t("showExample")}
          </Button>
        }
      />

      <Card>
        <SettingsCardTitle>{t("display")}</SettingsCardTitle>
        <div className="space-y-4 p-4">
          <Field label={t("corner")}>
            <Select
              value={corner}
              onChange={(event) =>
                void handleCornerChange(
                  event.target.value as NotificationCorner,
                )
              }
            >
              {NOTIFICATION_CORNERS.map((value) => (
                <option key={value} value={value}>
                  {t(`corners.${CORNER_KEYS[value]}`)}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex cursor-pointer items-start gap-2 text-[13.5px] text-nexus-bright">
            <input
              type="checkbox"
              checked={contrib}
              onChange={(event) => handleContribChange(event.target.checked)}
              className="mt-0.5 accent-nexus-accent"
            />
            <span>
              {t("contrib")}
              <small className="mt-0.5 block text-xs text-nexus-dim">
                {t("contribHint")}
              </small>
            </span>
          </label>

          {notificationError ? (
            <SettingsError>{notificationError}</SettingsError>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
