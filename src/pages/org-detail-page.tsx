import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Boxes } from "lucide-react";
import { PresenceForm } from "@/components/presence-form";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import { useMyPresence } from "@/hooks/use-presence";
import { listOrganizations } from "@/lib/api/orgs";
import { getOrgPresence } from "@/lib/api/presence";
import type { MemberPresence } from "@/types/nexus";

/** Often enough to see a teammate arrive, rare enough to cost nothing. */
const PRESENCE_REFRESH_MS = 30_000;

/** «1 h 20», from an ISO date. */
function elapsed(since: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

/**
 * One of the reader's organizations: who is playing right now, and what they
 * are doing — as each declared it, here or on the site.
 */
export default function OrgDetailPage() {
  const { orgId = "" } = useParams();
  const { presence: mine } = useMyPresence(true);

  // The organizations list is where the name, tag and rank come from; it is
  // usually cached already, the reader having come from it.
  const orgs = useQuery({
    queryKey: ["orgs", "", 1],
    queryFn: () => listOrganizations({ page: 1 }),
  });
  const org = orgs.data?.userOrganizations.find((one) => one.id === orgId);

  const presence = useQuery({
    queryKey: ["presence", "org", orgId],
    queryFn: () => getOrgPresence(orgId),
    refetchInterval: PRESENCE_REFRESH_MS,
    enabled: Boolean(orgId),
  });

  // Durations move on between refreshes too.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (presence.isPending) return <LoadingState />;

  if (presence.isError) {
    return (
      <ErrorState
        error={presence.error}
        onRetry={() => void presence.refetch()}
      />
    );
  }

  const { playing, memberCount } = presence.data;

  return (
    <>
      <Link
        to="/orgs"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-nexus-muted transition-colors hover:text-nexus-accent"
      >
        <ArrowLeft className="size-3.5" />
        Organisations
      </Link>

      <PageHeader
        title={org ? `${org.name} [${org.tag}]` : "Organisation"}
        description={
          org?.rank ? `Votre rang : ${org.rank}` : "Vos coéquipiers en jeu."
        }
        actions={
          <Link
            to={`/orgs/${orgId}/inventory`}
            className="inline-flex h-9.5 items-center gap-2 rounded-lg border border-nexus-accent/25 px-4 text-[13px] font-medium text-nexus-bright transition-colors hover:border-nexus-accent/45"
          >
            <Boxes className="size-4" />
            Inventaire partagé
          </Link>
        }
      />

      <Card className="mb-7 flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-display text-base font-semibold text-nexus-white">
            Ma session
          </p>
          <span
            className={
              mine?.playing
                ? "flex items-center gap-2 text-xs font-medium text-emerald-300"
                : "flex items-center gap-2 text-xs text-nexus-dim"
            }
          >
            <span
              className={
                mine?.playing
                  ? "size-2 rounded-full bg-emerald-300"
                  : "size-2 rounded-full bg-nexus-dim/50"
              }
            />
            {mine?.playing ? "Vous êtes en jeu" : "Vous n'êtes pas en jeu"}
          </span>
        </div>
        <PresenceForm />
      </Card>

      <section>
        <SectionTitle aside={`${playing.length} sur ${memberCount}`}>
          En jeu maintenant
        </SectionTitle>

        {playing.length === 0 ? (
          <EmptyState
            title="Personne n'est en jeu pour le moment"
            description="Chacun le déclare depuis Nexus App ou le site, avec ce qu'il fait s'il le souhaite."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {playing.map((member) => (
              <MemberCard key={member.userId} member={member} now={now} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function MemberCard({ member, now }: { member: MemberPresence; now: number }) {
  const [failed, setFailed] = useState(false);

  return (
    <li className="flex items-center gap-3 rounded-xl border border-nexus-accent/12 bg-nexus-card p-3.5">
      <div className="relative shrink-0">
        {member.avatar && !failed ? (
          <img
            src={member.avatar}
            alt=""
            onError={() => setFailed(true)}
            className="size-10 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-10 items-center justify-center rounded-full bg-nexus-panel text-sm font-semibold text-nexus-accent">
            {member.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-nexus-card bg-emerald-300" />
      </div>

      <div className="min-w-0 flex-1">
        {member.rank ? (
          <p className="truncate text-[10.5px] font-semibold tracking-wider text-sky-300/80 uppercase">
            {member.rank}
          </p>
        ) : null}
        <p className="truncate text-sm font-semibold text-nexus-white">
          {member.name}
        </p>
        <p className="truncate text-xs text-nexus-muted">
          {member.activity ?? "En jeu"}
        </p>
      </div>

      <span className="shrink-0 text-xs text-nexus-dim" title="En jeu depuis">
        {elapsed(member.since, now)}
      </span>
    </li>
  );
}
