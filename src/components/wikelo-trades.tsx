import { Link } from "react-router-dom";
import { useTranslations } from "use-intl";
import { Card, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { WikeloTrade, WikeloTradeEntry } from "@/types/nexus";

/**
 * Wikelo's trades on an item or blueprint fiche, as the website shows them
 * (`components/wikelo-trades.tsx` in nexus-tools): what to bring him, what he
 * gives. Titles and names stay the in-game English ones.
 */

function useAmount() {
  const t = useTranslations("Wikelo");
  return (entry: WikeloTradeEntry) =>
    entry.scu !== undefined
      ? t("scu", { count: entry.scu })
      : t("units", { count: entry.quantity ?? 1 });
}

function EntryName({
  entry,
  highlightSlug,
}: {
  entry: WikeloTradeEntry;
  highlightSlug?: string;
}) {
  const current =
    highlightSlug !== undefined && entry.itemSlug === highlightSlug;
  if (!entry.itemSlug || current) {
    return (
      <span className={cn(current && "font-semibold text-nexus-white")}>
        {entry.name}
      </span>
    );
  }
  return (
    <Link
      to={`/items/${encodeURIComponent(entry.itemSlug)}`}
      className="text-nexus-accent hover:underline"
    >
      {entry.name}
    </Link>
  );
}

function EntryList({
  entries,
  highlightSlug,
}: {
  entries: WikeloTradeEntry[];
  highlightSlug?: string;
}) {
  const amount = useAmount();
  return (
    <ul className="space-y-1 text-xs text-nexus-muted">
      {entries.map((entry, index) => (
        <li key={`${entry.name}-${index}`} className="flex gap-2">
          <span className="w-14 shrink-0 text-right font-mono text-nexus-dim">
            {amount(entry)}
          </span>
          <EntryName entry={entry} highlightSlug={highlightSlug} />
        </li>
      ))}
    </ul>
  );
}

function Rewards({
  trade,
  highlightSlug,
}: {
  trade: WikeloTrade;
  highlightSlug?: string;
}) {
  const t = useTranslations("Wikelo");
  if (trade.rewardChoices.length <= 1) {
    return (
      <EntryList
        entries={trade.rewardChoices[0] ?? []}
        highlightSlug={highlightSlug}
      />
    );
  }
  return (
    <div className="space-y-1 text-xs text-nexus-muted">
      <p className="text-nexus-dim">
        {t("randomReward", { count: trade.rewardChoices.length })}
      </p>
      <ul className="space-y-0.5">
        {trade.rewardChoices.map((group, index) => (
          <li key={index}>
            {group.map((entry, entryIndex) => (
              <span key={`${entry.name}-${entryIndex}`}>
                {entryIndex > 0 && " + "}
                {(entry.quantity ?? 1) > 1 && `${entry.quantity} × `}
                <EntryName entry={entry} highlightSlug={highlightSlug} />
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One trade in full: what to bring, what it gives. */
export function WikeloTradeCard({
  trade,
  highlightSlug,
  highlightBlueprintSlug,
}: {
  trade: WikeloTrade;
  highlightSlug?: string;
  highlightBlueprintSlug?: string;
}) {
  const t = useTranslations("Wikelo");
  return (
    <div className="space-y-3 rounded-lg border border-nexus-accent/12 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-sm font-semibold text-nexus-white">{trade.title}</p>
        {trade.onceOnly ? (
          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10.5px] text-amber-200">
            {t("onceOnly")}
          </span>
        ) : null}
        {trade.reputation !== undefined ? (
          <span className="text-[11px] text-nexus-dim">
            {t("reputation", { count: trade.reputation })}
          </span>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10.5px] font-semibold tracking-wider text-nexus-dim uppercase">
            {t("bring")}
          </p>
          <EntryList
            entries={trade.requirements}
            highlightSlug={highlightSlug}
          />
        </div>
        <div>
          <p className="mb-1 text-[10.5px] font-semibold tracking-wider text-nexus-dim uppercase">
            {t("receive")}
          </p>
          <Rewards trade={trade} highlightSlug={highlightSlug} />
          {trade.blueprints.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-nexus-muted">
              {trade.blueprints.map((blueprint) => (
                <li key={blueprint.gameId}>
                  <span className="text-nexus-dim">{t("blueprint")} </span>
                  {blueprint.slug &&
                  blueprint.slug !== highlightBlueprintSlug ? (
                    <Link
                      to={`/blueprints/${encodeURIComponent(blueprint.slug)}`}
                      className="text-nexus-accent hover:underline"
                    >
                      {blueprint.name}
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        blueprint.slug === highlightBlueprintSlug &&
                          "font-semibold text-nexus-white",
                      )}
                    >
                      {blueprint.name}
                    </span>
                  )}
                  {blueprint.chance !== undefined
                    ? ` (${t("chance", { percent: Math.round(blueprint.chance * 100) })})`
                    : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {trade.missionId ? (
        <Link
          to={`/missions/${encodeURIComponent(trade.missionId)}`}
          className="inline-block text-[11px] text-nexus-dim hover:text-nexus-accent"
        >
          {t("missionLink")}
        </Link>
      ) : null}
    </div>
  );
}

/** A trade asking for the shown item, on one line. */
function WantedRow({
  trade,
  itemSlug,
}: {
  trade: WikeloTrade;
  itemSlug: string;
}) {
  const t = useTranslations("Wikelo");
  const amount = useAmount();
  const needed = trade.requirements.find(
    (entry) => entry.itemSlug === itemSlug,
  );
  const rewards =
    trade.rewardChoices.length === 1 ? trade.rewardChoices[0] : [];
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-xs text-nexus-muted">
      {needed ? (
        <span className="font-mono text-nexus-dim">{amount(needed)}</span>
      ) : null}
      <span className="text-nexus-dim">→</span>
      {rewards.length > 0 ? (
        rewards.map((entry, index) => (
          <span key={`${entry.name}-${index}`}>
            {index > 0 && " + "}
            <EntryName entry={entry} />
          </span>
        ))
      ) : (
        <span>{t("randomReward", { count: trade.rewardChoices.length })}</span>
      )}
      <span className="text-[11px] text-nexus-dim">({trade.title})</span>
    </li>
  );
}

/** The item fiche's section: trades giving the item, then those asking for it. */
export function ItemWikeloSection({
  itemSlug,
  rewards,
  wanted,
}: {
  itemSlug: string;
  rewards: WikeloTrade[];
  wanted: WikeloTrade[];
}) {
  const t = useTranslations("Wikelo");
  if (rewards.length === 0 && wanted.length === 0) return null;
  const version = (rewards[0] ?? wanted[0]).version;
  return (
    <>
      {rewards.length > 0 ? (
        <Card className="p-5">
          <SectionTitle>{t("itemTitle")}</SectionTitle>
          <p className="mb-3 text-xs text-nexus-dim">{t("itemHint")}</p>
          <div className="space-y-2">
            {rewards.map((trade) => (
              <WikeloTradeCard
                key={trade.id}
                trade={trade}
                highlightSlug={itemSlug}
              />
            ))}
          </div>
          <p className="mt-3 text-[11px] text-nexus-dim">
            {t("source", { version })}
          </p>
        </Card>
      ) : null}
      {wanted.length > 0 ? (
        <Card className="p-5">
          <SectionTitle>
            {t("wantedTitle", { count: wanted.length })}
          </SectionTitle>
          <p className="mb-2 text-xs text-nexus-dim">{t("wantedHint")}</p>
          <ul className="space-y-1">
            {wanted.map((trade) => (
              <WantedRow key={trade.id} trade={trade} itemSlug={itemSlug} />
            ))}
          </ul>
          {rewards.length === 0 ? (
            <p className="mt-3 text-[11px] text-nexus-dim">
              {t("source", { version })}
            </p>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

/** The blueprint fiche's section: trades giving the blueprint. */
export function BlueprintWikeloSection({
  blueprintSlug,
  trades,
}: {
  blueprintSlug: string;
  trades: WikeloTrade[];
}) {
  const t = useTranslations("Wikelo");
  if (trades.length === 0) return null;
  return (
    <Card className="p-5">
      <SectionTitle>{t("blueprintTitle")}</SectionTitle>
      <p className="mb-3 text-xs text-nexus-dim">{t("blueprintHint")}</p>
      <div className="space-y-2">
        {trades.map((trade) => (
          <WikeloTradeCard
            key={trade.id}
            trade={trade}
            highlightBlueprintSlug={blueprintSlug}
          />
        ))}
      </div>
      <p className="mt-3 text-[11px] text-nexus-dim">
        {t("source", { version: trades[0].version })}
      </p>
    </Card>
  );
}
