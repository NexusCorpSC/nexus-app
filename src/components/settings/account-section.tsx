import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/auth-context";
import { getMyDisplayOrg, setMyDisplayOrg } from "@/lib/api/display-org";
import { Card, Field, Select } from "@/components/ui";
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
  const { user } = useAuth();

  return (
    <section>
      <SettingsSectionHeader
        title="Compte"
        description="La session ouverte sur l'instance configurée dans Général."
      />

      <div className="space-y-4">
        <Card>
          <SettingsCardTitle>Session</SettingsCardTitle>
          <dl className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
            <dt className="text-nexus-muted">Connecté en tant que</dt>
            <dd className="text-nexus-white">
              {user ? user.email : "Non connecté"}
            </dd>
          </dl>
        </Card>

        {user ? <DisplayOrgCard /> : null}
      </div>
    </section>
  );
}

/** The organization shown with the reader's name, saved as soon as picked. */
function DisplayOrgCard() {
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
      <SettingsCardTitle>Profil</SettingsCardTitle>
      <div className="space-y-3 p-4">
        {current.isError ? (
          <SettingsError>
            Impossible de lire vos organisations sur cette instance.
          </SettingsError>
        ) : current.data && organizations.length === 0 ? (
          <p className="text-[13px] text-nexus-muted">
            Rejoignez une organisation pour l'afficher avec votre pseudo.
          </p>
        ) : (
          <Field label="Organisation affichée avec mon pseudo">
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
              <option value={AUTO}>Automatique : la première en commun</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.tag ? `${org.name} [${org.tag}]` : org.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {save.isError ? (
          <SettingsError>L'enregistrement a échoué. Réessayez.</SettingsError>
        ) : null}
        <p className="text-xs leading-relaxed text-nexus-dim">
          Vos amis la voient à côté de votre pseudo. En automatique, ou si vous
          quittez l'organisation choisie, chacun voit la première organisation
          que vous avez en commun.
        </p>
      </div>
    </Card>
  );
}
