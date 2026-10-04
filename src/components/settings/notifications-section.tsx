import { useEffect, useState } from "react";
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
  NOTIFICATION_CORNER_LABELS,
  NOTIFICATION_CORNERS,
  type NotificationCorner,
} from "@/lib/notifications";
import { Button, Card, Field, Select } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsError,
  SettingsSectionHeader,
} from "@/components/settings/section-header";

export function NotificationsSection() {
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
        cause instanceof Error
          ? cause.message
          : "Le réglage n'a pas pu être enregistré.",
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
        title: "Notifications",
        body: `Elles s'afficheront ${NOTIFICATION_CORNER_LABELS[next].toLowerCase()}.`,
      });
    } catch (cause) {
      setNotificationError(
        cause instanceof Error
          ? cause.message
          : "Le coin d'affichage n'a pas pu être appliqué. Il le sera au prochain démarrage.",
      );
    }
  }

  return (
    <section>
      <SettingsSectionHeader
        title="Notifications"
        description="Elles s'affichent par-dessus le jeu, dans le coin choisi de l'écran où se trouve le curseur, puis disparaissent d'elles-mêmes. Survolez-en une pour la garder à l'écran."
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void notify({
                kind: "success",
                title: "Nexus App",
                body: "Ceci est un exemple de notification.",
              })
            }
          >
            Afficher un exemple
          </Button>
        }
      />

      <Card>
        <SettingsCardTitle>Affichage</SettingsCardTitle>
        <div className="space-y-4 p-4">
          <Field label="Coin d'affichage">
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
                  {NOTIFICATION_CORNER_LABELS[value]}
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
              Mes contributions
              <small className="mt-0.5 block text-xs text-nexus-dim">
                Publiée, à corriger, succès débloqué ou nouveau niveau.
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
