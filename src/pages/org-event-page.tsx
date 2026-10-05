import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { BackLink } from "@/components/layout/back-link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  ClipboardList,
  Globe,
  Lock,
  MapPin,
  Pencil,
  User,
  Users,
} from "lucide-react";
import { useTranslations } from "use-intl";
import { EventPill } from "@/components/org-event-pill";
import { RoleIcon } from "@/components/squad/role-icon";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui";
import { MY_EVENTS_KEY, useMyPresence } from "@/hooks/use-presence";
import { getLocale } from "@/i18n/locale";
import { translator } from "@/i18n/translate";
import { ApiError } from "@/lib/api-client";
import {
  createOrgEventSquad,
  getOrgEvent,
  registerToOrgEvent,
  withdrawFromOrgEvent,
} from "@/lib/api/org-events";
import { listOrganizations } from "@/lib/api/orgs";
import {
  formatSpan,
  formatTimeRange,
  missingFor,
  openOnSite,
  registrationsLabel,
  roleById,
  timeZoneCity,
} from "@/lib/org-events";
import { daysBetween, plannedOf } from "@/lib/presence";
import { cn } from "@/lib/utils";
import { showOverlay } from "@/lib/windows";
import {
  ORG_EVENT_ANSWER_MAX_LENGTH,
  type OrgEventParticipant,
  type OrgEventRole,
  type OrgEventSquadResult,
  type OrgEventView,
} from "@/types/nexus";

function dateFormat(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(getLocale(), options);
}

/** Where the event stands: to come (and in how long), under way, over. */
function countdown(event: OrgEventView, now: number) {
  const t = translator("OrgEvents.status");
  const start = Date.parse(event.startsAt);
  if (Date.parse(event.endsAt) <= now) {
    return { state: "over" as const, label: t("over") };
  }
  if (start <= now) return { state: "live" as const, label: t("live") };

  const days = daysBetween(new Date(now), new Date(start));
  return {
    state: "soon" as const,
    label:
      start - now < 24 * 3_600_000
        ? t("startsIn", { duration: formatSpan(start - now) })
        : t("inDays", { count: days }),
  };
}

/** The squad refusals the API words in English, said the app's way. */
function squadErrorMessage(error: unknown): string {
  const t = translator("OrgEvents.squad");
  if (error instanceof ApiError && error.status === 409) {
    return /nobody/i.test(error.message) ? t("nobody") : t("exists");
  }
  return error instanceof Error
    ? t("error", { message: error.message })
    : t("errorUnknown");
}

/**
 * One event of an organization: when, where, who organizes it, who comes in
 * which role, and the reader's registration beside it.
 *
 * Reading and registering happen here; planning, editing and the organizer's
 * summary stay on the site, a click away in the browser. The squad, though,
 * is built from here: it lands in the squad overlay.
 */
