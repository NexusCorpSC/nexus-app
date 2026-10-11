import { openUrl } from "@tauri-apps/plugin-opener";
import { MapPinPlus } from "lucide-react";
import { useTranslations } from "use-intl";
import { useAuth } from "@/auth/auth-context";
import { getApiBaseUrl } from "@/lib/settings";
import { Button } from "@/components/ui";

/** Ce que rapporte un lieu proposé, une fois publié (`POINTS.placeCreate` côté site). */
const PLACE_CREATE_POINTS = 3;

/**
 * Proposer un lieu qui manque, sur le site : la liste laisse choisir le lieu
 * parent, une fiche l'impose (« Il manque un lieu ici ? »). Réservé aux
 * joueurs connectés, comme les autres contributions.
 */
export function ProposePlaceButton({ parentSlug }: { parentSlug?: string }) {
  const t = useTranslations("Places.propose");
  const { user } = useAuth();
  if (!user) return null;

  async function open() {
    const baseUrl = await getApiBaseUrl();
    await openUrl(
      parentSlug
        ? `${baseUrl}/lieux/${encodeURIComponent(parentSlug)}/contribuer/lieu`
        : `${baseUrl}/lieux/proposer`,
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void open()}
      title={t("hint", { points: PLACE_CREATE_POINTS })}
    >
      <MapPinPlus className="h-3.5 w-3.5" />
      {parentSlug ? t("here") : t("button")}
      <span className="rounded-full bg-amber-300/12 px-1.5 font-mono text-[11px] font-bold text-amber-200">
        +{PLACE_CREATE_POINTS}
      </span>
    </Button>
  );
}
