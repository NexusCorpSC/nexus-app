//! Star Citizen's `Game.log`, read as the game writes it.
//!
//! The game logs what its HUD tells the player — a blueprint received, and a
//! good deal more — to `Game.log` in its install folder. This follows the end
//! of that file, as `tail -f` would, turns the lines it recognises into
//! [`LogEvent`]s and hands them to the main window, which has the session and
//! the network to do something about them (`src/hooks/use-game-log.ts`).
//!
//! Real time only: what the file already holds when the app starts is skipped,
//! so a relaunch of the app does not replay the whole evening. A file that
//! appears or is recreated afterwards — the game rotates it to `logbackups/`
//! and starts a new one on every launch — is read from its first line, since
//! everything in it happened while the app was watching.
//!
//! Polled rather than watched: the game holds the file open for writing all
//! session long, change notifications on such a file are unreliable on
//! Windows, and one `metadata` call a second costs nothing.

use std::collections::HashSet;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, SystemTime};

use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tokio::sync::watch;

use crate::diagnostics::log;

/// Carries a [`BlueprintReceived`] to the main window.
const BLUEPRINT_EVENT: &str = "game-log://blueprint";

/// The window that acts on what the log says: it holds the session.
const MAIN_WINDOW: &str = "main";

/// The settings store the frontend owns, and the keys read from it. Mirrors
/// `src/lib/settings.ts`.
const STORE_FILE: &str = "settings.json";
const KEY_GAME_LOG_DIR: &str = "gameLogDir";
const KEY_GAME_LOG_ENABLED: &str = "gameLogEnabled";

/// Where the RSI launcher installs the live build unless told otherwise.
/// Mirrors `DEFAULT_GAME_LOG_DIR` in `src/lib/settings.ts`.
const DEFAULT_GAME_DIR: &str = r"C:\Program Files\Roberts Space Industries\StarCitizen\LIVE";

const LOG_FILE_NAME: &str = "Game.log";

const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// The most read in one poll. The game writes a few kilobytes a second at
/// worst; this only bounds the first read of a file that grew while the
/// machine was asleep.
const MAX_READ: u64 = 4 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/// What a line of the log can mean. One variant for now; the rest of the log
/// is there for the next ones.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LogEvent {
    BlueprintReceived(BlueprintReceived),
}

/// A « Received Blueprint » notification, as the HUD showed it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintReceived {
    /// The blueprint's name as the game spells it — the display name, which is
    /// also what Nexus Tools stores.
    pub name: String,
    /// The timestamp the line opens with, as written.
    pub logged_at: String,
}

/// `<2026-09-28T12:00:00.000Z> … Received Blueprint: <name>: "…`
fn blueprint_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r#"<([^>]+)>.*Received Blueprint:\s*(.*?):\s*""#)
            .expect("the blueprint pattern compiles")
    })
}

/// What `line` says, if it says anything this module knows about.
pub fn parse_line(line: &str) -> Option<LogEvent> {
    let captures = blueprint_pattern().captures(line)?;
    let name = captures.get(2)?.as_str().trim();

    if name.is_empty() {
        return None;
    }

    Some(LogEvent::BlueprintReceived(BlueprintReceived {
        name: name.to_string(),
        logged_at: captures.get(1)?.as_str().to_string(),
    }))
}

/* ------------------------------------------------------------------ */
/* Following the file                                                  */
/* ------------------------------------------------------------------ */

/// Which file a [`Tail`] is reading: another creation time is another file,
/// even at the same path and even if it has already grown past the offset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileIdentity {
    created: Option<SystemTime>,
}

/// What one poll found.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Poll {
    /// Whether the file is there.
    pub exists: bool,
    /// Whether the file was found new or recreated: what was learnt from the
    /// previous one no longer holds.
    pub restarted: bool,
    /// The complete lines written since the last poll.
    pub lines: Vec<String>,
}

/// The end of a file, followed across polls.
#[derive(Debug)]
pub struct Tail {
    path: PathBuf,
    /// How far the file has been read. `None` until it is first seen.
    offset: Option<u64>,
    identity: Option<FileIdentity>,
    /// Whether the content found at the first sighting is history to skip.
    /// True only for a file already there when the tail starts.
    skip_existing: bool,
    /// The start of a line the game has not finished writing.
    partial: Vec<u8>,
}

