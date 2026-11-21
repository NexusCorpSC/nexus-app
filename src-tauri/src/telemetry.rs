//! The game's telemetry: a gRPC service Star Citizen opens on 127.0.0.1 when
//! `GameTelemetryEnabled` is set in its `attributes.xml`.
//!
//! The service streams the state of the player — vitals, balance, the vehicle
//! they sit in — about twenty times a second, lists the actions it lets a
//! client trigger, and triggers them. This module holds the stream from Rust,
//! so it lives as long as the app and not as long as a window: it connects
//! when the game opens the service, keeps the latest frame, hands it to the
//! windows a few times a second (`telemetry://frame`) and each game event as
//! it comes (`telemetry://event`), and waits for the next game when this one
//! closes.
//!
//! Only the loopback address is ever dialled, without TLS — the game offers
//! nothing else. Nothing here is sent anywhere: what the frontend does with a
//! frame stays on this computer, except what the player asks Nexus Chat.
//!
//! The schema is in `proto/`, compiled by `build.rs`. It carries no position:
//! the NPS still reads `/showlocation` and `r_displayInfo`.
//!
//! The rest is the switch that turns the service on: an attribute of the
//! game's `attributes.xml`, written only on the player's click, with the game
//! closed (it rewrites that file when it exits) and a copy of the file kept.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tokio::sync::watch;
use tonic::transport::{Channel, Endpoint};

use crate::diagnostics::log;

#[allow(clippy::all, clippy::pedantic)]
pub mod proto {
    tonic::include_proto!("sc.game.telemetry.v1");
}

use proto::game_telemetry_service_client::GameTelemetryServiceClient;

/// The latest state, at most [`EMIT_INTERVAL`] apart.
const FRAME_EVENT: &str = "telemetry://frame";
/// One game event (death, respawn…), as soon as it arrives.
const GAME_EVENT: &str = "telemetry://event";
/// The connection changed.
const STATUS_EVENT: &str = "telemetry://status";

/// The port the game uses unless its log says otherwise.
pub const DEFAULT_PORT: u16 = 2942;

/// The game sends about twenty frames a second; the windows need far fewer.
const EMIT_INTERVAL: Duration = Duration::from_millis(250);
/// The first wait after a failed connection, doubled up to [`MAX_BACKOFF`].
const MIN_BACKOFF: Duration = Duration::from_secs(2);
const MAX_BACKOFF: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const CALL_TIMEOUT: Duration = Duration::from_secs(5);
/// A stream that stays silent this long is dropped and dialled again: the
/// game can leave a stream open across a crash of its own.
const SILENCE_TIMEOUT: Duration = Duration::from_secs(60);
/// The game events kept for a window that opens late.
const MAX_EVENTS: usize = 20;

/// The settings store the frontend owns. Mirrors `src/lib/settings.ts`.
const STORE_FILE: &str = "settings.json";
const KEY_ENABLED: &str = "telemetryEnabled";

const ATTRIBUTE: &str = "GameTelemetryEnabled";
/// Where a build keeps the attributes of the default profile, from its folder
/// (`…\StarCitizen\LIVE`).
const ATTRIBUTES_PATH: [&str; 6] = [
    "user",
    "client",
    "0",
    "Profiles",
    "default",
    "attributes.xml",
];
#[cfg(windows)]
const GAME_EXECUTABLE: &str = "StarCitizen.exe";

/// The port the game said it opened, read from `Game.log`.
static PORT: AtomicU16 = AtomicU16::new(DEFAULT_PORT);

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Connection {
    /// Turned off in the settings.
    #[default]
    Disabled,
    /// Nothing answers on the port: the game is closed, or its service off.
    Waiting,
    /// The stream is open. Frames come only while a character is in the
    /// game, so an open stream can be silent at the menu.
    Connected,
}