export default function OrgEventPage() {
  const t = useTranslations("OrgEvents");
  const { orgId = "", eventId = "" } = useParams();

  // As on the organization page: the name comes from the cached list.
  const orgs = useQuery({
    queryKey: ["orgs", "", 1],
    queryFn: () => listOrganizations({ page: 1 }),
  });
  const org = orgs.data?.userOrganizations.find((one) => one.id === orgId);

  const event = useQuery({
    queryKey: ["events", "detail", orgId, eventId],
    queryFn: () => getOrgEvent(orgId, eventId),
    enabled: Boolean(orgId && eventId),
    // Others register too: read again now and then.
    refetchInterval: 60_000,
  });

  // «Commence dans…» and the closing of registrations move on by the minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const back = (
    <BackLink to={`/orgs/${orgId}`}>{org?.name ?? t("orgFallback")}</BackLink>
  );

  if (event.isPending) return <LoadingState />;

  if (event.isError) {
    return (
      <>
        {back}
        {event.error instanceof ApiError && event.error.status === 404 ? (
          <EmptyState
            title={t("notFound.title")}
            description={t("notFound.description")}
          />
        ) : (
          <ErrorState
            error={event.error}
            onRetry={() => void event.refetch()}
          />
        )}
      </>
    );
  }

  const view = event.data;
  const status = countdown(view, now);
  const ended = status.state === "over";
  const sitePath = `/orgs/${view.orgId}/events/${view.id}`;
  const VisibilityIcon = view.visibility === "public" ? Globe : Lock;

  return (
    <>
      {back}

      <header className="mb-6 flex items-start gap-5">
        <DateBlock startsAt={view.startsAt} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <EventPill>
              <VisibilityIcon className="size-3" />
              {view.visibility === "public"
                ? t("pill.public")
                : org
                  ? t("pill.privateTo", { org: org.name })
                  : t("pill.private")}
            </EventPill>
            <EventPill
              tone={
                status.state === "live"
                  ? "live"
                  : status.state === "soon"
                    ? "missing"
                    : "default"
              }
            >
              {status.label}
            </EventPill>
          </div>
          <h1 className="font-display text-[28px] leading-tight font-bold text-nexus-white">
            {view.title}
          </h1>
        </div>
        {view.canManage ? (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={() => void openOnSite(`${sitePath}/summary`)}
              title={t("header.summaryTitle")}
            >
              <ClipboardList className="size-4" />
              {t("header.summary")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void openOnSite(`${sitePath}/edit`)}
              title={t("header.editTitle")}
            >
              <Pencil className="size-4" />
              {t("header.edit")}
            </Button>
          </div>
        ) : null}
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-7">
          <Facts event={view} />

          {view.description ? (
            <section>
              <h2 className="mb-2 font-display text-base font-semibold text-nexus-white">
                {t("thePlan")}
              </h2>
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-nexus-soft">
                {view.description}
              </p>
            </section>
          ) : null}

          <WhoComes event={view} />
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <RegistrationPanel event={view} ended={ended} />
          {view.canManage &&
          (view.registrationCount > 0 || view.squadId !== null) ? (
            <SquadCard event={view} />
          ) : null}
        </aside>
      </div>
    </>
  );
}

function DateBlock({ startsAt }: { startsAt: string }) {
  const date = new Date(startsAt);

  return (
    <div
      aria-hidden="true"
      className="flex w-16 shrink-0 flex-col items-center rounded-xl border border-nexus-accent/30 bg-nexus-panel py-1.5"
    >
      <span className="text-[11px] font-semibold text-nexus-accent uppercase">
        {dateFormat({ month: "short" }).format(date)}
      </span>
      <span className="font-display text-2xl leading-tight font-bold text-nexus-white">
        {date.getDate()}
      </span>
      <span className="text-[11px] text-nexus-muted uppercase">
        {dateFormat({ weekday: "short" }).format(date)}
      </span>
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="flex gap-3 p-4">
      <span className="mt-0.5 text-nexus-accent">{icon}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
          {label}
        </span>
        <span className="text-[15px] font-semibold text-nexus-white">
          {value}
        </span>
        {children ? (
          <span className="text-xs text-nexus-muted">{children}</span>
        ) : null}
      </div>
    </Card>
  );
}

function Facts({ event }: { event: OrgEventView }) {
  const t = useTranslations("OrgEvents.facts");
  const where = event.meetingPoint || event.meetingPlace?.name || null;
  const day = dateFormat({
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(event.startsAt));

  return (
    <section
      aria-label={t("label")}
      className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3"
    >
      <Fact
        icon={<CalendarClock className="size-4.5" />}
        label={t("when")}
        value={formatTimeRange(event)}
      >
        {t("whenDetail", {
          day: day.charAt(0).toUpperCase() + day.slice(1),
          duration: formatSpan(
            Date.parse(event.endsAt) - Date.parse(event.startsAt),
          ),
          city: timeZoneCity(),
        })}
      </Fact>
      <Fact
        icon={<MapPin className="size-4.5" />}
        label={t("where")}
        value={where ?? t("whereUnknown")}
      >
        {event.meetingPlace ? (
          <Link
            to={`/places/${event.meetingPlace.slug}`}
            className="text-nexus-accent transition-colors hover:text-nexus-bright"
          >
            {event.meetingPoint
              ? t("seePlaceNamed", { place: event.meetingPlace.name })
              : t("seePlace")}
          </Link>
        ) : null}
      </Fact>
      <Fact
        icon={<User className="size-4.5" />}
        label={t("organizer")}
        value={event.createdBy.name}
      />
    </section>
  );
}

function Person({
  participant,
  me,
}: {
  participant: OrgEventParticipant;
  me: boolean;
}) {
  const t = useTranslations("OrgEvents.whoComes");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[13px]",
        me
          ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-100"
          : "border-nexus-accent/15 bg-nexus-abyss/60 text-nexus-soft",
      )}
    >
      <span className="flex size-5.5 items-center justify-center rounded-full bg-nexus-panel text-[10px] font-semibold text-nexus-accent">
        {participant.name.slice(0, 1).toUpperCase()}
      </span>
      {me ? t("you", { name: participant.name }) : participant.name}
    </span>
  );
}