impl Tail {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            offset: None,
            identity: None,
            skip_existing: true,
            partial: Vec::new(),
        }
    }

    pub fn poll(&mut self) -> io::Result<Poll> {
        let metadata = match std::fs::metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                // Whatever shows up next was written while we were watching.
                self.offset = None;
                self.identity = None;
                self.skip_existing = false;
                self.partial.clear();
                return Ok(Poll::default());
            }
            Err(error) => return Err(error),
        };

        let len = metadata.len();
        let identity = FileIdentity {
            created: metadata.created().ok(),
        };

        let mut poll = Poll {
            exists: true,
            ..Poll::default()
        };

        let offset = match self.offset {
            None => {
                poll.restarted = true;
                if self.skip_existing {
                    len
                } else {
                    0
                }
            }
            Some(offset) if len < offset || self.identity != Some(identity) => {
                // Truncated or replaced: the game started a new session.
                poll.restarted = true;
                self.partial.clear();
                0
            }
            Some(offset) => offset,
        };

        self.skip_existing = false;
        self.identity = Some(identity);
        self.offset = Some(offset);

        if len == offset {
            return Ok(poll);
        }

        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(offset))?;

        let mut chunk = Vec::new();
        file.take((len - offset).min(MAX_READ))
            .read_to_end(&mut chunk)?;

        self.offset = Some(offset + chunk.len() as u64);
        self.partial.extend_from_slice(&chunk);

        // Only complete lines: the game may be mid-way through the last one.
        if let Some(end) = self.partial.iter().rposition(|&byte| byte == b'\n') {
            let complete: Vec<u8> = self.partial.drain(..=end).collect();
            poll.lines = String::from_utf8_lossy(&complete)
                .lines()
                .map(|line| line.trim_end_matches('\r').to_string())
                .filter(|line| !line.is_empty())
                .collect();
        }

        Ok(poll)
    }
}

/* ------------------------------------------------------------------ */
/* The running watcher                                                 */
/* ------------------------------------------------------------------ */

/// Where the watcher stands. Mirrors `GameLogStatus` in `src/lib/game-log.ts`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogStatus {
    /// The file followed, or that would be.
    path: String,
    enabled: bool,
    /// Whether the file is there.
    exists: bool,
}

/// The settings a watcher is started with. Another folder is another watcher.
#[derive(Clone, PartialEq, Eq)]
struct Config {
    path: PathBuf,
    enabled: bool,
}

struct Running {
    config: Config,
    cancel: watch::Sender<bool>,
}

#[derive(Default)]
struct WatcherState {
    running: Option<Running>,
    /// Counts the watchers ever started, so one that outlived its cancellation
    /// by a moment does not report on behalf of its successor.
    generation: u64,
}

#[derive(Default)]
pub struct GameLog(Mutex<WatcherState>);

fn lock(app: &AppHandle) -> Result<MutexGuard<'_, WatcherState>, String> {
    let game_log: &GameLog = app.state::<GameLog>().inner();
    game_log.0.lock().map_err(|error| error.to_string())
}

/// The settings as the frontend stored them, defaults for what it has not.
///
/// The store is not open until a webview has loaded it, so this is first
/// called from the main window (`game_log_sync`) rather than from `setup`.
fn read_config(app: &AppHandle) -> Config {
    let store = app.get_store(STORE_FILE);

    let dir = store
        .as_ref()
        .and_then(|store| store.get(KEY_GAME_LOG_DIR))
        .and_then(|value| value.as_str().map(|dir| dir.trim().to_string()))
        .filter(|dir| !dir.is_empty())
        .unwrap_or_else(|| DEFAULT_GAME_DIR.to_string());

    let enabled = store
        .as_ref()
        .and_then(|store| store.get(KEY_GAME_LOG_ENABLED))
        .and_then(|value| value.as_bool())
        .unwrap_or(true);

    Config {
        path: Path::new(&dir).join(LOG_FILE_NAME),
        enabled,
    }
}

/// Makes the running watcher match the settings: starts one, stops one, or
/// replaces one. Idempotent.
pub(crate) fn sync(app: &AppHandle) {
    let config = read_config(app);

    let Ok(mut state) = lock(app) else {
        return;
    };

    if state
        .running
        .as_ref()
        .is_some_and(|running| running.config == config)
    {
        return;
    }

    if let Some(running) = state.running.take() {
        let _ = running.cancel.send(true);
    }

    if !config.enabled {
        log("game log: disabled");
        return;
    }

    state.generation += 1;
    let generation = state.generation;
    let (cancel, cancelled) = watch::channel(false);
    state.running = Some(Running {
        config: config.clone(),
        cancel,
    });
    drop(state);

    log(format!("game log: following {}", config.path.display()));

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run(app, config.path, generation, cancelled).await;
    });
}

