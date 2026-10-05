import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { BackLink } from "@/components/layout/back-link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { ExternalLink, TriangleAlert } from "lucide-react";
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
  type ItemBlueprintLink,
  type ItemDetails,
  type ItemKind,
  type ItemStatistics,
  type ItemSummary,
  type ResolvedItemSlot,
  type VehiclePlans,
  type WeaponSpread,
} from "@/types/nexus";
import { ReportButton } from "@/components/report-button";
import { PriceConfirmation } from "@/components/price-confirmation";
import {
  Button,
  Card,
  ErrorState,
  LoadingState,
  Chip,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import { cn, formatDate, formatNumber, formatUEC } from "@/lib/utils";

/**
 * One in-game object, as its fiche on the website shows it: the data every
 * kind shares, then what is specific to a vehicle, a weapon or a resource, then
 * what links it to the rest of the catalogue — blueprints, variants, set, and
 * the objects mounted in it or carrying it.
 */
export default function ItemDetailPage() {
  const t = useTranslations("Items.detail");
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
      <>
        <BackLink to="/items">{t("back")}</BackLink>
        <ErrorState
          error={itemQuery.error}
          onRetry={() => void itemQuery.refetch()}
        />
      </>
    );
  }

  const item = itemQuery.data;

  return (
    <>
      <BackLink to="/items">{t("back")}</BackLink>

      <PageHeader
        title={item.name}
        description={[item.manufacturer, item.category, item.subcategory]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <ReportButton type="item" id={item.slug} name={item.name} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openOnWeb()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("openOnWeb")}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ItemHeroImage item={item} />

          {item.description ? (
            <Section title={t("description")}>
              <p className="whitespace-pre-line text-sm leading-relaxed text-nexus-muted">
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
              title={t("madeWith")}
              blueprints={item.blueprints}
              hint={
                item.blueprintsInferred
                  ? t("blueprintsInferred")
                  : undefined
              }
            />
          ) : null}

          {item.kind !== "resource" && item.consumedBy.length > 0 ? (
            <BlueprintList title={t("usedIn")} blueprints={item.consumedBy} />
          ) : null}

          {item.variants.length > 0 ? (
            <RelatedItems
              title={t("variants", { count: item.variants.length })}
              items={item.variants}
              currentSlug={item.slug}
            />
          ) : null}

          {item.setItems.length > 0 ? (
            <RelatedItems
              title={
                item.setName ? t("setNamed", { name: item.setName }) : t("set")
              }
              items={item.setItems}
              currentSlug={item.slug}
            />
          ) : null}

          {item.mountedOn.length > 0 ? (
            <RelatedItems
              title={t("mountedOn", { count: item.mountedOn.length })}
              items={item.mountedOn}
              currentSlug={item.slug}
              hint={t("mountedOnHint")}
            />
          ) : null}
        </div>

        <div className="space-y-4">
          <Section title={t("sheet")}>
            <Readouts
              rows={[
                [t("rows.type"), <KindBadge key="kind" kind={item.kind} />],
                [t("rows.category"), item.category],
                [t("rows.subcategory"), item.subcategory],
                [t("rows.manufacturer"), item.manufacturer],
                [
                  t("rows.size"),
                  item.size !== undefined ? `S${item.size}` : undefined,
                ],
                [t("rows.tier"), item.tier],
                [t("rows.variant"), item.variantName],
                [t("rows.set"), item.setName],
              ]}
            />
          </Section>

          {item.statistics && Object.keys(item.statistics).length > 0 ? (
            <Section title={t("statistics")}>
              <StatisticsList statistics={item.statistics} />
            </Section>
          ) : null}

          {item.obtention ? (
            <Section title={t("obtention")}>
              <p className="whitespace-pre-line text-xs leading-relaxed text-nexus-muted">
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
      <SectionTitle aside={aside}>{title}</SectionTitle>
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
    <dl className="divide-y divide-nexus-accent/8 text-xs">
      {filled.map(([label, value]) => (
        <div
          key={label}
          className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0"
        >
          <dt className="text-nexus-dim">{label}</dt>
          <dd className="text-right text-nexus-white">{value}</dd>
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
    <Card className="px-3.5 py-3">
      <p className="text-[10.5px] font-semibold tracking-wider text-nexus-dim uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg text-nexus-white">
        {formatNumber(value)}
        {unit ? (
          <span className="ml-1 text-xs text-nexus-dim">{unit}</span>
        ) : null}
      </p>
    </Card>
  );
}

/**
 * The kind-specific block is optional on the website too: an object nobody
 * has filled in yet says so rather than showing empty sections.
 */
function IncompleteNotice({ kind }: { kind: ItemKind }) {
  const t = useTranslations("Items.detail.incomplete");
  return (
    <Card className="border-dashed p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-nexus-white">
        <TriangleAlert className="h-4 w-4 text-amber-300/80" />
        {t("title", { kind })}
      </p>
      <p className="mt-1 text-xs text-nexus-muted">
        {t("description")}
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
            name ? "text-nexus-white" : "text-nexus-muted",
          )}
        >
          {slot.label}
        </span>
        <span
          className={cn(
            "block truncate text-xs",
            slot.mounted
              ? "underline decoration-dotted underline-offset-2"
              : "text-nexus-muted",
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
        <span className="shrink-0 text-nexus-dim" aria-hidden>
          ›
        </span>
      ) : null}
    </>
  );

  const className = cn(
    "flex items-center gap-3 rounded-lg border px-3 py-2.5",
    name
      ? "border-nexus-accent/8 bg-[#08243a]"
      : "border-dashed border-nexus-accent/20",
    slot.mounted && "transition-colors hover:border-nexus-accent/35",
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
        <p className="text-xs text-nexus-dim">{noneLabel}</p>
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
            className="flex items-center justify-between gap-3 rounded-lg border border-nexus-accent/8 bg-[#08243a] px-3 py-2.5 transition-colors hover:border-nexus-accent/35"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-nexus-white">
                {blueprint.name}
              </span>
              <span className="block truncate text-xs text-nexus-dim">
                {[blueprint.category, blueprint.subcategory]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {blueprint.quantity ? (
              <span className="shrink-0 font-mono text-xs text-nexus-muted">
                ×{blueprint.quantity}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
      {hint ? (
        <p className="mt-2 text-xs text-nexus-dim">{hint}</p>
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
            layout="row"
            item={related}
            current={related.slug === currentSlug}
          />
        ))}
      </div>
      {hint ? (
        <p className="mt-2 text-xs text-nexus-dim">{hint}</p>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

/** Un plan qui s'affiche comme une image : tout sauf le modèle 3D. */
type PlanView = Exclude<keyof VehiclePlans, "holo">;

/** Les vues plates d'un plan, dans l'ordre où on les regarde. */
const PLAN_VIEWS: PlanView[] = ["top", "side", "front"];

/**
 * Les plans du véhicule : les rendus orthographiques que l'import récupère,
 * une vue à la fois. Le modèle 3D, lui, reste sur la fiche en ligne — la
 * fenêtre n'ouvre le réseau que vers l'API de Nexus Tools.
 */
function VehiclePlanViews({
  plans,
  name,
  scale,
  slug,
}: {
  plans: VehiclePlans;
  name: string;
  scale?: string;
  slug: string;
}) {
  const t = useTranslations("Items.detail.plans");
  const views = PLAN_VIEWS.filter((key) => plans[key]);
  const [picked, setPicked] = useState<PlanView>(() => views[0] ?? "top");
  const [failed, setFailed] = useState<string[]>([]);

  const current = views.find((key) => key === picked) ?? views[0];
  if (!current) return null;

  const url = plans[current]!;

  async function openHolo() {
    const baseUrl = await getApiBaseUrl();
    await openUrl(`${baseUrl}/items/${encodeURIComponent(slug)}`);
  }

  return (
    <Section
      title={t("title")}
      aside={plans.holo ? undefined : t("source")}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {views.map((key) => (
          <Chip
            key={key}
            active={key === current}
            onClick={() => setPicked(key)}
          >
            {t(`views.${key}`)}
          </Chip>
        ))}

        {plans.holo ? (
          <button
            type="button"
            onClick={() => void openHolo()}
            className="ml-auto inline-flex items-center gap-1 text-xs text-nexus-muted transition-colors hover:text-nexus-bright"
          >
            {t("holo")}
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <div className="relative flex h-64 items-center justify-center overflow-hidden rounded-lg border border-nexus-accent/8 bg-[#08243a]">
        {failed.includes(url) ? (
          <p className="text-xs text-nexus-dim">
            {t("unavailable")}
          </p>
        ) : (
          <img
            key={url}
            src={url}
            alt={t("alt", { name, view: current })}
            className="h-full w-full object-contain p-3"
            onError={() =>
              setFailed((urls) => (urls.includes(url) ? urls : [...urls, url]))
            }
          />
        )}

        {scale ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] uppercase tracking-wide text-nexus-dim/80">
            {scale}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function VehicleSections({ item }: { item: ItemDetails }) {
  const t = useTranslations("Items.detail");
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
        <KeyFigure label={t("vehicle.crew")} value={vehicle.crew} />
        <KeyFigure
          label={t("vehicle.speedMax")}
          value={vehicle.speedMax}
          unit="m/s"
        />
        <KeyFigure
          label={t("vehicle.speedScm")}
          value={vehicle.speedScm}
          unit="m/s"
        />
        <KeyFigure
          label={t("vehicle.cargo")}
          value={vehicle.cargoScu}
          unit="SCU"
        />
      </div>

      {vehicle.mass !== undefined || dimensions ? (
        <Section title={t("vehicle.technical")}>
          <Readouts
            rows={[
              [
                t("vehicle.mass"),
                vehicle.mass !== undefined
                  ? `${formatNumber(vehicle.mass)} kg`
                  : undefined,
              ],
              [t("vehicle.dimensions"), dimensions],
            ]}
          />
        </Section>
      ) : null}

      {vehicle.plans ? (
        <VehiclePlanViews
          plans={vehicle.plans}
          name={item.name}
          scale={dimensions}
          slug={item.slug}
        />
      ) : null}

      <SlotList
        title={t("vehicle.armament")}
        slots={item.hardpoints}
        accent={accent}
        emptyLabel={t("slotEmpty")}
        noneLabel={t("vehicle.armamentEmpty")}
      />

      <SlotList
        title={t("vehicle.equipment")}
        slots={item.components}
        accent={accent}
        emptyLabel={t("slotEmpty")}
        noneLabel={t("vehicle.equipmentEmpty")}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Weapons                                                             */
/* ------------------------------------------------------------------ */

const SPREAD_ROWS: (keyof WeaponSpread)[] = [
  "min",
  "max",
  "firstShot",
  "perShot",
  "decay",
];

function SpreadColumn({
  title,
  spread,
}: {
  title: string;
  spread?: WeaponSpread;
}) {
  const t = useTranslations("Items.detail.weapon");
  return (
    <div className="rounded-lg border border-nexus-accent/8 bg-[#08243a] p-3">
      <p className="mb-2 text-[10.5px] font-semibold tracking-wider text-nexus-dim uppercase">
        {title}
      </p>
      {spread ? (
        <Readouts
          rows={SPREAD_ROWS.map((key) => [
            t(`spreadRows.${key}`),
            spread[key] !== undefined
              ? `${formatNumber(spread[key])}${key === "decay" ? "°/s" : "°"}`
              : undefined,
          ])}
        />
      ) : (
        <p className="text-xs text-nexus-dim">{t("spreadEmpty")}</p>
      )}
    </div>
  );
}

function WeaponSections({ item }: { item: ItemDetails }) {
  const t = useTranslations("Items.detail");
  const weapon = item.weapon;
  const accent = KIND_ACCENT.weapon;

  if (!weapon) return <IncompleteNotice kind="weapon" />;

  const ammo = weapon.ammunition;
  const peerMax = Math.max(...item.weaponPeers.map((peer) => peer.value), 1);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KeyFigure
          label={t("weapon.rateOfFire")}
          value={weapon.rateOfFire}
          unit={t("weapon.rpmUnit")}
        />
        <KeyFigure label={t("weapon.magazine")} value={weapon.magazine} />
        <KeyFigure
          label={t("weapon.reload")}
          value={weapon.reloadTime}
          unit="s"
        />
        <KeyFigure label={t("weapon.mass")} value={weapon.mass} unit="kg" />
      </div>

      {(weapon.damageType || weapon.caliber) && (
        <Section title={t("characteristics")}>
          <Readouts
            rows={[
              [t("weapon.damageType"), weapon.damageType],
              [t("weapon.caliber"), weapon.caliber],
            ]}
          />
        </Section>
      )}

      {item.weaponProfile.length > 0 ? (
        <Section
          title={t("weapon.damageProfile")}
          aside={t("weapon.damageProfileHint")}
        >
          <div className="space-y-3">
            {item.weaponProfile.map((stat) => (
              <div key={stat.label}>
                <div className="flex justify-between text-xs">
                  <span className="text-nexus-muted">{stat.label}</span>
                  <span className="font-mono text-nexus-white">
                    {formatNumber(stat.value)}
                    {stat.unit ? ` ${stat.unit}` : ""}
                    {stat.comparable && stat.average !== undefined ? (
                      <span className="ml-2 text-nexus-dim">
                        {t("weapon.average", {
                          value: formatNumber(stat.average),
                        })}
                      </span>
                    ) : null}
                  </span>
                </div>
                {/* A bar only means something against the rest of the class:
                    alone, a full bar would read as a perfect score. */}
                {stat.comparable ? (
                  <div className="mt-1 h-1.5 rounded-full bg-nexus-abyss/70">
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
        <Section title={t("weapon.fireModes")}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold tracking-wider text-nexus-dim uppercase">
                <th className="pb-2 font-medium">{t("weapon.modeLabel")}</th>
                <th className="pb-2 text-right font-medium">
                  {t("weapon.modeRpm")}
                </th>
                <th className="pb-2 text-right font-medium">
                  {t("weapon.modeDps")}
                </th>
                <th className="pb-2 text-right font-medium">
                  {t("weapon.modeAmmo")}
                </th>
                <th className="pb-2 text-right font-medium">
                  {t("weapon.modePellets")}
                </th>
                <th className="pb-2 text-right font-medium">
                  {t("weapon.modeBurst")}
                </th>
              </tr>
            </thead>
            <tbody>
              {weapon.fireModes.map((mode, index) => (
                <tr
                  key={`${mode.label}-${index}`}
                  className="border-t border-nexus-accent/8 font-mono text-nexus-white"
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
        <Section title={t("weapon.spread")} aside={t("weapon.spreadUnit")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <SpreadColumn title={t("weapon.spreadHip")} spread={weapon.spread} />
            <SpreadColumn
              title={t("weapon.spreadAds")}
              spread={weapon.adsSpread}
            />
          </div>
        </Section>
      ) : null}

      {ammo ? (
        <Section title={t("ammo.title")}>
          <Readouts
            rows={[
              [
                t("ammo.damagePerShot"),
                ammo.damagePerShot !== undefined
                  ? formatNumber(ammo.damagePerShot)
                  : undefined,
              ],
              [t("weapon.damageType"), ammo.damageType],
              [
                t("ammo.speed"),
                ammo.speed !== undefined
                  ? `${formatNumber(ammo.speed)} m/s`
                  : undefined,
              ],
              [
                t("ammo.range"),
                ammo.range !== undefined
                  ? `${formatNumber(ammo.range)} m`
                  : undefined,
              ],
              [
                t("ammo.lifetime"),
                ammo.lifetime !== undefined
                  ? `${formatNumber(ammo.lifetime)} s`
                  : undefined,
              ],
              [
                t("ammo.capacity"),
                ammo.capacity !== undefined
                  ? formatNumber(ammo.capacity)
                  : undefined,
              ],
              [
                t("ammo.size"),
                ammo.size !== undefined ? `S${ammo.size}` : undefined,
              ],
              [
                t("ammo.penetration"),
                ammo.penetration !== undefined
                  ? formatNumber(ammo.penetration)
                  : undefined,
              ],
              [
                t("ammo.falloffTitle"),
                ammo.falloffStart !== undefined &&
                ammo.falloffPerMeter !== undefined
                  ? ammo.falloffMinDamage !== undefined
                    ? t("ammo.falloffWithFloor", {
                        start: formatNumber(ammo.falloffStart),
                        perMeter: formatNumber(ammo.falloffPerMeter),
                        min: formatNumber(ammo.falloffMinDamage),
                      })
                    : t("ammo.falloff", {
                        start: formatNumber(ammo.falloffStart),
                        perMeter: formatNumber(ammo.falloffPerMeter),
                      })
                  : undefined,
              ],
            ]}
          />
        </Section>
      ) : null}

      <SlotList
        title={t("weapon.attachments")}
        slots={item.attachments}
        accent={accent}
        emptyLabel={t("slotEmpty")}
        noneLabel={t("weapon.attachmentsEmpty")}
      />

      {item.weaponPeers.length > 1 ? (
        <Section
          title={t("weapon.againstClass")}
          aside={item.weaponProfile[0]?.label}
        >
          <div className="space-y-2">
            {item.weaponPeers.map((peer) => (
              <div key={peer.slug} className="flex items-center gap-3 text-xs">
                <span className="w-40 shrink-0 truncate">
                  {peer.isCurrent ? (
                    <span className="text-nexus-white">{peer.name}</span>
                  ) : (
                    <Link
                      to={`/items/${peer.slug}`}
                      className="text-nexus-muted hover:text-nexus-bright"
                    >
                      {peer.name}
                    </Link>
                  )}
                </span>
                <div className="h-1.5 flex-1 rounded-full bg-nexus-abyss/70">
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
                <span className="w-16 shrink-0 text-right font-mono text-nexus-white">
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

function ResourceSections({ item }: { item: ItemDetails }) {
  const t = useTranslations("Items.detail.resource");
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
      <Section title={t("characteristics")}>
        <Readouts
          rows={[
            [t("form"), resource.form],
            [t("volatile"), resource.volatile ? t("volatileYes") : undefined],
            [
              t("unitVolume"),
              resource.unitVolumeScu !== undefined
                ? `${formatNumber(resource.unitVolumeScu)} SCU`
                : undefined,
            ],
            [t("purity"), purity],
          ]}
        />
        {resource.transportNote ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
            {resource.transportNote}
          </p>
        ) : null}
      </Section>

      <Section
        title={t("markets")}
        aside={
          resource.pricesUpdatedAt
            ? t("pricesUpdated", { date: formatDate(resource.pricesUpdatedAt) })
            : undefined
        }
      >
        {markets.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold tracking-wider text-nexus-dim uppercase">
                <th className="pb-2 font-medium">{t("counter")}</th>
                <th className="pb-2 font-medium">{t("side")}</th>
                <th className="pb-2 text-right font-medium">{t("price")}</th>
                <th className="pb-2 text-right font-medium">{t("stock")}</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((market, index) => (
                <tr
                  key={`${market.location}-${index}`}
                  className="border-t border-nexus-accent/8 text-nexus-white"
                >
                  <td className="py-1.5">{market.location}</td>
                  <td className="py-1.5 text-nexus-muted">
                    {t(`sides.${market.side}`)}
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
          <p className="text-xs text-nexus-dim">{t("marketsEmpty")}</p>
        )}
        {markets.length > 0 ? (
          <PriceConfirmation
            slug={item.slug}
            updatedAt={resource.pricesUpdatedAt}
          />
        ) : null}
      </Section>

      {refining ? (
        <Section title={t("refining")}>
          <Readouts
            rows={[
              [t("process"), refining.process],
              [
                t("yield"),
                refining.yield !== undefined
                  ? `${formatNumber(refining.yield)} %`
                  : undefined,
              ],
              [
                t("cycleDuration"),
                refining.durationSeconds !== undefined
                  ? `${formatNumber(refining.durationSeconds / 60)} min`
                  : undefined,
              ],
              [
                t("cost"),
                refining.cost !== undefined
                  ? formatUEC(refining.cost)
                  : undefined,
              ],
              [t("output"), refining.outputName],
            ]}
          />
        </Section>
      ) : null}

      {resource.extraction && resource.extraction.length > 0 ? (
        <Section title={t("extraction")}>
          <ul className="space-y-1.5 text-xs">
            {resource.extraction.map((site, index) => (
              <li
                key={`${site.location}-${index}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-nexus-white">
                  {site.location}
                  {site.method ? (
                    <span className="text-nexus-dim">
                      {" "}
                      · {site.method}
                    </span>
                  ) : null}
                </span>
                {site.frequency ? (
                  <span className="shrink-0 text-nexus-muted">
                    {t(`frequencies.${site.frequency}`)}
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
