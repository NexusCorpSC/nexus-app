import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { listOrgInventory } from "@/lib/api/orgs";
import { useDebounced } from "@/hooks/use-debounced";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
} from "@/components/ui";
import { formatDate } from "@/lib/utils";

export default function OrgInventoryPage() {
  const { orgId = "" } = useParams();

  const [search, setSearch] = useState("");
  const [memberId, setMemberId] = useState("");
  const [page, setPage] = useState(1);

  const query = useDebounced(search);

  const inventoryQuery = useQuery({
    queryKey: ["org-inventory", orgId, query, memberId, page],
    queryFn: () =>
      listOrgInventory(orgId, {
        query: query || undefined,
        userId: memberId || undefined,
        page,
      }),
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <Link
        to="/orgs"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-nexus-accent/60 transition-colors hover:text-nexus-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Retour aux organisations
      </Link>

      <PageHeader
        title="Inventaire partagé"
        description="Ressources rendues visibles par les membres de l'organisation."
      />

      <Card className="mb-6 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Recherche">
            <Input
              value={search}
              placeholder="Nom de la ressource…"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Membre">
            <Select
              value={memberId}
              onChange={(event) => {
                setMemberId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous</option>
              {inventoryQuery.data?.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {inventoryQuery.isPending ? (
        <LoadingState />
      ) : inventoryQuery.isError ? (
        <ErrorState
          error={inventoryQuery.error}
          onRetry={() => void inventoryQuery.refetch()}
        />
      ) : inventoryQuery.data.items.length === 0 ? (
        <EmptyState
          title="Aucune ressource partagée"
          description="Les membres doivent cocher « Org » sur leurs ressources pour qu'elles apparaissent ici."
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-nexus-accent/50">
            {inventoryQuery.data.total} ressource
            {inventoryQuery.data.total > 1 ? "s" : ""}
          </p>

          <div className="space-y-2">
            {inventoryQuery.data.items.map((item) => (
              <Card key={item.id} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-nexus-bright">
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-xs text-nexus-accent/50">
                    {item.ownerName} · {item.location?.name ?? "Lieu inconnu"}
                    {item.quality != null ? ` · qualité ${item.quality}` : ""}
                    {` · maj ${formatDate(item.updatedAt)}`}
                  </p>
                </div>
                <p className="shrink-0 text-sm text-nexus-bright">
                  {item.quantity.toLocaleString("fr-FR")}
                  {item.unit ? ` ${item.unit}` : ""}
                </p>
              </Card>
            ))}
          </div>

          {/* This endpoint reports `hasMore` rather than a page count. */}
          <div className="flex items-center justify-center gap-3 py-6">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Précédent
            </Button>
            <span className="text-xs text-nexus-accent/60">Page {page}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!inventoryQuery.data.hasMore}
              onClick={() => setPage((current) => current + 1)}
            >
              Suivant
            </Button>
          </div>
        </>
      )}
    </>
  );
}
