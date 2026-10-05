import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Boxes, Gamepad2, Users } from "lucide-react";
import { useTranslations } from "use-intl";
import { listOrganizations } from "@/lib/api/orgs";
import { useAuth } from "@/auth/auth-context";
import { useDebounced } from "@/hooks/use-debounced";
import {
  pageFrom,
  useInitialParams,
  useUrlFilters,
} from "@/hooks/use-url-filters";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  SearchField,
  SectionTitle,
  Toolbar,
} from "@/components/ui";
import type { Organization } from "@/types/nexus";

export default function OrgsPage() {
  const t = useTranslations("Orgs.list");
  const { user } = useAuth();
  const params = useInitialParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [page, setPage] = useState(() => pageFrom(params));

  const query = useDebounced(search);
  useUrlFilters({ q: query, page });

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
      <PageHeader title={t("title")} description={t("description")} />

      {user && userOrganizations.length > 0 ? (
        <section className="mb-8">
          <SectionTitle>{t("mine")}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {userOrganizations.map((org) => (
              <OrgCard
                key={org.id}
                org={org}
                to={`/orgs/${org.id}`}
                eyebrow={
                  org.rank ? `[${org.tag}] · ${org.rank}` : `[${org.tag}]`
                }
              >
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Link
                    to={`/orgs/${org.id}`}
                    className="inline-flex items-center gap-1.5 text-xs text-nexus-muted transition-colors hover:text-nexus-accent"
                  >
                    <Gamepad2 className="h-3.5 w-3.5" />
                    {t("playing")}
                  </Link>
                  <Link
                    to={`/orgs/${org.id}/inventory`}
                    className="inline-flex items-center gap-1.5 text-xs text-nexus-muted transition-colors hover:text-nexus-accent"
                  >
                    <Boxes className="h-3.5 w-3.5" />
                    {t("inventory")}
                  </Link>
                  {org.editor ? (
                    <span className="rounded-full bg-emerald-300/14 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                      {t("editor")}
                    </span>
                  ) : null}
                </div>
              </OrgCard>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionTitle>{t("public")}</SectionTitle>

        <Toolbar>
          <SearchField
            label={t("searchLabel")}
            value={search}
            placeholder={t("searchPlaceholder")}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </Toolbar>

        {organizations.length === 0 ? (
          <EmptyState title={t("noPublic")} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
              {organizations.map((org) => (
                <OrgCard key={org.id} org={org} eyebrow={`[${org.tag}]`}>
                  {org.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-nexus-muted">
                      {org.description}
                    </p>
                  ) : null}
                </OrgCard>
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

/**
 * One organization: its logo on top, or a neutral icon when it has none — or
 * when the logo cannot be fetched.
 */
function OrgCard({
  org,
  eyebrow,
  to,
  children,
}: {
  org: Organization;
  eyebrow: string;
  /** Where the name leads: the organization's page, for the reader's own. */
  to?: string;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex h-26 items-center justify-center bg-[#08243a]">
        {org.image && !failed ? (
          <img
            src={org.image}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-contain p-3"
          />
        ) : (
          <Users className="size-7 text-nexus-accent/25" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-3.5">
        <p className="truncate text-[10.5px] font-semibold tracking-wider text-sky-300/80 uppercase">
          {eyebrow}
        </p>
        {to ? (
          <Link
            to={to}
            className="mt-1 truncate text-sm font-semibold text-nexus-white transition-colors hover:text-nexus-accent"
            title={org.name}
          >
            {org.name}
          </Link>
        ) : (
          <p
            className="mt-1 truncate text-sm font-semibold text-nexus-white"
            title={org.name}
          >
            {org.name}
          </p>
        )}
        {children}
      </div>
    </Card>
  );
}
