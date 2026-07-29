import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { listBlueprintOrgOwners } from "@/lib/api/blueprints";
import { listOrganizations } from "@/lib/api/orgs";
import { useAuth } from "@/auth/auth-context";
import { Card, ErrorState, Select, Spinner } from "@/components/ui";

/**
 * Who, among the members of one of your organizations, already owns this
 * blueprint — so you know who to ask rather than farming it again.
 *
 * Only ever asked for organizations the user belongs to: the route answers 403
 * for any other, and the list it is picked from is the user's own.
 */
export function BlueprintOrgOwners({ blueprintId }: { blueprintId: string }) {
  const { user } = useAuth();
  const [orgId, setOrgId] = useState<string | null>(null);

  const orgsQuery = useQuery({
    queryKey: ["orgs", "mine"],
    queryFn: () => listOrganizations(),
    enabled: Boolean(user),
  });

  const organizations = orgsQuery.data?.userOrganizations ?? [];
  // Until one is picked, the first is the one shown — a selector that starts
  // empty would hide the answer behind a click.
  const selectedOrgId = orgId ?? organizations[0]?.id ?? "";

  const ownersQuery = useQuery({
    queryKey: ["blueprint-org-owners", blueprintId, selectedOrgId],
    queryFn: () => listBlueprintOrgOwners(blueprintId, selectedOrgId),
    enabled: Boolean(selectedOrgId),
  });

  if (!user) {
    return (
      <Section>
        <p className="text-xs text-nexus-accent/60">
          Connectez-vous pour voir qui, dans vos organisations, possède ce
          blueprint.
        </p>
      </Section>
    );
  }

  if (orgsQuery.isPending) {
    return (
      <Section>
        <Spinner />
      </Section>
    );
  }

  // Before the empty case, and not folded into it: a list that could not be
  // read is not an empty list, and saying «vous n'appartenez à aucune
  // organisation» to someone who has several is worse than saying nothing.
  if (orgsQuery.isError) {
    return (
      <Section>
        <ErrorState
          error={orgsQuery.error}
          onRetry={() => void orgsQuery.refetch()}
        />
      </Section>
    );
  }

  if (organizations.length === 0) {
    return (
      <Section>
        <p className="text-xs text-nexus-accent/60">
          Vous n'appartenez à aucune organisation.
        </p>
      </Section>
    );
  }

  return (
    <Section>
      {organizations.length > 1 ? (
        <Select
          className="mb-3"
          value={selectedOrgId}
          onChange={(event) => setOrgId(event.target.value)}
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </Select>
      ) : null}

      {ownersQuery.isPending ? (
        <Spinner />
      ) : ownersQuery.isError ? (
        <ErrorState
          error={ownersQuery.error}
          onRetry={() => void ownersQuery.refetch()}
        />
      ) : ownersQuery.data.length === 0 ? (
        <p className="text-xs text-nexus-accent/60">
          Personne ne le possède dans cette organisation.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {ownersQuery.data.map((member) => (
            <li
              key={member.userId}
              className="flex items-center gap-2 text-xs text-nexus-bright/85"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-400/70" />
              <span className="truncate">{member.name}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-nexus-bright">
        <Users className="h-3.5 w-3.5 text-nexus-accent/60" />
        Dans mon organisation
      </h2>
      {children}
    </Card>
  );
}
