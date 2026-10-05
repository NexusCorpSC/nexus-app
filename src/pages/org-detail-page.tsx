import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BackLink } from "@/components/layout/back-link";
import { useQuery } from "@tanstack/react-query";
import { Boxes, CalendarPlus, ExternalLink, Globe, Lock } from "lucide-react";
import { EventPill } from "@/components/org-event-pill";
import { PresenceForm } from "@/components/presence-form";
import { RoleIcon } from "@/components/squad/role-icon";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionTitle,
  Spinner,
} from "@/components/ui";
import { useMyPresence } from "@/hooks/use-presence";
import { listOrgEvents } from "@/lib/api/org-events";
import { listOrganizations } from "@/lib/api/orgs";
import { getOrgPresence } from "@/lib/api/presence";
import {
  formatTimeRange,
  isRegistered,
  missingRoles,
  openOnSite,
  registrationsLabel,
  roleById,
} from "@/lib/org-events";
import { formatPlannedTime, plannedLabel, plannedOf } from "@/lib/presence";
import { cn, formatElapsed } from "@/lib/utils";
import type {
  MemberPlanned,
  MemberPresence,
  OrgEventView,
} from "@/types/nexus";

/** Often enough to see a teammate arrive, rare enough to cost nothing. */
const PRESENCE_REFRESH_MS = 30_000;

const SHORT_DAY = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/**
 * Planned sessions at the same time for the same thing read as one line:
 * «21:00 · Kaelen, Isha, Tarn — Minage sur Nyx».
 */
function groupPlanned(planned: MemberPlanned[]) {
  const groups = new Map<string, { at: string; members: MemberPlanned[] }>();
  for (const member of planned) {
    const { at, event, activity } = member.planned;
    const key = `${at}|${event?.eventId ?? activity ?? ""}`;
    const group = groups.get(key);
    if (group) group.members.push(member);
    else groups.set(key, { at, members: [member] });
  }
  return [...groups.values()];
}

