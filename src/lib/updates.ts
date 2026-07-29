import { check, type Update } from "@tauri-apps/plugin-updater";

/**
 * Self-update against the GitHub releases of the repository.
 *
 * The manifest (`latest.json`) is attached to each release by
 * `.github/workflows/release.yml`; the plugin compares its version with the one
 * this build carries and only reports a **higher** one. Nothing is ever
 * installed without the user saying so.
 */

export type { Update };

export type UpdateProgress = {
  /** Bytes received so far. */
  downloaded: number;
  /** Total size, when the server announced one. */
  total: number | null;
};

/** The available update, or `null` when this build is the latest. */
export function checkForUpdate(): Promise<Update | null> {
  return check();
}

/**
 * Downloads the update and hands it to the installer.
 *
 * On Windows the plugin starts the installer and ends this process itself, so
 * nothing after this call runs — the installer brings the app back up (it is
 * given `/R`, from `installMode: "passive"`).
 */
export async function installUpdate(
  update: Update,
  onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        break;
      case "Finished":
        downloaded = total ?? downloaded;
        break;
    }

    onProgress({ downloaded, total });
  });
}

/**
 * What went wrong, in a sentence a user can act on.
 *
 * The plugin's own messages are English and mention its internals; the two
 * cases worth telling apart are «no manifest to read» — which is also what an
 * unpublished release looks like — and the rest.
 */
export function describeUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/release not found|Could not fetch a valid release/i.test(message)) {
    return "Aucune release publiée n'annonce de mise à jour.";
  }

  return `Impossible de vérifier les mises à jour : ${message}`;
}