/// The latest of each part of a frame, with when it came.
///
/// The parts are kept apart because a frame need not carry them all: the
/// vehicle part goes quiet when the player leaves their seat. The frontend
/// ages each one out on its own (`src/lib/telemetry.ts`).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub actor: Option<Stamped<proto::ActorFrame>>,
    pub vehicle: Option<Stamped<proto::VehicleState>>,
    pub weapons: Option<Stamped<proto::WeaponsFrame>>,
    pub events: Vec<GameEvent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamped<T> {
    /// Milliseconds since the Unix epoch.
    pub received_at: u64,
    pub data: T,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameEvent {
    /// `proto::game_event::GameEventType`, as its number.
    pub kind: i32,
    pub received_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connection: Connection,
    pub port: u16,
    pub snapshot: Snapshot,
}

#[derive(Default)]
struct Inner {
    connection: Connection,
    snapshot: Snapshot,
    /// The open channel, for the calls that are not the stream.
    channel: Option<Channel>,
    /// The actions the game lists, asked once per connection.
    actions: Option<Vec<Action>>,
    running: Option<watch::Sender<bool>>,
    /// Bumped each time the stream is told to start over (port, settings).
    generation: u64,
}

#[derive(Default)]
pub struct Telemetry(Mutex<Inner>);

fn lock(app: &AppHandle) -> MutexGuard<'_, Inner> {
    let telemetry: &Telemetry = app.state::<Telemetry>().inner();
    telemetry
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn set_connection(app: &AppHandle, connection: Connection) {
    let changed = {
        let mut inner = lock(app);
        let changed = inner.connection != connection;
        inner.connection = connection;
        if connection != Connection::Connected {
            inner.channel = None;
            inner.actions = None;
        }
        changed
    };
    if changed {
        log(format!("telemetry: {connection:?}"));
        let _ = app.emit(STATUS_EVENT, connection);
    }
}

/// `Game.log` named the port of the service: dial that one from now on.
pub(crate) fn set_port(app: &AppHandle, port: u16) {
    if PORT.swap(port, Ordering::Relaxed) != port {
        log(format!("telemetry: the game listens on port {port}"));
        // A connection on the old port is wrong; one still waiting will pick
        // the new port up at its next try, sooner if restarted now.
        restart(app);
    }
}

/* ------------------------------------------------------------------ */
/* The stream                                                          */
/* ------------------------------------------------------------------ */

fn enabled(app: &AppHandle) -> bool {
    app.get_store(STORE_FILE)
        .and_then(|store| store.get(KEY_ENABLED))
        .and_then(|value| value.as_bool())
        .unwrap_or(true)
}

/// Makes the running stream match the settings. Idempotent.
pub(crate) fn sync(app: &AppHandle) {
    let enabled = enabled(app);
    let running = lock(app).running.is_some();
    match (enabled, running) {
        (true, false) => restart(app),
        (false, true) => stop(app),
        _ => {}
    }
}

fn stop(app: &AppHandle) {
    if let Some(cancel) = lock(app).running.take() {
        let _ = cancel.send(true);
    }
    set_connection(app, Connection::Disabled);
}

/// Starts the stream over, or starts it, if the settings want one.
fn restart(app: &AppHandle) {
    if !enabled(app) {
        return;
    }
    let (generation, cancelled) = {
        let mut inner = lock(app);
        if let Some(cancel) = inner.running.take() {
            let _ = cancel.send(true);
        }
        inner.generation += 1;
        let (cancel, cancelled) = watch::channel(false);
        inner.running = Some(cancel);
        (inner.generation, cancelled)
    };
    if let Some(port) = port_from_log(&crate::game_log::game_dir(app)) {
        PORT.store(port, Ordering::Relaxed);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run(app, generation, cancelled).await;
    });
}

