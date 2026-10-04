import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, FolderOpen, ImagePlus, RefreshCw } from "lucide-react";
import { mediaErrorMessage, uploadPlaceMedia } from "@/lib/api/contrib";
import { notify } from "@/lib/notifications";
import { getLatestScreenshot, prepareImage } from "@/lib/screenshots";
import { formatAgo } from "@/lib/utils";
import {
  MAX_MEDIA_CAPTION_LENGTH,
  MAX_MEDIA_CREDIT_LENGTH,
  PLACE_FIRST_MEDIA_BONUS,
  PLACE_MEDIA_POINTS,
  type PlaceDetails,
} from "@/types/nexus";
import { Button, Field, Input, Modal, Segmented } from "@/components/ui";

type Source = "game" | "file";

/**
 * « Ajouter une capture » : la dernière capture d'écran du jeu, ou un fichier
 * choisi, envoyée comme image du lieu. Publiée tout de suite à partir du
 * niveau 2, relue avant sinon — c'est le site qui en décide.
 */
export function AddMediaButton({ place }: { place: PlaceDetails }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ImagePlus className="h-3.5 w-3.5" />
        Ajouter une capture
      </Button>
      {open ? (
        <AddMediaModal place={place} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/** Une URL `blob:` pour l'aperçu, rendue quand l'image change. */
function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}

function AddMediaModal({
  place,
  onClose,
}: {
  place: PlaceDetails;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<Source>("game");
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [credit, setCredit] = useState("");

  // Relue à chaque ouverture : la capture d'il y a cinq minutes n'est
  // peut-être plus la dernière.
  const latest = useQuery({
    queryKey: ["latest-screenshot"],
    queryFn: getLatestScreenshot,
    enabled: source === "game",
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const chosen =
    source === "game"
      ? latest.data
        ? { blob: latest.data.blob, name: latest.data.name }
        : null
      : file
        ? { blob: file as Blob, name: file.name }
        : null;
  const preview = useObjectUrl(chosen?.blob);

  const isFirst = !place.imageUrl;
  const points = PLACE_MEDIA_POINTS + (isFirst ? PLACE_FIRST_MEDIA_BONUS : 0);

  const send = useMutation({
    mutationFn: async () => {
      if (!chosen) throw new Error("Choisissez une image.");
      const image = await prepareImage(chosen.blob, chosen.name);
      return uploadPlaceMedia(place.slug, {
        file: image.blob,
        fileName: image.fileName,
        width: image.width,
        height: image.height,
        caption: caption.trim() || undefined,
        credit: credit.trim() || undefined,
      });
    },
    onSuccess: async ({ contribution }) => {
      const published = contribution.status === "published";
      await notify({
        kind: "success",
        title: published
          ? contribution.points > 0
            ? `Image publiée, +${contribution.points} points`
            : "Image publiée"
          : "Image envoyée : elle sera relue avant publication.",
        body: place.name,
        route: `/places/${place.slug}`,
      });
      void queryClient.invalidateQueries({ queryKey: ["place", place.slug] });
      void queryClient.invalidateQueries({ queryKey: ["me-contrib"] });
      onClose();
    },
  });

  return (
    <Modal
      open
      title="Ajouter une capture"
      description={`${place.name} · votre image rejoint la galerie du lieu`}
      icon={<Camera className="size-5" />}
      onClose={onClose}
      footer={
        <>
          <span
            className="rounded-full bg-amber-300/12 px-2.5 py-1 font-mono text-xs font-bold text-amber-200"
            title={
              isFirst
                ? `Dont +${PLACE_FIRST_MEDIA_BONUS} : la première image du lieu`
                : `+${PLACE_FIRST_MEDIA_BONUS} si c'est la première du lieu`
            }
          >
            +{points} points
          </span>
          <Button variant="outline" onClick={onClose} className="ml-auto">
            Annuler
          </Button>
          <Button
            onClick={() => send.mutate()}
            disabled={!chosen || send.isPending}
          >
            {send.isPending ? "Envoi…" : "Envoyer l'image"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented<Source>
          label="Source de l'image"
          value={source}
          onChange={setSource}
          options={[
            {
              value: "game",
              label: "Dernière capture du jeu",
              icon: <Camera className="size-3.5" />,
            },
            {
              value: "file",
              label: "Choisir un fichier",
              icon: <FolderOpen className="size-3.5" />,
            },
          ]}
        />

        {source === "game" ? (
          latest.isPending ? (
            <p className="text-[13px] text-nexus-muted">
              Recherche de la dernière capture…
            </p>
          ) : latest.isError ? (
            <div className="space-y-2">
              <p role="alert" className="text-[13px] text-amber-200">
                {latest.error instanceof Error
                  ? latest.error.message
                  : String(latest.error)}
              </p>
              <p className="text-xs text-nexus-dim">
                Le dossier du jeu, celui du Game.log, se règle dans Paramètres ›
                Jeu. En jeu, une capture se prend avec la touche Impr. écran.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-nexus-muted">
                <span className="text-nexus-white">{latest.data.name}</span>
                {" · "}
                prise {formatAgo(latest.data.modifiedMs)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void latest.refetch()}
                disabled={latest.isFetching}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Relire
              </Button>
            </div>
          )
        ) : (
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-nexus-muted file:mr-3 file:rounded-lg file:border file:border-nexus-accent/25 file:bg-transparent file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-nexus-bright hover:file:bg-nexus-accent/8"
          />
        )}

        {preview ? (
          <img
            src={preview}
            alt="Aperçu de l'image envoyée"
            className="max-h-64 w-full rounded-lg border border-nexus-accent/12 bg-nexus-abyss object-contain"
          />
        ) : null}

        <Field label="Légende (facultatif)">
          <Input
            value={caption}
            maxLength={MAX_MEDIA_CAPTION_LENGTH}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Le hall d'arrivée, vu des quais"
          />
        </Field>
        <Field label="Crédit (facultatif)">
          <Input
            value={credit}
            maxLength={MAX_MEDIA_CREDIT_LENGTH}
            onChange={(event) => setCredit(event.target.value)}
            placeholder="Votre pseudo, ou l'auteur de l'image"
          />
        </Field>

        <p className="text-xs leading-relaxed text-nexus-dim">
          +{PLACE_MEDIA_POINTS} points par image publiée, +
          {PLACE_FIRST_MEDIA_BONUS} si c'est la première du lieu. L'image est
          réduite à 2560 pixels avant l'envoi ; évitez l'interface personnelle
          (pseudo, messages) dans le cadre.
        </p>

        {send.isError ? (
          <p role="alert" className="text-[13px] text-red-300">
            {mediaErrorMessage(send.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
