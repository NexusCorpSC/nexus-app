import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { useTelemetry } from "@/hooks/use-telemetry";
import {
  TelemetryBadge,
  TelemetryEvents,
  TelemetryPanel,
} from "@/components/telemetry/telemetry-panel";
import { GameActions } from "@/components/telemetry/game-actions";

/**
 * The game's telemetry: what Star Citizen says of the player and their
 * vehicle, the last game events, and the actions the app can trigger.
 */
export default function TelemetryPage() {
  const t = useTranslations("Telemetry");
  const telemetry = useTelemetry();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<TelemetryBadge telemetry={telemetry} />}
      />

      {telemetry.connection !== "connected" ? (
        <Card className="p-4 text-[13px] text-nexus-muted">
          {telemetry.connection === "disabled"
            ? t("help.disabled")
            : t("help.waiting", { port: telemetry.port })}{" "}
          <Link
            to="/settings?section=game"
            className="text-nexus-accent hover:underline"
          >
            {t("help.settings")}
          </Link>
        </Card>
      ) : null}

      <Card className="p-4">
        <TelemetryPanel telemetry={telemetry} />
      </Card>

      <TelemetryEvents telemetry={telemetry} />

      <section>
        <SectionTitle>{t("actions.title")}</SectionTitle>
        <p className="mb-3 text-[13px] text-nexus-muted">{t("actions.hint")}</p>
        <GameActions connection={telemetry.connection} />
      </section>
    </div>
  );
}