async fn run(app: AppHandle, generation: u64, mut cancelled: watch::Receiver<bool>) {
    let mut backoff = MIN_BACKOFF;
    loop {
        if *cancelled.borrow() || lock(&app).generation != generation {
            return;
        }
        let port = PORT.load(Ordering::Relaxed);
        match stream_once(&app, port, &mut cancelled).await {
            Ended::Cancelled => return,
            // The game was there: when it comes back, it is soon.
            Ended::Closed => backoff = MIN_BACKOFF,
            Ended::Unreachable => {}
        }
        if lock(&app).generation != generation {
            return;
        }
        set_connection(&app, Connection::Waiting);
        tokio::select! {
            _ = tokio::time::sleep(backoff) => {}
            _ = cancelled.changed() => return,
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

enum Ended {
    Cancelled,
    /// The stream was open, then ended.
    Closed,
    /// Nothing answered.
    Unreachable,
}

fn endpoint(port: u16) -> Endpoint {
    Endpoint::from_shared(format!("http://127.0.0.1:{port}"))
        .expect("a loopback address is a valid URI")
        .connect_timeout(CONNECT_TIMEOUT)
}

async fn stream_once(app: &AppHandle, port: u16, cancelled: &mut watch::Receiver<bool>) -> Ended {
    let channel = match endpoint(port).connect().await {
        Ok(channel) => channel,
        Err(_) => return Ended::Unreachable,
    };
    let mut client = GameTelemetryServiceClient::new(channel.clone());
    let mut stream = match client
        .telemetry_stream(proto::TelemetryStreamRequest {})
        .await
    {
        Ok(response) => response.into_inner(),
        Err(status) => {
            log(format!("telemetry: stream refused: {}", status.message()));
            return Ended::Unreachable;
        }
    };

    lock(app).channel = Some(channel);
    set_connection(app, Connection::Connected);

    let mut last_emit: Option<Instant> = None;
    let mut pending = false;
    loop {
        let next = tokio::select! {
            next = tokio::time::timeout(SILENCE_TIMEOUT, stream.message()) => next,
            _ = cancelled.changed() => return Ended::Cancelled,
            // A frame held back by the throttle goes out even if the game
            // stops sending.
            _ = tokio::time::sleep(EMIT_INTERVAL), if pending => {
                emit_frame(app);
                last_emit = Some(Instant::now());
                pending = false;
                continue;
            }
        };
        match next {
            Ok(Ok(Some(frame))) => {
                for event in record(app, frame) {
                    let _ = app.emit(GAME_EVENT, &event);
                }
                if last_emit.is_none_or(|at| at.elapsed() >= EMIT_INTERVAL) {
                    emit_frame(app);
                    last_emit = Some(Instant::now());
                    pending = false;
                } else {
                    pending = true;
                }
            }
            Ok(Ok(None)) => return Ended::Closed,
            Ok(Err(status)) => {
                log(format!("telemetry: stream ended: {}", status.message()));
                return Ended::Closed;
            }
            Err(_) => {
                log("telemetry: stream silent, dialling again");
                return Ended::Closed;
            }
        }
    }
}

/// Keeps what `frame` carries; returns its game events.
fn record(app: &AppHandle, frame: proto::TelemetryStreamResponse) -> Vec<GameEvent> {
    let received_at = now_ms();
    let mut inner = lock(app);
    let snapshot = &mut inner.snapshot;
    if let Some(actor) = frame.actor {
        snapshot.actor = Some(Stamped {
            received_at,
            data: actor,
        });
    }
    if let Some(state) = frame.vehicle.and_then(|vehicle| vehicle.state) {
        snapshot.vehicle = Some(Stamped {
            received_at,
            data: state,
        });
    }
    if let Some(weapons) = frame.weapons {
        snapshot.weapons = Some(Stamped {
            received_at,
            data: weapons,
        });
    }
    let events: Vec<GameEvent> = frame
        .events
        .map(|events| events.events)
        .unwrap_or_default()
        .into_iter()
        .filter(|event| event.r#type != 0)
        .map(|event| GameEvent {
            kind: event.r#type,
            received_at,
        })
        .collect();
    snapshot.events.extend(events.iter().cloned());
    let overflow = snapshot.events.len().saturating_sub(MAX_EVENTS);
    snapshot.events.drain(..overflow);
    events
}

fn emit_frame(app: &AppHandle) {
    let snapshot = lock(app).snapshot.clone();
    let _ = app.emit(FRAME_EVENT, &snapshot);
}

/// The port named by the last `GameTelemetryService` line of `Game.log`, for
/// a game that was already running when the app started (the log watcher
/// only reads what is written after it starts).
fn port_from_log(game_dir: &Path) -> Option<u16> {
    use std::io::Read;
    // The line comes early in a session; the start of the file is enough.
    const MAX_READ: u64 = 8 * 1024 * 1024;
    let file = std::fs::File::open(game_dir.join("Game.log")).ok()?;
    let mut text = Vec::new();
    file.take(MAX_READ).read_to_end(&mut text).ok()?;
    String::from_utf8_lossy(&text)
        .lines()
        .rev()
        .filter(|line| line.contains("GameTelemetryService"))
        .find_map(|line| match crate::game_log::parse_line(line) {
            Some(crate::game_log::LogEvent::TelemetryService { port }) => Some(port),
            _ => None,
        })
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub name: String,
    pub category: String,
    pub holdable: bool,
    /// Whether it needs a confirmation (see [`is_dangerous`]).
    pub dangerous: bool,
}

/// Actions that cannot be taken back, or that leave the ship or its crew
/// exposed: ejecting, self-destruct, cutting power, thrusters or shields,
/// spooling the quantum drive, the landing gear (fatal on the pad), opening or
/// unlocking every door, G-safe and proximity assist off. Triggered only with
/// the player's confirmation, here and in Nexus Chat. The list is the game's
/// (PTU 5.0, build 13248297); a name it does not hold that looks like one of
/// the worst (eject, self-destruct, emergency…) is asked about too, since the
/// names change between patches.
/// Mirrors `isDangerousAction` in `src/lib/telemetry.ts`.
const DANGEROUS_ACTIONS: [&str; 21] = [
    "v_eject",
    "v_emergency_exit",
    "v_self_destruct",
    "v_power_set_off",
    "v_power_toggle",
    "v_power_set_thrusters_off",
    "v_power_toggle_thrusters",
    "v_power_set_shields_off",
    "v_power_toggle_shields",
    "v_toggle_qdrive_engagement",
    "v_retract_landing_system",
    "v_toggle_landing_system",
    "v_open_all_doors",
    "v_unlock_all_doors",
    "v_unlock_all_ports",
    "v_toggle_all_doors",
    "v_toggle_all_doorlocks",
    "v_toggle_all_portlocks",
    "v_ifcs_gsafe_off",
    "v_ifcs_toggle_gforce_safety",
    "v_ifcs_proximity_assist_off",
];

pub fn is_dangerous(action: &str) -> bool {
    const WORDS: [&str; 6] = [
        "eject",
        "self_destruct",
        "selfdestruct",
        "emergency",
        "suicide",
        "jettison",
    ];
    let action = action.trim().to_ascii_lowercase();
    DANGEROUS_ACTIONS.contains(&action.as_str()) || WORDS.iter().any(|word| action.contains(word))
}

fn client(app: &AppHandle) -> Result<GameTelemetryServiceClient<Channel>, String> {
    lock(app)
        .channel
        .clone()
        .map(GameTelemetryServiceClient::new)
        .ok_or_else(|| "notConnected".to_string())
}

#[tauri::command]
pub async fn telemetry_actions(app: AppHandle) -> Result<Vec<Action>, String> {
    if let Some(actions) = lock(&app).actions.clone() {
        return Ok(actions);
    }
    let mut client = client(&app)?;
    let mut request = tonic::Request::new(proto::ListTriggerableActionsRequest {});
    request.set_timeout(CALL_TIMEOUT);
    let response = client
        .list_triggerable_actions(request)
        .await
        .map_err(|status| status.message().to_string())?
        .into_inner();
    let mut actions: Vec<Action> = response
        .actions
        .into_iter()
        .map(|action| Action {
            dangerous: is_dangerous(&action.action_name),
            name: action.action_name,
            category: action.category,
            holdable: action.holdable,
        })
        .collect();
    actions.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then_with(|| a.name.cmp(&b.name))
    });
    lock(&app).actions = Some(actions.clone());
    Ok(actions)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerResult {
    /// `proto::TriggerGameActionStatus`, as its number.
    pub status: i32,
    pub message: String,
}

/// The longest hold the app asks for.
const MAX_HOLD_MS: u32 = 10_000;

/// Triggers `action` in the game. A dangerous one needs `confirmed`: the
/// frontend sets it only after the player said yes (`src/lib/telemetry.ts`).
#[tauri::command]
pub async fn telemetry_trigger(
    app: AppHandle,
    action: String,
    hold_ms: Option<u32>,
    confirmed: bool,
) -> Result<TriggerResult, String> {
    if is_dangerous(&action) && !confirmed {
        return Err("confirmationRequired".to_string());
    }
    let mut client = client(&app)?;
    let mut request = tonic::Request::new(proto::TriggerGameActionRequest {
        action_name: action.clone(),
        hold_ms: hold_ms.map(|hold| hold.min(MAX_HOLD_MS)),
    });
    request.set_timeout(CALL_TIMEOUT);
    let response = client
        .trigger_game_action(request)
        .await
        .map_err(|status| status.message().to_string())?
        .into_inner();
    log(format!(
        "telemetry: triggered {action}: status {}",
        response.status
    ));
    Ok(TriggerResult {
        status: response.status,
        message: response.message,
    })
}

#[tauri::command]
pub fn telemetry_status(app: AppHandle) -> Status {
    let inner = lock(&app);
    Status {
        connection: inner.connection,
        port: PORT.load(Ordering::Relaxed),
        snapshot: inner.snapshot.clone(),
    }
}

/// The settings changed, or the main window just loaded them.
#[tauri::command]
pub fn telemetry_sync(app: AppHandle) {
    sync(&app);
}

/* ------------------------------------------------------------------ */
/* Turning the service on                                              */
/* ------------------------------------------------------------------ */

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    /// The folder name: `LIVE`, `PTU`, `EPTU`…
    pub name: String,
    pub attributes_path: String,
    /// Whether `GameTelemetryEnabled` is `1` there.
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activation {
    pub game_running: bool,
    pub builds: Vec<Build>,
}

/// The builds next to the one the log is read from that have a profile.
fn builds(game_dir: &Path) -> Vec<(String, PathBuf)> {
    let Some(root) = game_dir.parent() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut builds: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let path = ATTRIBUTES_PATH
                .iter()
                .fold(entry.path(), |path, part| path.join(part));
            path.is_file().then_some((name, path))
        })
        .collect();
    builds.sort_by(|a, b| a.0.cmp(&b.0));
    builds
}

/// The value of `GameTelemetryEnabled` in `xml`, if it is there.
fn attribute_value(xml: &str) -> Option<String> {
    let pattern = regex::Regex::new(&format!(
        r#"<Attr\s+name="{ATTRIBUTE}"\s+value="([^"]*)"\s*/>"#
    ))
    .expect("the attribute pattern compiles");
    pattern
        .captures(xml)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
}

/// `xml` with `GameTelemetryEnabled` set to `1`: the attribute changed where
/// it is, or added before `</Attributes>`. `None` if the file is not shaped
/// like the game's.
pub fn with_telemetry_enabled(xml: &str) -> Option<String> {
    let pattern = regex::Regex::new(&format!(
        r#"(<Attr\s+name="{ATTRIBUTE}"\s+value=")[^"]*("\s*/>)"#
    ))
    .expect("the attribute pattern compiles");
    if pattern.is_match(xml) {
        return Some(pattern.replace(xml, "${1}1${2}").into_owned());
    }
    let end = xml.rfind("</Attributes>")?;
    // The game indents its attributes by one space and ends each with a line
    // break: the new one is written the same way.
    let newline = if xml.contains("\r\n") { "\r\n" } else { "\n" };
    let before = &xml[..end];
    let separator = if before.ends_with('\n') { "" } else { newline };
    Some(format!(
        "{before}{separator} <Attr name=\"{ATTRIBUTE}\" value=\"1\"/>{newline}{}",
        &xml[end..]
    ))
}

/// Whether Star Citizen is running: it rewrites `attributes.xml` when it
/// exits, which would undo a change made meanwhile.
#[cfg(windows)]
fn game_running() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("tasklist")
        .args([
            "/FI",
            &format!("IMAGENAME eq {GAME_EXECUTABLE}"),
            "/NH",
            "/FO",
            "CSV",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .to_ascii_lowercase()
                .contains(&GAME_EXECUTABLE.to_ascii_lowercase())
        })
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn game_running() -> bool {
    false
}

#[tauri::command]
pub fn telemetry_activation(app: AppHandle) -> Activation {
    let game_dir = crate::game_log::game_dir(&app);
    Activation {
        game_running: game_running(),
        builds: builds(&game_dir)
            .into_iter()
            .map(|(name, path)| Build {
                enabled: std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|xml| attribute_value(&xml))
                    .is_some_and(|value| value.trim() == "1"),
                attributes_path: path.display().to_string(),
                name,
            })
            .collect(),
    }
}