async fn run(app: AppHandle, path: PathBuf, generation: u64, mut cancelled: watch::Receiver<bool>) {
    let mut tail = Tail::new(path);
    // A blueprint is received once; the same line read twice — the game
    // repeats some notifications — should not ask twice.
    let mut seen: HashSet<String> = HashSet::new();
    let mut last_error: Option<String> = None;

    loop {
        match tail.poll() {
            Ok(poll) => {
                last_error = None;

                if poll.restarted {
                    seen.clear();
                }

                if lock(&app).is_ok_and(|state| state.generation != generation) {
                    return;
                }

                for line in poll.lines {
                    match parse_line(&line) {
                        Some(LogEvent::BlueprintReceived(blueprint)) => {
                            if !seen.insert(blueprint.name.to_lowercase()) {
                                continue;
                            }
                            log(format!("game log: blueprint received: {}", blueprint.name));
                            if let Err(error) =
                                app.emit_to(MAIN_WINDOW, BLUEPRINT_EVENT, &blueprint)
                            {
                                log(format!("game log: cannot emit blueprint: {error}"));
                            }
                        }
                        None => {}
                    }
                }
            }
            Err(error) => {
                // Logged once per kind of failure, not once a second.
                let message = error.to_string();
                if last_error.as_deref() != Some(message.as_str()) {
                    log(format!("game log: cannot read: {message}"));
                    last_error = Some(message);
                }
            }
        }

        tokio::select! {
            _ = tokio::time::sleep(POLL_INTERVAL) => {}
            _ = cancelled.changed() => return,
        }
    }
}

/// The settings changed, or the main window just loaded them: follow them.
#[tauri::command]
pub fn game_log_sync(app: AppHandle) {
    sync(&app);
}

#[tauri::command]
pub fn game_log_status(app: AppHandle) -> GameLogStatus {
    let config = read_config(&app);

    GameLogStatus {
        path: config.path.display().to_string(),
        enabled: config.enabled,
        // Asked of the disk each time rather than taken from the last poll,
        // which can be a second out of date — or older, for a disabled watcher.
        exists: config.path.is_file(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const LINE: &str = r#"<2026-09-28T12:00:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification "Received Blueprint: FS-9 LMG: " [5] to queue. New queue size: 1, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]"#;

    fn blueprint(name: &str, logged_at: &str) -> Option<LogEvent> {
        Some(LogEvent::BlueprintReceived(BlueprintReceived {
            name: name.to_string(),
            logged_at: logged_at.to_string(),
        }))
    }

    #[test]
    fn parses_a_received_blueprint() {
        assert_eq!(
            parse_line(LINE),
            blueprint("FS-9 LMG", "2026-09-28T12:00:00.000Z")
        );
    }

    #[test]
    fn keeps_colons_and_spaces_inside_the_name() {
        let line = r#"<t> x "Received Blueprint:   Arrowhead Sniper Rifle: Mk II : " y"#;
        assert_eq!(
            parse_line(line),
            blueprint("Arrowhead Sniper Rifle: Mk II", "t")
        );
    }

    #[test]
    fn ignores_other_lines() {
        assert_eq!(
            parse_line("<t> [Notice] <Something> Added notification \"Contract Accepted: X: \""),
            None
        );
        assert_eq!(parse_line("Received Blueprint: no timestamp: \""), None);
        assert_eq!(parse_line("<t> Received Blueprint: : \""), None);
        assert_eq!(parse_line(""), None);
    }

    struct TempFile(PathBuf);

    impl TempFile {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("nexus-game-log-{}-{name}", std::process::id()));
            let _ = std::fs::remove_file(&path);
            Self(path)
        }

        fn append(&self, text: &str) {
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.0)
                .unwrap();
            file.write_all(text.as_bytes()).unwrap();
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn skips_what_was_there_before() {
        let file = TempFile::new("history");
        file.append("old line\n");

        let mut tail = Tail::new(file.0.clone());
        let first = tail.poll().unwrap();
        assert!(first.exists && first.restarted && first.lines.is_empty());

        file.append("new line\n");
        assert_eq!(tail.poll().unwrap().lines, vec!["new line"]);
    }

    #[test]
    fn reads_a_file_that_appears_from_its_start() {
        let file = TempFile::new("appears");
        let mut tail = Tail::new(file.0.clone());
        assert!(!tail.poll().unwrap().exists);

        file.append("first\nsecond\n");
        let poll = tail.poll().unwrap();
        assert!(poll.restarted);
        assert_eq!(poll.lines, vec!["first", "second"]);
    }

    #[test]
    fn waits_for_the_end_of_a_line() {
        let file = TempFile::new("partial");
        let mut tail = Tail::new(file.0.clone());
        tail.poll().unwrap();

        file.append("half a ");
        assert!(tail.poll().unwrap().lines.is_empty());

        file.append("line\r\nnext");
        assert_eq!(tail.poll().unwrap().lines, vec!["half a line"]);

        file.append("\n");
        assert_eq!(tail.poll().unwrap().lines, vec!["next"]);
    }

    #[test]
    fn starts_over_when_the_file_is_truncated() {
        let file = TempFile::new("truncated");
        file.append("a long line from the previous session\n");

        let mut tail = Tail::new(file.0.clone());
        tail.poll().unwrap();

        std::fs::write(&file.0, "fresh\n").unwrap();
        let poll = tail.poll().unwrap();
        assert!(poll.restarted);
        assert_eq!(poll.lines, vec!["fresh"]);
    }
}
