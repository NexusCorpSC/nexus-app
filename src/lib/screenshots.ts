import { invoke } from "@tauri-apps/api/core";
import { getGameLogSettings } from "@/lib/settings";
import { translator } from "@/i18n/translate";

/**
 * Screenshots sent as images of a place: the game's latest one, read from its
 * `ScreenShots` folder by Rust (`src-tauri/src/screenshots.rs`), or a file the
 * player picks; either way re-encoded here before upload.
 */

export type Screenshot = {
  name: string;
  /** Last modified, in milliseconds since the epoch. */
  modifiedMs: number;
  blob: Blob;
};

function mimeFor(name: string): string {
  return /\.png$/i.test(name) ? "image/png" : "image/jpeg";
}

/**
 * The newest image in `<game folder>/ScreenShots`, the game folder being the
 * one the settings hold for `Game.log`. Rejects with a sentence to show as is
 * when there is none.
 */
export async function getLatestScreenshot(): Promise<Screenshot> {
  const { dir } = await getGameLogSettings();
  const packed = await invoke<ArrayBuffer>("latest_screenshot", { dir });

  // `[header length: u32 LE][header: JSON][image bytes]`, see `pack` in Rust.
  const view = new DataView(packed);
  const headerLength = view.getUint32(0, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(packed, 4, headerLength)),
  ) as { name: string; modifiedMs: number };
  const bytes = new Uint8Array(packed, 4 + headerLength);

  return {
    name: header.name,
    modifiedMs: header.modifiedMs,
    blob: new Blob([bytes], { type: mimeFor(header.name) }),
  };
}

/** Longest side sent: past this, the site would only shrink it again. */
const MAX_SIDE = 2560;
const JPEG_QUALITY = 0.85;
/** Under the site's 4 MB, with room for the rest of the form. */
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

export type PreparedImage = {
  blob: Blob;
  width: number;
  height: number;
  fileName: string;
};

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error(translator("Capture")("encodeFailed"))),
      "image/jpeg",
      quality,
    );
  });
}

/**
 * The image as it is uploaded: at most {@link MAX_SIDE} pixels on its longest
 * side, re-encoded as JPEG, and lowered in quality, then in size, until it
 * fits under {@link MAX_UPLOAD_BYTES}. A 4K screenshot comes out around 1 MB.
 */
export async function prepareImage(
  source: Blob,
  name: string,
): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    throw new Error(translator("Capture")("unreadable"));
  }

  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    let quality = JPEG_QUALITY;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(translator("Capture")("encodeFailed"));
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);

      const blob = await toJpeg(canvas, quality);
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return {
          blob,
          width: canvas.width,
          height: canvas.height,
          fileName: `${name.replace(/\.[^.]+$/, "") || "capture"}.jpg`,
        };
      }
      if (quality > 0.7) quality = 0.7;
      else scale *= 0.8;
    }
  } finally {
    bitmap.close();
  }

  throw new Error(translator("Capture")("tooLarge"));
}