/// Sets `GameTelemetryEnabled` in the `attributes.xml` of the build `name`,
/// after a copy of the file next to it. Refused while the game runs.
#[tauri::command]
pub fn telemetry_enable_in_game(app: AppHandle, build: String) -> Result<Activation, String> {
    if game_running() {
        return Err("gameRunning".to_string());
    }
    let game_dir = crate::game_log::game_dir(&app);
    let (_, path) = builds(&game_dir)
        .into_iter()
        .find(|(name, _)| *name == build)
        .ok_or_else(|| "buildNotFound".to_string())?;
    let xml = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    if attribute_value(&xml).is_some_and(|value| value.trim() == "1") {
        return Ok(telemetry_activation(app));
    }
    let updated = with_telemetry_enabled(&xml).ok_or_else(|| "unexpectedFile".to_string())?;
    let backup = path.with_file_name(format!("attributes.xml.nexus-{}.bak", now_ms() / 1000));
    std::fs::copy(&path, &backup).map_err(|error| error.to_string())?;
    std::fs::write(&path, updated).map_err(|error| error.to_string())?;
    log(format!(
        "telemetry: enabled in {} (copy kept as {})",
        path.display(),
        backup.display()
    ));
    Ok(telemetry_activation(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_the_attribute_before_the_end() {
        let xml = "<Attributes Version=\"1\">\r\n <Attr name=\"AutoZoomOnSelectedTarget\" value=\"1\"/>\r\n</Attributes>\r\n";
        assert_eq!(
            with_telemetry_enabled(xml).unwrap(),
            "<Attributes Version=\"1\">\r\n <Attr name=\"AutoZoomOnSelectedTarget\" value=\"1\"/>\r\n <Attr name=\"GameTelemetryEnabled\" value=\"1\"/>\r\n</Attributes>\r\n"
        );
    }

    #[test]
    fn turns_an_existing_attribute_on() {
        let xml =
            "<Attributes>\n <Attr name=\"GameTelemetryEnabled\" value=\"0\"/>\n</Attributes>\n";
        let updated = with_telemetry_enabled(xml).unwrap();
        assert_eq!(
            updated,
            "<Attributes>\n <Attr name=\"GameTelemetryEnabled\" value=\"1\"/>\n</Attributes>\n"
        );
        assert_eq!(attribute_value(&updated).as_deref(), Some("1"));
    }

    #[test]
    fn refuses_a_file_it_does_not_know() {
        assert_eq!(with_telemetry_enabled("<Other/>"), None);
    }

    #[test]
    fn spots_dangerous_actions() {
        assert!(is_dangerous("v_eject"));
        assert!(is_dangerous("v_self_destruct"));
        assert!(is_dangerous("v_emergency_exit_seat"));
        assert!(!is_dangerous("v_starmap"));
        assert!(!is_dangerous("toggle_flashlight"));
        assert!(!is_dangerous("v_deploy_landing_system"));
        assert!(is_dangerous("v_power_set_off"));
        assert!(is_dangerous("v_toggle_qdrive_engagement"));
        assert!(is_dangerous("v_unlock_all_doors"));
        assert!(!is_dangerous("v_lock_all_doors"));
        assert!(!is_dangerous("v_master_mode_set_nav"));
    }

    #[test]
    fn decodes_a_frame() {
        use prost::Message;
        let frame = proto::TelemetryStreamResponse {
            actor: Some(proto::ActorFrame {
                state: Some(proto::ActorState {
                    uec_balance: 125_000,
                    locomotion: proto::ActorLocomotionState::Seated as i32,
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let bytes = frame.encode_to_vec();
        // Field 6 (actor), length-delimited.
        assert_eq!(bytes[0], (6 << 3) | 2);
        let decoded = proto::TelemetryStreamResponse::decode(bytes.as_slice()).unwrap();
        assert_eq!(decoded.actor.unwrap().state.unwrap().uec_balance, 125_000);
    }
}