/**
 * One of the reader's organizations: who is playing right now, and what they
 * are doing — as each declared it, here or on the site — who plans to, and
 * the events coming up.
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

  const events = useQuery({
    queryKey: ["events", "org", orgId],
    queryFn: () => listOrgEvents(orgId),
    refetchInterval: 5 * 60_000,
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
  // An older site answers without the planned sessions: none, then.
  const planned = groupPlanned(presence.data.planned ?? []);
  const myPlanned = mine?.playing ? null : plannedOf(mine);

  return (
    <>
      <BackLink to="/orgs">Retour aux organisations</BackLink>

      <PageHeader
        title={org ? `${org.name} [${org.tag}]` : "Organisation"}
        description={
          org?.rank ? `Votre rang : ${org.rank}` : "Vos coéquipiers en jeu."
        }
        actions={
          <>
            {/* Planning an event stays on the site, form and all. */}
            <Button
              variant="outline"
              onClick={() => void openOnSite(`/orgs/${orgId}/events/new`)}
              title="Ouvre le formulaire dans le navigateur"
            >
              <CalendarPlus className="size-4" />
              Prévoir sur le site
            </Button>
            <Link
              to={`/orgs/${orgId}/inventory`}
              className="inline-flex h-9.5 items-center gap-2 rounded-lg border border-nexus-accent/25 px-4 text-[13px] font-medium text-nexus-bright transition-colors hover:border-nexus-accent/45"
            >
              <Boxes className="size-4" />
              Inventaire partagé
            </Link>
          </>
        }
      />

      <Card className="mb-7 flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-display text-base font-semibold text-nexus-white">
            Ma session
          </p>
          <span
            className={cn(
              "flex items-center gap-2 text-xs",
              mine?.playing
                ? "font-medium text-emerald-300"
                : myPlanned
                  ? "font-medium text-amber-200"
                  : "text-nexus-dim",
            )}
          >
            <span
              className={cn(
                "rounded-full",
                mine?.playing
                  ? "size-2 bg-emerald-300"
                  : myPlanned
                    ? "size-2.5 border-2 border-amber-300"
                    : "size-2 bg-nexus-dim/50",
              )}
            />
            {mine?.playing
              ? "Vous êtes en jeu"
              : myPlanned
                ? plannedLabel(myPlanned, now)
                : "Vous n'êtes pas en jeu"}
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

        {planned.length > 0 ? (
          <div className="mt-6">
            <SectionTitle aside={presence.data.planned?.length}>
              Sessions prévues
            </SectionTitle>
            <ul className="flex flex-col gap-2">
              {planned.map(({ at, members }) => (
                <PlannedRow
                  key={`${at}-${members[0].userId}`}
                  at={at}
                  members={members}
                  now={now}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <SectionTitle
          aside={
            events.data
              ? `${upcomingOf(events.data, now).length} à venir`
              : undefined
          }
        >
          Évènements
        </SectionTitle>

        {events.isPending ? (
          <div className="flex items-center gap-2 py-4 text-[13px] text-nexus-muted">
            <Spinner />
            Chargement…
          </div>
        ) : events.isError ? (
          <p className="text-[13px] text-nexus-muted">
            Les évènements n'ont pas pu être chargés.{" "}
            <button
              type="button"
              onClick={() => void events.refetch()}
              className="text-nexus-accent hover:text-nexus-bright"
            >
              Réessayer
            </button>
          </p>
        ) : upcomingOf(events.data, now).length === 0 ? (
          <p className="text-[13px] text-nexus-muted">
            Aucun évènement prévu pour le moment.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcomingOf(events.data, now).map((event) => (
              <EventRow key={event.id} event={event} now={now} />
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => void openOnSite(`/orgs/${orgId}/events`)}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-nexus-muted transition-colors hover:text-nexus-accent"
        >
          <ExternalLink className="size-3.5" />
          Le calendrier complet sur le site
        </button>
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
        {formatElapsed(member.since, now)}
      </span>
    </li>
  );
}

/** The list answers from a day ago: what has ended is left out. */
function upcomingOf(events: OrgEventView[], now: number) {
  return events.filter((event) => Date.parse(event.endsAt) > now);
}

function PlannedRow({
  at,
  members,
  now,
}: {
  at: string;
  members: MemberPlanned[];
  now: number;
}) {
  const { planned } = members[0];

  return (
    <li className="flex items-center gap-3 rounded-xl border border-amber-300/15 bg-nexus-card px-3.5 py-2.5">
      <span className="shrink-0 rounded-md bg-amber-300/12 px-2 py-0.5 font-mono text-[13px] text-amber-200">
        {formatPlannedTime(at, now)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-nexus-white">
          {members.map((member) => member.name).join(", ")}
        </p>
        {planned.event ? (
          <Link
            to={`/orgs/${planned.event.orgId}/events/${planned.event.eventId}`}
            className="block truncate text-xs text-nexus-accent transition-colors hover:text-nexus-bright"
          >
            {planned.activity ?? planned.event.title} · évènement
          </Link>
        ) : (
          <p className="truncate text-xs text-nexus-muted">
            {planned.activity ?? "Session prévue"}
          </p>
        )}
      </div>
    </li>
  );
}

function EventRow({ event, now }: { event: OrgEventView; now: number }) {
  const registered = isRegistered(event);
  const myRole = registered
    ? roleById(event.roles, event.myRegistration?.role ?? "")
    : null;
  const live = Date.parse(event.startsAt) <= now;
  const VisibilityIcon = event.visibility === "public" ? Globe : Lock;

  return (
    <li>
      <Link
        to={`/orgs/${event.orgId}/events/${event.id}`}
        className="flex items-center gap-4 rounded-xl border border-nexus-accent/12 bg-nexus-card px-4 py-3 transition-colors hover:border-nexus-accent/35"
      >
        <div className="flex w-28 shrink-0 flex-col">
          <span className="text-[11px] font-semibold tracking-wider text-nexus-muted uppercase">
            {SHORT_DAY.format(new Date(event.startsAt))}
          </span>
          <span className="font-mono text-[13px] text-nexus-accent">
            {formatTimeRange(event)}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="truncate text-sm font-semibold text-nexus-white">
            {event.title}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <EventPill>
              <VisibilityIcon className="size-3" />
              {event.visibility === "public" ? "Public" : "Privé"}
            </EventPill>
            {live ? <EventPill tone="live">En cours</EventPill> : null}
            {registered ? (
              <EventPill tone="registered">
                {myRole ? (
                  <RoleIcon icon={myRole.icon} className="size-3" />
                ) : null}
                {myRole ? `Inscrit · ${myRole.label}` : "Inscrit"}
              </EventPill>
            ) : null}
            {missingRoles(event).map(({ role, missing }) => (
              <EventPill key={role.id} tone="missing">
                <RoleIcon icon={role.icon} className="size-3" />
                Il manque {missing} {role.label}
              </EventPill>
            ))}
          </div>
        </div>

        <span className="shrink-0 text-xs text-nexus-muted">
          {registrationsLabel(event.registrationCount)}
        </span>
      </Link>
    </li>
  );
}
