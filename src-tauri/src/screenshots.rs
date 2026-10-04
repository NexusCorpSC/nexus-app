//! The game's latest screenshot, for the « Ajouter une capture » dialog of a
//! place (`src/components/place/add-media-button.tsx`).
//!
//! Star Citizen writes its screenshots to `ScreenShots/` in its install folder
//! — the same folder `Game.log` is in, which the settings already know. Plain
//! `std::fs`: nothing here needs a Windows API, so this compiles everywhere.
//!
//! The image goes back as raw bytes (`tauri::ipc::Response`) rather than a
//! JSON array of numbers, which would be several times the size of a
//! multi-megabyte JPEG. The file's name and date travel in front of it, in a
//! small header; see [`pack`].

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::ipc::Response;

/// The folder the game writes its screenshots to, inside its install folder.
const SCREENSHOTS_DIR: &str = "ScreenShots";

/// What the game writes, and what the site accepts after a re-encode.
const EXTENSIONS: [&str; 3] = ["jpg", "jpeg", "png"];

/// A screenshot past this is not one the game wrote: refuse rather than load
/// it whole into the webview.
const MAX_BYTES: u64 = 64 * 1024 * 1024;

/// What comes before the image bytes.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Header {
    name: String,
    /// Last modified, in milliseconds since the epoch.
    modified_ms: u64,
}

/// `[header length: u32 LE][header: JSON][image bytes]`, read back by
/// `getLatestScreenshot` in `src/lib/screenshots.ts`.
fn pack(header: &Header, bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(header).map_err(|error| error.to_string())?;
    let mut out = Vec::with_capacity(4 + json.len() + bytes.len());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(&bytes);
    Ok(out)
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// The most recently modified image of `folder`, with its date in ms.
fn newest_image(folder: &Path) -> Option<(PathBuf, u64)> {
    fs::read_dir(folder)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !is_image(&path) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let modified = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some((path, modified))
        })
        .max_by_key(|(_, modified)| *modified)
}

fn read_latest(dir: &str) -> Result<Vec<u8>, String> {
    let folder = Path::new(dir.trim()).join(SCREENSHOTS_DIR);
    let not_found = || format!("Aucune capture trouvée dans {}", folder.display());

    let (path, modified_ms) = newest_image(&folder).ok_or_else(not_found)?;

    let size = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    if size > MAX_BYTES {
        return Err(format!(
            "{} est trop lourde pour être envoyée.",
            path.display()
        ));
    }

    let bytes = fs::read(&path)
        .map_err(|error| format!("Impossible de lire {} : {error}", path.display()))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();

    pack(&Header { name, modified_ms }, bytes)
}

/// The newest image in `<dir>/ScreenShots`, `dir` being the game's folder as
/// the settings hold it. Read off the main thread: the file can weigh a few
/// megabytes.
#[tauri::command]
pub async fn latest_screenshot(dir: String) -> Result<Response, String> {
    let packed = tauri::async_runtime::spawn_blocking(move || read_latest(&dir))
        .await
        .map_err(|error| error.to_string())??;
    Ok(Response::new(packed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_newest_image_and_packs_it() {
        let root = std::env::temp_dir().join(format!("nexus-screenshots-{}", std::process::id()));
        let folder = root.join(SCREENSHOTS_DIR);
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&folder).unwrap();

        fs::write(folder.join("old.jpg"), b"old").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(folder.join("notes.txt"), b"not an image").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(folder.join("new.PNG"), b"new").unwrap();

        let packed = read_latest(root.to_str().unwrap()).unwrap();
        let length = u32::from_le_bytes(packed[..4].try_into().unwrap()) as usize;
        let header: serde_json::Value = serde_json::from_slice(&packed[4..4 + length]).unwrap();
        assert_eq!(header["name"], "new.PNG");
        assert_eq!(&packed[4 + length..], b"new");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn says_where_it_looked() {
        let error = read_latest("/nowhere/at/all").unwrap_err();
        assert!(error.starts_with("Aucune capture trouvée dans"));
        assert!(error.contains(SCREENSHOTS_DIR));
    }
}