/** Who comes, by role, with each role's count against what is wanted. */
function WhoComes({ event }: { event: OrgEventView }) {
  const t = useTranslations("OrgEvents.whoComes");
  const me = event.myRegistration?.userId ?? null;

  const groups: { role: OrgEventRole | null; people: OrgEventParticipant[] }[] =
    event.roles.length === 0
      ? [{ role: null, people: event.participants }]
      : [
          ...event.roles.map((role) => ({
            role,
            people: event.participants.filter(
              (participant) => participant.role === role.id,
            ),
          })),
          {
            role: null,
            people: event.participants.filter(
              (participant) => !roleById(event.roles, participant.role),
            ),
          },
        ].filter((group) => group.role !== null || group.people.length > 0);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-nexus-white">
          {t("title")}
        </h2>
        <span className="text-xs text-nexus-muted">
          {registrationsLabel(event.registrationCount)}
        </span>
      </div>

      {!event.canRegister && event.registrationCount > 0 ? (
        <p className="mb-3 text-[13px] text-nexus-muted">
          {t("listMembersOnly")}
        </p>
      ) : null}

      {event.roles.length === 0 ? (
        event.canRegister ? (
          event.participants.length === 0 ? (
            <p className="text-[13px] text-nexus-muted">
              {t("noParticipants")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {event.participants.map((participant) => (
                <Person
                  key={participant.userId}
                  participant={participant}
                  me={participant.userId === me}
                />
              ))}
            </div>
          )
        ) : null
      ) : (
        <Card className="divide-y divide-nexus-accent/10">
          {groups.map(({ role, people }) => {
            const count = role
              ? (event.roleCounts[role.id] ?? 0)
              : (event.roleCounts[""] ?? people.length);
            const missing = role ? missingFor(role, event.roleCounts) : 0;
            return (
              <div key={role?.id ?? ""} className="flex flex-col gap-2.5 p-4">
                <div className="flex items-center gap-2">
                  <RoleIcon
                    icon={role?.icon}
                    className="size-4 text-nexus-accent"
                  />
                  <span className="text-sm font-semibold text-nexus-white">
                    {role?.label ?? t("noRole")}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      missing > 0 ? "text-amber-200" : "text-nexus-muted",
                    )}
                  >
                    {role && role.wanted !== null
                      ? t("countOfWanted", { count, wanted: role.wanted })
                      : count}
                  </span>
                </div>
                {people.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {people.map((participant) => (
                      <Person
                        key={participant.userId}
                        participant={participant}
                        me={participant.userId === me}
                      />
                    ))}
                  </div>
                ) : event.canRegister && count === 0 ? (
                  <p className="text-xs text-nexus-dim">{t("nobodyInRole")}</p>
                ) : null}
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

/** Settles an answer of the registration routes: the event, and the lists. */
function useEventSettle(event: OrgEventView) {
  const queryClient = useQueryClient();

  return (view: OrgEventView) => {
    queryClient.setQueryData(["events", "detail", event.orgId, event.id], view);
    void queryClient.invalidateQueries({
      queryKey: ["events", "org", event.orgId],
    });
    // The planned form offers the events one registered to.
    void queryClient.invalidateQueries({ queryKey: MY_EVENTS_KEY });
  };
}

/** Registering, reading one's registration, changing it, or withdrawing. */
function RegistrationPanel({
  event,
  ended,
}: {
  event: OrgEventView;
  ended: boolean;
}) {
  const t = useTranslations("OrgEvents.registration");
  const mine = event.myRegistration;
  const active = !!mine && !mine.withdrawn;
  const settle = useEventSettle(event);
  const { presence, plan } = useMyPresence(true);

  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(mine?.role ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>(
    mine?.answers ?? {},
  );

  const register = useMutation({
    mutationFn: () =>
      registerToOrgEvent(event.orgId, event.id, { role, answers }),
    onSuccess: (view) => {
      settle(view);
      setEditing(false);
    },
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawFromOrgEvent(event.orgId, event.id),
    onSuccess: settle,
  });

  const pending = register.isPending || withdraw.isPending || plan.isPending;
  const error = register.error ?? withdraw.error ?? plan.error;
  const errorLine = error ? (
    <p className="text-xs text-red-300">
      {t("error", {
        message: error instanceof Error ? error.message : t("unknownError"),
      })}
    </p>
  ) : null;

  const box = "flex flex-col gap-4 p-4.5";

  if (ended || !event.canRegister) {
    return (
      <Card className={box}>
        <h2 className="font-display text-base font-semibold text-nexus-white">
          {t("title")}
        </h2>
        <p className="text-[13px] text-nexus-muted">
          {ended ? t("ended") : t("membersOnly")}
        </p>
      </Card>
    );
  }

  if (active && !editing) {
    const myRole = roleById(event.roles, mine.role);
    const firstAnswer = event.questions
      .map((question) => mine.answers[question.id])
      .find(Boolean);
    // Already the status's planned session, from here or from elsewhere.
    const shownAsPlanned =
      plan.isSuccess || plannedOf(presence)?.event?.eventId === event.id;

    return (
      <Card className={cn(box, "border-nexus-accent/25")}>
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
            <Check className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-nexus-white">
              {t("registered")}
            </h2>
            <p className="text-[13px] text-nexus-muted">
              {[
                myRole ? t("roleIs", { role: myRole.label }) : null,
                firstAnswer,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        {event.squadId ? (
          <button
            type="button"
            onClick={() => void showOverlay("squad")}
            className="flex items-center gap-2 rounded-lg bg-emerald-400/10 px-3 py-2.5 text-left text-[13px] text-emerald-100 transition-colors hover:bg-emerald-400/18"
          >
            <Users className="size-4 shrink-0" />
            {t("squadReady")}
          </button>
        ) : null}

        {shownAsPlanned ? (
          <p className="rounded-lg bg-nexus-abyss/70 px-3 py-2.5 text-[13px] text-amber-200">
            {t("shownAsPlanned")}
          </p>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              plan.mutate({ event: { orgId: event.orgId, eventId: event.id } })
            }
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-amber-300/45 px-3 py-2.5 text-left text-[13px] text-amber-200 transition-colors hover:border-amber-300 disabled:opacity-50"
          >
            <CalendarClock className="size-4 shrink-0" />
            {t("showAsPlanned")}
          </button>
        )}

        {errorLine}

        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            {t("editAnswers")}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => withdraw.mutate()}
          >
            {t("withdraw")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn(box, "border-nexus-accent/25")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(submitted) => {
          submitted.preventDefault();
          register.mutate();
        }}
      >
        <div>
          <h2 className="font-display text-base font-semibold text-nexus-white">
            {active ? t("editTitle") : t("register")}
          </h2>
          <p className="mt-0.5 text-xs text-nexus-muted">
            {t("hint", { name: event.createdBy.name })}
          </p>
        </div>

        {event.roles.length > 0 ? (
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-nexus-bright">
              {t("role")}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {event.roles.map((candidate) => {
                const count = event.roleCounts[candidate.id] ?? 0;
                const missing = missingFor(candidate, event.roleCounts);
                const checked = role === candidate.id;
                return (
                  <label
                    key={candidate.id}
                    className={cn(
                      "flex min-h-14 cursor-pointer flex-col items-start gap-1 rounded-lg border px-2.5 py-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-nexus-accent",
                      checked
                        ? "border-nexus-accent bg-nexus-accent/14"
                        : "border-nexus-accent/18 hover:border-nexus-accent/45",
                    )}
                  >
                    <input
                      type="radio"
                      name="role"
                      required
                      className="sr-only"
                      value={candidate.id}
                      checked={checked}
                      onChange={() => setRole(candidate.id)}
                    />
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-nexus-white">
                      <RoleIcon
                        icon={candidate.icon}
                        className="size-3.5 text-nexus-accent"
                      />
                      {candidate.label}
                    </span>
                    <span
                      className={cn(
                        "text-[11px]",
                        missing > 0 ? "text-amber-200" : "text-nexus-muted",
                      )}
                    >
                      {missing > 0 && count === 0
                        ? t("lookingFor", { count: missing })
                        : missing > 0
                          ? t("countMissing", { count, missing })
                          : registrationsLabel(count)}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {event.questions.map((question) => (
          <label key={question.id} className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-nexus-bright">
              {question.label}{" "}
              <span className="font-normal text-nexus-dim">
                · {question.required ? t("required") : t("optional")}
              </span>
            </span>
            <textarea
              rows={2}
              required={question.required}
              maxLength={ORG_EVENT_ANSWER_MAX_LENGTH}
              value={answers[question.id] ?? ""}
              onChange={(changed) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: changed.target.value,
                }))
              }
              className="w-full resize-y rounded-lg border border-nexus-accent/15 bg-nexus-abyss px-3 py-2 text-[13px] text-nexus-white placeholder:text-nexus-dim/80 focus:border-nexus-accent/50 focus:outline-none"
            />
          </label>
        ))}

        {errorLine}

        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={pending}>
            {active ? t("update") : mine ? t("reRegister") : t("register")}
          </Button>
          {active ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRole(mine.role);
                setAnswers(mine.answers);
                setEditing(false);
              }}
            >
              {t("cancel")}
            </Button>
          ) : null}
        </div>

        {mine?.withdrawn ? (
          <p className="text-xs text-nexus-muted">{t("withdrawn")}</p>
        ) : null}
      </form>
    </Card>
  );
}

/**
 * The organizer's way to the squad: every active registrant in it with the
 * role they picked, led by the reader. It shows up in the squad overlay — the
 * event stream tells it — and the code is here for anyone to join by hand.
 */
function SquadCard({ event }: { event: OrgEventView }) {
  const t = useTranslations("OrgEvents.squad");
  const queryClient = useQueryClient();
  const settle = useEventSettle(event);
  const [created, setCreated] = useState<OrgEventSquadResult | null>(null);

  const create = useMutation({
    mutationFn: () => createOrgEventSquad(event.orgId, event.id),
    onSuccess: (result) => {
      setCreated(result);
      settle(result.event);
      // Whatever this window shows of the squad is out of date now.
      void queryClient.invalidateQueries({ queryKey: ["squad"] });
      void queryClient.invalidateQueries({ queryKey: ["home", "squad"] });
    },
  });

  if (created) {
    return (
      <Card className="flex flex-col gap-3 border-emerald-400/30 p-4.5">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-emerald-300" />
          <h2 className="font-display text-base font-semibold text-nexus-white">
            {t("ready")}
          </h2>
        </div>
        <p className="text-[13px] text-nexus-muted">
          {t("createdDetail", {
            count: created.squadCount,
            name: created.squad.name,
          })}{" "}
          <span className="font-mono font-semibold tracking-[0.12em] text-nexus-white select-all">
            {created.squad.code}
          </span>
        </p>
        {created.leftOut > 0 ? (
          <p className="text-xs text-amber-200">
            {t("leftOut", { count: created.leftOut })}
          </p>
        ) : null}
        <Button variant="outline" onClick={() => void showOverlay("squad")}>
          {t("open")}
        </Button>
      </Card>
    );
  }

  const roles = event.roles
    .filter((role) => event.roleCounts[role.id])
    .map((role) => role.label);
  const count = event.registrationCount;

  return (
    <Card className="flex flex-col gap-3 p-4.5">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-nexus-accent" />
        <h2 className="font-display text-base font-semibold text-nexus-white">
          {t("title")}
        </h2>
      </div>
      {event.squadId ? (
        <p className="text-[13px] text-nexus-muted">{t("alreadyDrawn")}</p>
      ) : (
        <p className="text-[13px] text-nexus-muted">
          {t("hint", {
            count,
            hasRoles: roles.length > 0 ? "yes" : "no",
            roles: roles.join(", "),
          })}
        </p>
      )}
      {create.isError ? (
        <p className="text-xs text-red-300">
          {squadErrorMessage(create.error)}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button
          variant={event.squadId ? "outline" : "primary"}
          disabled={create.isPending || count === 0}
          onClick={() => create.mutate()}
        >
          {t("create")}
        </Button>
        {event.squadId ? (
          <Button variant="ghost" onClick={() => void showOverlay("squad")}>
            {t("open")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
