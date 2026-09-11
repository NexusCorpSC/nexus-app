import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, TriangleAlert } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getItem } from "@/lib/api/items";
import { getApiBaseUrl } from "@/lib/settings";
import {
  ItemCard,
  ItemHeroImage,
  KIND_ACCENT,
  KindBadge,
} from "@/components/item-card";
import {
  ITEM_KIND_LABELS,
  type ItemBlueprintLink,
  type ItemDetails,
  type ItemKind,
  type ItemStatistics,
  type ItemSummary,
  type ResolvedItemSlot,
  type ResourceMarketSide,
  type WeaponSpread,
} from "@/types/nexus";
import {
  Button,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { cn, formatDate, formatNumber, formatUEC } from "@/lib/utils";

/**
 * One in-game object, as its fiche on the website shows it: the data every
 * kind shares, then what is specific to a vehicle, a weapon or a resource, then
 * what links it to the rest of the catalogue — blueprints, variants, set, and
 * the objects mounted in it or carrying it.
 */
export default function ItemDetailPage() {
  const { slug = "" } = useParams();

  const itemQuery = useQuery({
    queryKey: ["item", slug],
    queryFn: () => getItem(slug),
    enabled: Boolean(slug),
  });

  async function openOnWeb() {
    const baseUrl = await getApiBaseUrl();
    await openUrl(`${baseUrl}/items/${encodeURIComponent(slug)}`);
  }

  if (itemQuery.isPending) return <LoadingState />;

  if (itemQuery.isError) {
    return (
      <ErrorState
        error={itemQuery.error}
        onRetry={() => void itemQuery.refetch()}
      />
    );
  }

  const item = itemQuery.data;

  return (
    <>
      <Link
        to="/items"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-nexus-accent/60 transition-colors hover:text-nexus-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Retour aux objets
      </Link>

      <PageHeader
        title={item.name}
        description={[item.manufacturer, item.category, item.subcategory]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void openOnWeb()}>
            <ExternalLink className="h-3.5 w-3.5" />
            Ouvrir sur le web
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ItemHeroImage item={item} />

          {item.description ? (
            <Section title="Description">
              <p className="whitespace-pre-line text-sm leading-relaxed text-nexus-accent/75">
                {item.description}
              </p>
            </Section>
          ) : null}

          {item.kind === "vehicle" ? (
            <VehicleSections item={item} />
          ) : item.kind === "weapon" ? (
            <WeaponSections item={item} />
          ) : item.kind === "resource" ? (
            <ResourceSections item={item} />
          ) : null}

          {item.blueprints.length > 0 ? (
            <BlueprintList
              title="Fabriqué avec"
              blueprints={item.blueprints}
              hint={
                item.blueprintsInferred
                  ? "Blueprints du même nom : aucun lien n'a été posé à la main."
                  : undefined
              }
            />
          ) : null}

          {item.kind !== "resource" && item.consumedBy.length > 0 ? (
            <BlueprintList title="Utilisé dans" blueprints={item.consumedBy} />
          ) : null}

          {item.variants.length > 0 ? (
            <RelatedItems
              title={`${item.variants.length} variantes`}
              items={item.variants}
              currentSlug={item.slug}
            />
          ) : null}

          {item.setItems.length > 0 ? (
            <RelatedItems
              title={item.setName ? `Ensemble : ${item.setName}` : "Ensemble"}
              items={item.setItems}
              currentSlug={item.slug}
            />
          ) : null}

          {item.mountedOn.length > 0 ? (
            <RelatedItems
              title={`Monté sur ${item.mountedOn.length} objet${item.mountedOn.length > 1 ? "s" : ""}`}
              items={item.mountedOn}
              currentSlug={item.slug}
              hint="D'après l'équipement d'origine renseigné sur chaque fiche."
            />
          ) : null}
        </div>

        <div className="space-y-4">
          <Section title="Fiche">
            <Readouts
              rows={[
                ["Type", <KindBadge key="kind" kind={item.kind} />],
                ["Catégorie", item.category],
                ["Sous-catégorie", item.subcategory],
                ["Fabricant", item.manufacturer],
                [
                  "Taille",
                  item.size !== undefined ? `S${item.size}` : undefined,
                ],
                ["Tier", item.tier],
                ["Variante", item.variantName],
                ["Ensemble", item.setName],
              ]}
            />
          </Section>

          {item.statistics && Object.keys(item.statistics).length > 0 ? (
            <Section title="Statistiques">
              <StatisticsList statistics={item.statistics} />
            </Section>
          ) : null}

          {item.obtention ? (
            <Section title="Où l'obtenir">
              <p className="whitespace-pre-line text-xs leading-relaxed text-nexus-accent/70">
                {item.obtention}
              </p>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-nexus-bright">{title}</h2>
        {aside ? (
          <span className="text-xs text-nexus-accent/50">{aside}</span>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

type Row = [label: string, value: ReactNode | undefined];

/** Label / value pairs, skipping what is not filled in. */
function Readouts({ rows }: { rows: Row[] }) {
  const filled = rows.filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (filled.length === 0) return null;

  return (
    <dl className="space-y-2 text-xs">
      {filled.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="text-nexus-accent/50">{label}</dt>
          <dd className="text-right text-nexus-bright/85">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatisticsList({ statistics }: { statistics: ItemStatistics }) {
  return (
    <Readouts
      rows={Object.entries(statistics).map(([name, stat]) => [
        name,
        `${stat.value}${stat.unit ? ` ${stat.unit}` : ""}`,
      ])}
    />
  );
}

/** A big figure with its unit, for what defines the object at a glance. */
function KeyFigure({
  label,
  value,
  unit,
}: {
  label: string;
  value?: number;
  unit?: string;
}) {
  if (value === undefined) return null;
  return (
    <div className="rounded-lg border border-nexus-accent/10 bg-nexus-abyss/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-nexus-accent/50">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg text-nexus-bright">
        {formatNumber(value)}
        {unit ? (
          <span className="ml-1 text-xs text-nexus-accent/60">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * The kind-specific block is optional on the website too: an object nobody
 * has filled in yet says so rather than showing empty sections.
 */
function IncompleteNotice({ kind }: { kind: ItemKind }) {
  return (
    <Card className="border-dashed p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-nexus-bright">
        <TriangleAlert className="h-4 w-4 text-amber-300/80" />
        Fiche {ITEM_KIND_LABELS[kind].toLowerCase()} à compléter
      </p>
      <p className="mt-1 text-xs text-nexus-accent/60">
        Les données propres à ce type d'objet n'ont pas encore été renseignées
        sur le site.
      </p>
    </Card>
  );
}

/** One slot and what it carries: a link when the object has a fiche. */
function SlotRow({
  slot,
  accent,
  emptyLabel,
}: {
  slot: ResolvedItemSlot;
  accent: string;
  emptyLabel: string;
}) {
  const name = slot.mounted?.name ?? slot.itemName;
  const mounted =
    name && slot.quantity !== undefined && slot.quantity > 1
      ? `${slot.quantity} × ${name}`
      : name;
  const detail = [mounted, slot.note].filter(Boolean).join(" · ");

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-medium",
            name ? "text-nexus-bright" : "text-nexus-bright/50",
          )}
        >
          {slot.label}
        </span>
        <span
          className={cn(
            "block truncate text-xs",
            slot.mounted
              ? "underline decoration-dotted underline-offset-2"
              : "text-nexus-accent/60",
          )}
          style={{ color: slot.mounted ? accent : undefined }}
        >
          {detail || emptyLabel}
        </span>
      </span>
      {slot.size !== undefined ? (
        <span className="shrink-0 rounded-full border border-nexus-accent/25 px-2 py-0.5 font-mono text-xs text-nexus-accent/80">
          S{slot.size}
        </span>
      ) : null}
      {slot.mounted ? (
        <span className="shrink-0 text-nexus-accent/50" aria-hidden>
          ›
        </span>
      ) : null}
    </>
  );

  const className = cn(
    "flex items-center gap-3 rounded-lg border px-3 py-2.5",
    name
      ? "border-nexus-accent/10 bg-nexus-abyss/40"
      : "border-dashed border-nexus-accent/20",
    slot.mounted && "transition-colors hover:border-nexus-accent/40",
  );

  return slot.mounted ? (
    <Link to={`/items/${slot.mounted.slug}`} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function SlotList({
  title,
  slots,
  accent,
  emptyLabel,
  noneLabel,
}: {
  title: string;
  slots: ResolvedItemSlot[];
  accent: string;
  emptyLabel: string;
  noneLabel: string;
}) {
  return (
    <Section
      title={title}
      aside={slots.length > 0 ? `${slots.length}` : undefined}
    >
      {slots.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {slots.map((slot, index) => (
            <SlotRow
              key={`${slot.label}-${index}`}
              slot={slot}
              accent={accent}
              emptyLabel={emptyLabel}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-nexus-accent/50">{noneLabel}</p>
      )}
    </Section>
  );
}

function BlueprintList({
  title,
  blueprints,
  hint,
}: {
  title: string;
  blueprints: ItemBlueprintLink[];
  hint?: string;
}) {
  return (
    <Section title={title}>
      <div className="grid gap-2 sm:grid-cols-2">
        {blueprints.map((blueprint) => (
          <Link
            key={blueprint.slug}
            to={`/blueprints/${blueprint.slug}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-nexus-accent/10 bg-nexus-abyss/40 px-3 py-2.5 transition-colors hover:border-nexus-accent/40"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-nexus-bright">
                {blueprint.name}
              </span>
              <span className="block truncate text-xs text-nexus-accent/50">
                {[blueprint.category, blueprint.subcategory]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {blueprint.quantity ? (
              <span className="shrink-0 font-mono text-xs text-nexus-accent/70">
                ×{blueprint.quantity}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
      {hint ? (
        <p className="mt-2 text-xs text-nexus-accent/50">{hint}</p>
      ) : null}
    </Section>
  );
}

function RelatedItems({
  title,
  items,
  currentSlug,
  hint,
}: {
  title: string;
  items: ItemSummary[];
  currentSlug: string;
  hint?: string;
}) {
  return (
    <Section title={title}>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((related) => (
          <ItemCard
            key={related.slug}
            item={related}
            current={related.slug === currentSlug}
          />
        ))}
      </div>
      {hint ? (
        <p className="mt-2 text-xs text-nexus-accent/50">{hint}</p>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

function VehicleSections({ item }: { item: ItemDetails }) {
  const vehicle = item.vehicle;
  const accent = KIND_ACCENT.vehicle;

  if (!vehicle) return <IncompleteNotice kind="vehicle" />;

  const dimensions = [vehicle.length, vehicle.width, vehicle.height].every(
    (value) => value !== undefined,
  )
    ? `${formatNumber(vehicle.length)} × ${formatNumber(vehicle.width)} × ${formatNumber(vehicle.height)} m`
    : undefined;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KeyFigure label="Places" value={vehicle.crew} />
        <KeyFigure label="Vitesse max" value={vehicle.speedMax} unit="m/s" />
        <KeyFigure label="Croisière" value={vehicle.speedScm} unit="m/s" />
        <KeyFigure label="Soute" value={vehicle.cargoScu} unit="SCU" />
      </div>

      {vehicle.mass !== undefined || dimensions ? (
        <Section title="Fiche technique">
          <Readouts
            rows={[
              [
                "Masse",
                vehicle.mass !== undefined
                  ? `${formatNumber(vehicle.mass)} kg`
                  : undefined,
              ],
              ["Dimensions", dimensions],
            ]}
          />
        </Section>
      ) : null}

      <SlotList
        title="Armement"
        slots={item.hardpoints}
        accent={accent}
        emptyLabel="Emplacement vide"
        noneLabel="Aucun point d'emport renseigné."
      />

      <SlotList
        title="Équipements"
        slots={item.components}
        accent={accent}
        emptyLabel="Emplacement vide"
        noneLabel="Aucun composant renseigné."
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Weapons                                                             */
/* ------------------------------------------------------------------ */

const SPREAD_ROWS: [keyof WeaponSpread, string][] = [
  ["min", "Minimum"],
  ["max", "Maximum"],
  ["firstShot", "Premier tir"],
  ["perShot", "Par tir"],
  ["decay", "Décroissance"],
];

function SpreadColumn({
  title,
  spread,
}: {
  title: string;
  spread?: WeaponSpread;
}) {
  return (
    <div className="rounded-lg border border-nexus-accent/10 bg-nexus-abyss/40 p-3">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-nexus-accent/50">
        {title}
      </p>
      {spread ? (
        <Readouts
          rows={SPREAD_ROWS.map(([key, label]) => [
            label,
            spread[key] !== undefined
              ? `${formatNumber(spread[key])}${key === "decay" ? "°/s" : "°"}`
              : undefined,
          ])}
        />
      ) : (
        <p className="text-xs text-nexus-accent/50">Non renseignée.</p>
      )}
    </div>
  );
}

function WeaponSections({ item }: { item: ItemDetails }) {
  const weapon = item.weapon;
  const accent = KIND_ACCENT.weapon;

  if (!weapon) return <IncompleteNotice kind="weapon" />;

  const ammo = weapon.ammunition;
  const peerMax = Math.max(...item.weaponPeers.map((peer) => peer.value), 1);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KeyFigure label="Cadence" value={weapon.rateOfFire} unit="coups/min" />
        <KeyFigure label="Chargeur" value={weapon.magazine} />
        <KeyFigure label="Rechargement" value={weapon.reloadTime} unit="s" />
        <KeyFigure label="Masse" value={weapon.mass} unit="kg" />
      </div>

      {(weapon.damageType || weapon.caliber) && (
        <Section title="Caractéristiques">
          <Readouts
            rows={[
              ["Type de dégâts", weapon.damageType],
              ["Calibre", weapon.caliber],
            ]}
          />
        </Section>
      )}

      {item.weaponProfile.length > 0 ? (
        <Section title="Profil de dégâts" aside="rapporté à sa classe">
          <div className="space-y-3">
            {item.weaponProfile.map((stat) => (
              <div key={stat.label}>
                <div className="flex justify-between text-xs">
                  <span className="text-nexus-accent/70">{stat.label}</span>
                  <span className="font-mono text-nexus-bright">
                    {formatNumber(stat.value)}
                    {stat.unit ? ` ${stat.unit}` : ""}
                    {stat.comparable && stat.average !== undefined ? (
                      <span className="ml-2 text-nexus-accent/45">
                        | moy. {formatNumber(stat.average)}
                      </span>
                    ) : null}
                  </span>
                </div>
                {/* A bar only means something against the rest of the class:
                    alone, a full bar would read as a perfect score. */}
                {stat.comparable ? (
                  <div className="mt-1 h-1.5 rounded-full bg-nexus-abyss/60">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (stat.value / stat.max) * 100)}%`,
                        backgroundColor: accent,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {weapon.fireModes && weapon.fireModes.length > 0 ? (
        <Section title="Modes de tir">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-nexus-accent/50">
                <th className="pb-2 font-medium">Mode</th>
                <th className="pb-2 text-right font-medium">Cadence</th>
                <th className="pb-2 text-right font-medium">DPS</th>
                <th className="pb-2 text-right font-medium">Mun. / tir</th>
                <th className="pb-2 text-right font-medium">Projectiles</th>
                <th className="pb-2 text-right font-medium">Rafale</th>
              </tr>
            </thead>
            <tbody>
              {weapon.fireModes.map((mode, index) => (
                <tr
                  key={`${mode.label}-${index}`}
                  className="border-t border-nexus-accent/10 font-mono text-nexus-bright/85"
                >
                  <td className="py-1.5 font-sans font-medium">{mode.label}</td>
                  <td className="py-1.5 text-right">
                    {formatNumber(mode.rpm)}
                  </td>
                  <td className="py-1.5 text-right">
                    {formatNumber(mode.dps)}
                  </td>
                  <td className="py-1.5 text-right">
                    {formatNumber(mode.ammoPerShot)}
                  </td>
                  <td className="py-1.5 text-right">
                    {formatNumber(mode.pelletsPerShot)}
                  </td>
                  <td className="py-1.5 text-right">
                    {formatNumber(mode.burstCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {weapon.spread || weapon.adsSpread ? (
        <Section title="Dispersion" aside="degrés">
          <div className="grid gap-3 sm:grid-cols-2">
            <SpreadColumn title="À la hanche" spread={weapon.spread} />
            <SpreadColumn title="En visée" spread={weapon.adsSpread} />
          </div>
        </Section>
      ) : null}

      {ammo ? (
        <Section title="Munitions">
          <Readouts
            rows={[
              [
                "Dégâts par tir",
                ammo.damagePerShot !== undefined
                  ? formatNumber(ammo.damagePerShot)
                  : undefined,
              ],
              ["Type de dégâts", ammo.damageType],
              [
                "Vitesse",
                ammo.speed !== undefined
                  ? `${formatNumber(ammo.speed)} m/s`
                  : undefined,
              ],
              [
                "Portée",
                ammo.range !== undefined
                  ? `${formatNumber(ammo.range)} m`
                  : undefined,
              ],
              [
                "Durée de vol",
                ammo.lifetime !== undefined
                  ? `${formatNumber(ammo.lifetime)} s`
                  : undefined,
              ],
              [
                "Capacité",
                ammo.capacity !== undefined
                  ? formatNumber(ammo.capacity)
                  : undefined,
              ],
              ["Taille", ammo.size !== undefined ? `S${ammo.size}` : undefined],
              [
                "Pénétration",
                ammo.penetration !== undefined
                  ? formatNumber(ammo.penetration)
                  : undefined,
              ],
              [
                "Chute des dégâts",
                ammo.falloffStart !== undefined &&
                ammo.falloffPerMeter !== undefined
                  ? `pleins jusqu'à ${formatNumber(ammo.falloffStart)} m, puis −${formatNumber(ammo.falloffPerMeter)}/m${
                      ammo.falloffMinDamage !== undefined
                        ? `, plancher ${formatNumber(ammo.falloffMinDamage)}`
                        : ""
                    }`
                  : undefined,
              ],
            ]}
          />
        </Section>
      ) : null}

      <SlotList
        title="Accessoires"
        slots={item.attachments}
        accent={accent}
        emptyLabel="Emplacement vide"
        noneLabel="Aucun accessoire renseigné."
      />

      {item.weaponPeers.length > 1 ? (
        <Section title="Face à sa classe" aside={item.weaponProfile[0]?.label}>
          <div className="space-y-2">
            {item.weaponPeers.map((peer) => (
              <div key={peer.slug} className="flex items-center gap-3 text-xs">
                <span className="w-40 shrink-0 truncate">
                  {peer.isCurrent ? (
                    <span className="text-nexus-bright">{peer.name}</span>
                  ) : (
                    <Link
                      to={`/items/${peer.slug}`}
                      className="text-nexus-accent/75 hover:text-nexus-bright"
                    >
                      {peer.name}
                    </Link>
                  )}
                </span>
                <div className="h-1.5 flex-1 rounded-full bg-nexus-abyss/60">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (peer.value / peerMax) * 100)}%`,
                      backgroundColor: peer.isCurrent
                        ? accent
                        : "rgba(158,208,255,0.35)",
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-nexus-bright/85">
                  {formatNumber(peer.value)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

const MARKET_SIDE_LABELS: Record<ResourceMarketSide, string> = {
  buy: "Achète",
  sell: "Vend",
  grey: "Marché gris",
};

const FREQUENCY_LABELS = {
  common: "Courant",
  occasional: "Occasionnel",
  risky: "Risqué",
} as const;

function ResourceSections({ item }: { item: ItemDetails }) {
  const resource = item.resource;

  if (!resource) return <IncompleteNotice kind="resource" />;

  const purity =
    resource.purityMin !== undefined || resource.purityMax !== undefined
      ? [resource.purityMin, resource.purityMax]
          .filter((value) => value !== undefined)
          .map((value) => `${formatNumber(value)} %`)
          .join(" – ")
      : undefined;
  const markets = resource.markets ?? [];
  const refining = resource.refining;

  return (
    <>
      <Section title="Caractéristiques">
        <Readouts
          rows={[
            ["Forme", resource.form],
            [
              "Volatile",
              resource.volatile ? "Oui : cargaison instable" : undefined,
            ],
            [
              "Volume unitaire",
              resource.unitVolumeScu !== undefined
                ? `${formatNumber(resource.unitVolumeScu)} SCU`
                : undefined,
            ],
            ["Pureté", purity],
          ]}
        />
        {resource.transportNote ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
            {resource.transportNote}
          </p>
        ) : null}
      </Section>

      <Section
        title="Cours par comptoir"
        aside={
          resource.pricesUpdatedAt
            ? `relevés le ${formatDate(resource.pricesUpdatedAt)}`
            : undefined
        }
      >
        {markets.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-nexus-accent/50">
                <th className="pb-2 font-medium">Comptoir</th>
                <th className="pb-2 font-medium">Sens</th>
                <th className="pb-2 text-right font-medium">Prix</th>
                <th className="pb-2 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((market, index) => (
                <tr
                  key={`${market.location}-${index}`}
                  className="border-t border-nexus-accent/10 text-nexus-bright/85"
                >
                  <td className="py-1.5">{market.location}</td>
                  <td className="py-1.5 text-nexus-accent/70">
                    {MARKET_SIDE_LABELS[market.side]}
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {formatUEC(market.price)}
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {market.stock !== undefined
                      ? formatNumber(market.stock)
                      : "∞"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-nexus-accent/50">Aucun cours relevé.</p>
        )}
      </Section>

      {refining ? (
        <Section title="Raffinage">
          <Readouts
            rows={[
              ["Procédé", refining.process],
              [
                "Rendement",
                refining.yield !== undefined
                  ? `${formatNumber(refining.yield)} %`
                  : undefined,
              ],
              [
                "Durée du cycle",
                refining.durationSeconds !== undefined
                  ? `${formatNumber(refining.durationSeconds / 60)} min`
                  : undefined,
              ],
              [
                "Coût",
                refining.cost !== undefined
                  ? formatUEC(refining.cost)
                  : undefined,
              ],
              ["Produit", refining.outputName],
            ]}
          />
        </Section>
      ) : null}

      {resource.extraction && resource.extraction.length > 0 ? (
        <Section title="Lieux d'extraction">
          <ul className="space-y-1.5 text-xs">
            {resource.extraction.map((site, index) => (
              <li
                key={`${site.location}-${index}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-nexus-bright/85">
                  {site.location}
                  {site.method ? (
                    <span className="text-nexus-accent/50">
                      {" "}
                      · {site.method}
                    </span>
                  ) : null}
                </span>
                {site.frequency ? (
                  <span className="shrink-0 text-nexus-accent/60">
                    {FREQUENCY_LABELS[site.frequency]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
