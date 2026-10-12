import { Link, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslations } from "use-intl";
import type { LoreArticleSummary, StarmapSensor } from "@/types/lore";

export const lorePath = (id: string) => `/lore/${encodeURIComponent(id)}`;
export const systemPath = (code: string) =>
  `/lore/systems/${encodeURIComponent(code)}`;

/** Un lien vers un autre article de la Galactapedia, sur le site de RSI. */
const GALACTAPEDIA_LINK =
  /^(?:https?:\/\/robertsspaceindustries\.com)?\/galactapedia\/article\/([A-Za-z0-9]{10})/;

/**
 * Le texte d'un article. Un lien vers un article que nous avons ouvre sa
 * fiche dans l'app ; les autres liens s'ouvrent dans le navigateur.
 */
export function LoreMarkdown({
  content,
  known,
}: {
  content: string;
  /** Les identifiants des articles cités qui sont en base. */
  known: Set<string>;
}) {
  const navigate = useNavigate();
  return (
    <div className="chat-markdown text-sm leading-relaxed" lang="en">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (!href) return;
                const id = GALACTAPEDIA_LINK.exec(href)?.[1];
                if (id && known.has(id)) navigate(lorePath(id));
                else if (/^https?:\/\//.test(href)) void openUrl(href);
                else if (id)
                  void openUrl(`https://robertsspaceindustries.com${href}`);
              }}
            >
              {children}
            </a>
          ),
          img: () => null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** La miniature d'un article, servie par RSI. */
export function LoreThumbnail({
  src,
  className,
}: {
  src?: string;
  className: string;
}) {
  if (!src) return null;
  return <img src={src} alt="" loading="lazy" className={className} />;
}

export function LoreArticleCard({ article }: { article: LoreArticleSummary }) {
  return (
    <Link
      to={lorePath(article.id)}
      className="group flex gap-3 rounded-xl border border-nexus-accent/12 bg-nexus-card p-3 transition-colors hover:border-nexus-accent/35"
    >
      <LoreThumbnail
        src={article.thumbnailUrl}
        className="size-14 shrink-0 rounded-lg border border-nexus-accent/12 object-cover"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-nexus-white">
          {article.title}
        </p>
        {article.categories.length > 0 ? (
          <p className="truncate text-xs text-sky-300/80">
            {article.categories.join(" · ")}
          </p>
        ) : null}
        <p lang="en" className="mt-1 line-clamp-2 text-xs text-nexus-dim">
          {article.excerpt}
        </p>
      </div>
    </Link>
  );
}

/** Population, économie et danger, de 0 à 10. */
export function SensorRatings({ sensor }: { sensor?: StarmapSensor }) {
  const t = useTranslations("Lore");
  if (!sensor) return null;
  const entries = [
    ["population", sensor.population],
    ["economy", sensor.economy],
    ["danger", sensor.danger],
  ] as const;
  return (
    <dl className="flex flex-wrap gap-2 text-xs">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="rounded-lg border border-nexus-accent/15 bg-[#08243a] px-2.5 py-1"
        >
          <dt className="inline text-nexus-dim">{t(key)} </dt>
          <dd className="inline font-semibold text-nexus-white">
            {t("rating", { value: Math.round(value * 10) / 10 })}
          </dd>
        </div>
      ))}
    </dl>
  );
}
