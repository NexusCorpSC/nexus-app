import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { Play, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingState,
  Modal,
  SearchField,
} from "@/components/ui";
import {
  enumName,
  listGameActions,
  MAX_HOLD_MS,
  telemetryErrorCode,
  triggerGameAction,
  TRIGGER_STATUS,
  type Connection,
  type GameAction,
} from "@/lib/telemetry";

type Outcome = { action: string; ok: boolean; text: string };

/**
 * The actions the game lets the app trigger, each on its own click. The ones
 * that cannot be taken back (`dangerous`) ask first.
 */
export function GameActions({ connection }: { connection: Connection }) {
  const t = useTranslations("Telemetry");
  const [actions, setActions] = useState<GameAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [holds, setHolds] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<GameAction | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const connected = connection === "connected";

  useEffect(() => {
    if (!connected) {
      setActions(null);
      return;
    }
    let gone = false;
    setError(null);
    void listGameActions()
      .then((list) => {
        if (!gone) setActions(list);
      })
      .catch((cause) => {
        if (!gone) setError(String(cause));
      });
    return () => {
      gone = true;
    };
  }, [connected]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byCategory = new Map<string, GameAction[]>();
    for (const action of actions ?? []) {
      if (
        needle &&
        !action.name.toLowerCase().includes(needle) &&
        !action.category.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const category = action.category || t("actions.otherCategory");
      byCategory.set(category, [...(byCategory.get(category) ?? []), action]);
    }
    return [...byCategory.entries()];
  }, [actions, query, t]);

  function holdMs(action: GameAction): number | undefined {
    if (!action.holdable) return undefined;
    const seconds = Number.parseFloat(
      (holds[action.name] ?? "").replace(",", "."),
    );
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    return Math.min(MAX_HOLD_MS, Math.round(seconds * 1000));
  }

  async function trigger(action: GameAction, confirmed: boolean) {
    setPending(action.name);
    setOutcome(null);
    try {
      const result = await triggerGameAction(action.name, {
        holdMs: holdMs(action),
        confirmed,
      });
      const status = enumName(TRIGGER_STATUS, result.status);
      setOutcome({
        action: action.name,
        ok: status === "ok",
        text: status
          ? t(`triggerStatus.${status}`)
          : result.message || t("triggerStatus.failed"),
      });
    } catch (cause) {
      const code = telemetryErrorCode(cause);
      setOutcome({
        action: action.name,
        ok: false,
        text: code ? t(`errors.${code}`) : String(cause),
      });
    } finally {
      setPending(null);
    }
  }

  function press(action: GameAction) {
    if (action.dangerous) setConfirming(action);
    else void trigger(action, false);
  }

  if (!connected) {
    return (
      <Card className="p-4">
        <p className="text-[13px] text-nexus-muted">
          {t("actions.notConnected")}
        </p>
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="p-4">
        <p className="text-[13px] text-red-300">{t("actions.loadError")}</p>
      </Card>
    );
  }
  if (actions === null) return <LoadingState label={t("actions.loading")} />;

  return (
    <div className="space-y-3">
      <SearchField
        label={t("actions.search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("actions.search")}
      />
      {outcome ? (
        <p
          role="status"
          className={
            outcome.ok
              ? "text-[13px] text-emerald-200"
              : "text-[13px] text-amber-200"
          }
        >
          <code>{outcome.action}</code> — {outcome.text}
        </p>
      ) : null}
      {groups.length === 0 ? (
        <EmptyState title={t("actions.none")} />
      ) : (
        groups.map(([category, list]) => (
          <Card key={category} className="p-3">
            <h3 className="mb-2 px-1 font-display text-[11px] font-semibold tracking-[0.12em] text-nexus-muted uppercase">
              {category}
            </h3>
            <ul className="divide-y divide-nexus-accent/8">
              {list.map((action) => (
                <li
                  key={action.name}
                  className="flex flex-wrap items-center gap-2 px-1 py-1.5"
                >
                  <code className="min-w-0 flex-1 truncate text-[13px] text-nexus-bright">
                    {action.name}
                  </code>
                  {action.dangerous ? (
                    <Badge tone="warning">{t("actions.dangerous")}</Badge>
                  ) : null}
                  {action.holdable ? (
                    <Input
                      aria-label={t("actions.holdLabel", {
                        action: action.name,
                      })}
                      placeholder={t("actions.holdPlaceholder")}
                      inputMode="decimal"
                      value={holds[action.name] ?? ""}
                      onChange={(event) =>
                        setHolds((current) => ({
                          ...current,
                          [action.name]: event.target.value,
                        }))
                      }
                      className="h-8 w-24 py-1 text-xs"
                    />
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant={action.dangerous ? "danger" : "outline"}
                    disabled={pending !== null}
                    onClick={() => press(action)}
                  >
                    <Play className="size-3.5" />
                    {t("actions.trigger")}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      <Modal
        open={confirming !== null}
        title={t("actions.confirmTitle")}
        description={confirming?.name}
        icon={<TriangleAlert className="size-5 text-amber-300" />}
        onClose={() => setConfirming(null)}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(null)}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                const action = confirming;
                setConfirming(null);
                if (action) void trigger(action, true);
              }}
            >
              {t("actions.confirm")}
            </Button>
          </div>
        }
      >
        <p className="text-[13.5px] text-nexus-soft">
          {t("actions.confirmBody")}
        </p>
      </Modal>
    </div>
  );
}
