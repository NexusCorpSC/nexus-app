import { useAuth } from "@/auth/auth-context";
import { Card } from "@/components/ui";
import {
  SettingsCardTitle,
  SettingsSectionHeader,
} from "@/components/settings/section-header";

/** Who the app is signed in as on the current instance. */
export function AccountSection() {
  const { user } = useAuth();

  return (
    <section>
      <SettingsSectionHeader
        title="Compte"
        description="La session ouverte sur l'instance configurée dans Général."
      />

      <Card>
        <SettingsCardTitle>Session</SettingsCardTitle>
        <dl className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
          <dt className="text-nexus-muted">Connecté en tant que</dt>
          <dd className="text-nexus-white">
            {user ? user.email : "Non connecté"}
          </dd>
        </dl>
      </Card>
    </section>
  );
}
