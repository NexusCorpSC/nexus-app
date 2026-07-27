import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import { listOrganizations } from "@/lib/api/orgs";
import { useAuth } from "@/auth/auth-context";
import { useDebounced } from "@/hooks/use-debounced";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
} from "@/components/ui";

export default function OrgsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query = useDebounced(search);

  const orgsQuery = useQuery({
    queryKey: ["orgs", query, page],
    queryFn: () => listOrganizations({ query: query || undefined, page }),
    placeholderData: keepPreviousData,
  });

  if (orgsQuery.isPending) return <LoadingState />;

  if (orgsQuery.isError) {
    return (
      <ErrorState
        error={orgsQuery.error}
        onRetry={() => void orgsQuery.refetch()}
      />
    );
  }

  const { organizations, userOrganizations, totalPages } = orgsQuery.data;

  return (
    <>
      <PageHeader
        title="Organisations"
        description="Vos organisations et les organisations publiques de la communauté."
      />

      {user && userOrganizations.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-nexus-accent/50">
            Mes organisations
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {userOrganizations.map((org) => (
              <Card key={org.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-nexus-bright">
                      {org.name}
                    </p>
                    <p className="mt-0.5 text-xs text-nexus-accent/50">
                      [{org.tag}]
                      {org.rank ? ` · ${org.rank}` : ""}
                    </p>
                  </div>
                  {org.editor ? <Badge tone="success">Éditeur</Badge> : null}
                </div>

                <Link
                  to={`/orgs/${org.id}/inventory`}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-nexus-accent/70 transition-colors hover:text-nexus-accent"
                >
                  <Boxes className="h-3.5 w-3.5" />
                  Inventaire partagé
                </Link>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-nexus-accent/50">
          Organisations publiques
        </h2>

        <Card className="mb-4 p-4">
          <Field label="Recherche">
            <Input
              value={search}
              placeholder="Nom ou tag…"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </Field>
        </Card>

        {organizations.length === 0 ? (
          <EmptyState title="Aucune organisation publique trouvée" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {organizations.map((org) => (
                <Card key={org.id} className="p-4">
                  <p className="font-medium text-nexus-bright">{org.name}</p>
                  <p className="mt-0.5 text-xs text-nexus-accent/50">
                    [{org.tag}]
                  </p>
                  {org.description ? (
                    <p className="mt-2 line-clamp-2 text-xs text-nexus-accent/65">
                      {org.description}
                    </p>
                  ) : null}
                </Card>
              ))}
            </div>

            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </section>
    </>
  );
}
