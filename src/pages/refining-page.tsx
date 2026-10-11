import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, FlaskConical, PackagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "use-intl";
import { useAuth } from "@/auth/auth-context";
import {
  Button,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { QualityBadge } from "@/components/inventory/inventory-items";
import { CollectModal } from "@/components/refining/collect-modal";
import { JobModal } from "@/components/refining/job-modal";
import { useNow, useRefiningJobs } from "@/hooks/use-refining-watcher";
import { getLocale } from "@/i18n/locale";
import { deleteRefiningJob } from "@/lib/api/refining";
import {
  readWorkOrderImport,
  WORK_ORDER_PARAM,
  type WorkOrderImport,
} from "@/lib/refinery-work-order";
import {
  formatMinutes,
  isFinished,
  minutesLeft,
  REFINING_KEY,
  totalQuantity,
} from "@/lib/refining";
import { cn, formatNumber, formatUEC } from "@/lib/utils";
import type { RefiningJob } from "@/types/nexus";

/**
 * The reader's refining orders, as on the site: a summary, then a card per
 * order with its countdown, its materials and their quality. A finished order
 * is collected into the inventory, then goes away.
 *
 * A finished-panel capture taken with the area capture lands here when an
 * order is ready (see `overlay-page.tsx`): it opens that order's collection
 * with the lines read, or asks which order when several are ready.
 */
export default function RefiningPage() {
  const t = useTranslations("Refining");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useNow();
  const jobs = useRefiningJobs(user?.id);
  const [editing, setEditing] = useState<RefiningJob | null>(null);
  const [creating, setCreating] = useState(false);
  const [collecting, setCollecting] = useState<RefiningJob | null>(null);
  const [capture, setCapture] = useState<WorkOrderImport | null>(null);

  const list = useMemo(() => jobs.data ?? [], [jobs.data]);
  const ready = list.filter((job) => isFinished(job, now));
  const running = list.filter((job) => !isFinished(job, now));
  const volume = list.reduce((sum, job) => sum + totalQuantity(job.lines), 0);
  const next = running.length
    ? Math.min(...running.map((job) => minutesLeft(job, now)))
    : null;

  // A capture handed over in the route: read once the orders are known,
  // then dropped from it, so going back does not bring it again.
  const captureParam = searchParams.get(WORK_ORDER_PARAM);
  const loaded = jobs.data;
  // React runs an effect twice in development: the capture must land once.
  const consumedRef = useRef<string | null>(null);
  useEffect(() => {
    if (captureParam === null) {
      consumedRef.current = null;
      return;
    }
    if (!loaded || consumedRef.current === captureParam) return;
    consumedRef.current = captureParam;
    const order = readWorkOrderImport(captureParam);
    const finished = loaded.filter((job) => isFinished(job, Date.now()));
    if (order && finished.length === 0) {
      // Nothing to collect: the capture goes to the bulk add, as before.
      navigate(
        `/inventory/quick-add?${new URLSearchParams({
          [WORK_ORDER_PARAM]: captureParam,
        })}`,
        { replace: true },
      );
      return;
    }
    setSearchParams({}, { replace: true });
    if (!order) return;
    setCapture(order);
    if (finished.length === 1) setCollecting(finished[0]);
  }, [captureParam, loaded, navigate, setSearchParams]);

  const lastLocation = useMemo(() => {
    const latest = [...list]
      .filter((job) => job.locationId)
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0];
    return latest?.locationId
      ? { id: latest.locationId, name: latest.location }
      : null;
  }, [list]);

  const remove = useMutation({
    mutationFn: (jobId: string) => deleteRefiningJob(jobId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: REFINING_KEY }),
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            {t("newJob")}
          </Button>
        }
      />

      {capture && !collecting && ready.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-nexus-accent/25 bg-nexus-card px-4 py-3 text-[13px] text-nexus-bright">
          <Camera className="size-4 text-nexus-accent" />
          <span className="mr-auto">{t("captureWhich")}</span>
          {ready.map((job) => (
            <Button
              key={job.id}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCollecting(job)}
            >
              {job.location}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setCapture(null)}
          >
            {t("cancel")}
          </Button>
        </div>
      ) : null}

      {jobs.isLoading ? (
        <LoadingState />
      ) : jobs.error && !jobs.data ? (
        <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Stat label={t("statRunning")} value={formatNumber(running.length)} />
            <Stat
              label={t("statReady")}
              value={formatNumber(ready.length)}
              ready={ready.length > 0}
            />
            <Stat label={t("statVolume")} value={formatNumber(volume)} unit="cSCU" />
            <Stat
              label={t("statNext")}
              value={next === null ? "—" : formatMinutes(next)}
            />
          </dl>

          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-nexus-accent/20 px-6 py-10 text-center">
              <FlaskConical className="mx-auto size-8 text-nexus-accent/60" />
              <p className="mt-3 font-medium text-nexus-white">
                {t("emptyTitle")}
              </p>
              <p className="mt-1 text-[13px] text-nexus-muted">
                {t("emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {list.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  now={now}
                  busy={remove.isPending && remove.variables === job.id}
                  onEdit={() => setEditing(job)}
                  onCollect={() => setCollecting(job)}
                  onDelete={() => remove.mutate(job.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {creating || editing ? (
        <JobModal
          key={editing?.id ?? "new"}
          job={editing ?? undefined}
          defaultLocation={lastLocation}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}
      {collecting ? (
        <CollectModal
          key={collecting.id}
          job={collecting}
          captured={capture?.lines}
          onClose={() => {
            setCollecting(null);
            setCapture(null);
          }}
        />
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  unit,
  ready,
}: {
  label: string;
  value: string;
  unit?: string;
  ready?: boolean;
}) {
  return (
    <div className="rounded-lg border border-nexus-accent/12 bg-nexus-card px-3 py-2.5">
      <dt className="font-mono text-[10.5px] tracking-[0.12em] text-nexus-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "font-mono text-xl font-bold tabular-nums",
          ready ? "text-emerald-300" : "text-nexus-white",
        )}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-xs font-semibold text-nexus-muted">
            {unit}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function JobCard({
  job,
  now,
  busy,
  onEdit,
  onCollect,
  onDelete,
}: {
  job: RefiningJob;
  now: number;
  busy: boolean;
  onEdit: () => void;
  onCollect: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Refining");
  const finished = isFinished(job, now);
  const left = minutesLeft(job, now);
  const since = Math.max(1, Math.floor((now - Date.parse(job.endTime)) / 60_000));
  const progress = Math.min(100, Math.max(0, 100 - (left * 100) / job.duration));
  const started = new Date(job.startTime).toLocaleString(getLocale(), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const end = new Date(job.endTime).toLocaleString(getLocale(), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-nexus-card p-4",
        finished
          ? "border-emerald-300/45 shadow-[inset_0_0_0_1px_rgba(110,231,183,0.12)]"
          : "border-nexus-accent/12",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[15px] font-semibold text-nexus-white">
            {job.location}
          </h3>
          <p className="text-xs text-nexus-muted">
            {[job.method, t("startedAt", { date: started })]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px]",
            finished
              ? "border-emerald-300/45 bg-emerald-300/10 text-emerald-300"
              : "border-nexus-accent/35 text-nexus-accent",
          )}
        >
          {finished ? t("ready") : t("running")}
        </span>
      </header>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "font-mono text-lg font-bold tabular-nums",
              finished ? "text-emerald-300" : "text-nexus-white",
            )}
          >
            {finished ? t("done") : formatMinutes(left)}
          </span>
          <span className="text-xs text-nexus-muted">
            {finished
              ? t("readySince", { duration: formatMinutes(since) })
              : t("readyAt", { date: end })}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-nexus-accent/12">
          <div
            className={cn(
              "h-full rounded-full",
              finished ? "bg-emerald-300" : "bg-nexus-accent",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {job.lines.length > 0 ? (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left font-mono text-[10.5px] tracking-[0.12em] text-nexus-muted uppercase">
              <th className="pb-1.5 font-medium">{t("material")}</th>
              <th className="pb-1.5 font-medium">{t("quality")}</th>
              <th className="pb-1.5 text-right font-medium">cSCU</th>
            </tr>
          </thead>
          <tbody>
            {job.lines.map((line, index) => (
              <tr key={index} className="border-t border-nexus-accent/8">
                <td className="py-1.5 pr-2 text-nexus-bright">{line.name}</td>
                <td className="py-1.5 pr-2">
                  {line.quality !== undefined ? (
                    <QualityBadge quality={line.quality} />
                  ) : (
                    <span className="text-nexus-dim">—</span>
                  )}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums text-nexus-white">
                  {formatNumber(line.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-nexus-accent/8 text-xs text-nexus-muted">
              <td colSpan={2} className="pt-1.5">
                {[
                  t("linesCount", { count: job.lines.length }),
                  job.cost !== undefined
                    ? t("costValue", { cost: formatUEC(job.cost) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </td>
              <td className="pt-1.5 text-right font-mono tabular-nums">
                {formatNumber(totalQuantity(job.lines))}
              </td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="rounded-lg border border-dashed border-nexus-accent/25 px-3 py-2 text-[13px] text-nexus-soft">
          {t("legacyContent", { content: job.content ?? "" })}
          <span className="mt-0.5 block text-xs text-nexus-dim">
            {t("legacyHint")}
          </span>
        </p>
      )}

      {job.note ? <p className="text-xs text-nexus-muted">{job.note}</p> : null}

      <footer className="mt-auto flex flex-wrap items-center gap-1 border-t border-nexus-accent/10 pt-2.5">
        {finished ? (
          <Button
            type="button"
            size="sm"
            onClick={onCollect}
            className="border-emerald-300 bg-emerald-300 text-[#053527] hover:bg-emerald-200"
          >
            <PackagePlus className="size-3.5" />
            {t("collect")}
          </Button>
        ) : (
          <span className="text-xs text-nexus-dim">{t("collectLater")}</span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("edit")}
          title={t("edit")}
          className="inline-flex size-8 items-center justify-center rounded-md text-nexus-muted hover:bg-nexus-panel hover:text-nexus-bright"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={t("delete")}
          title={t("delete")}
          className="inline-flex size-8 items-center justify-center rounded-md text-nexus-muted hover:bg-nexus-panel hover:text-red-300 disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </footer>
    </article>
  );
}
