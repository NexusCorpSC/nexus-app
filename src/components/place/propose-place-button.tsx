import { openUrl } from "@tauri-apps/plugin-opener";
import { MapPinPlus } from "lucide-react";
import { useTranslations } from "use-intl";
import { translator } from "@/i18n/translate";
import { notify } from "@/lib/notifications";
import { getApiBaseUrl } from "@/lib/settings";
import { Button } from "@/components/ui";
import { PLACE_CREATE_POINTS } from "@/types/nexus";

/**
 * Proposer un lieu qui manque, sur le site : la liste laisse choisir le lieu
 * parent, une fiche l'impose (« Il manque un lieu ici ? »). Réservé aux
 * joueurs connectés : c'est à l'appelant de ne l'afficher qu'à eux, comme
 * l'ajout d'image.
 */
export function ProposePlaceButton({ parentSlug }: { parentSlug?: string }) {
  const t = useTranslations("Places.propose");

  async function open() {
    try {
      const baseUrl = await getApiBaseUrl();
      await openUrl(
        parentSlug
          ? `${baseUrl}/lieux/${encodeURIComponent(parentSlug)}/contribuer/lieu`
          : `${baseUrl}/lieux/proposer`,
      );
    } catch (error) {
      console.error("Ouverture du formulaire de lieu impossible", error);
      await notify({
        kind: "error",
        title: translator("Places.propose")("openFailed"),
      });
    }
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
