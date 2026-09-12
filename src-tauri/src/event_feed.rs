//! The event stream of Nexus Tools, held here for every window.
//!
//! The server pushes what changes — the squad, the note, and whatever comes
//! next — over one Server-Sent Events connection per client. It is held from
//! Rust rather than from a webview for the reason the squad overlay used to
//! poll from *its* webview and nowhere else: a window knows nothing of the
//! others, and seven of them each holding a stream would be seven sessions
//! checked for one user. Here there is one, opened as soon as a session
//! exists — whatever window is up, since a notification has to arrive while
//! the app sits in the tray — and each event is handed to the window that
//! draws it.
//!
//! The protocol is the server's (`types/events.ts` in nexus-tools): every topic
//! sends a snapshot when the stream opens, then an event per change, a `: ping`
//! every twenty seconds, and `bye` shortly before the platform's time limit,
//! after which this side reconnects at once. Events this side does not know
//! are ignored, so a topic can be added server-side before a window listens to
//! it.

use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::header::{ACCEPT, COOKIE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use tauri_plugin_store::StoreExt;
use tokio::sync::watch;

use crate::diagnostics::log;
use crate::SQUAD_WINDOW;

/// Carries a `SquadView` to the squad overlay, tagged with the squad it was
/// asked for.
pub(crate) const SQUAD_VIEW_EVENT: &str = "squad://view";

/// Carries the note, to every window: the main one and the overlay both edit it.
pub(crate) const NOTE_CHANGED_EVENT: &str = "note://changed";

/// Tells every window where the stream stands, carrying a [`FeedStatus`].
pub(crate) const FEED_STATUS_EVENT: &str = "feed://status";

/// Emitted by the webviews on sign-in and sign-out: the store has a new session.
const SESSION_CHANGED_EVENT: &str = "auth://session-changed";

/// The settings store the frontend owns, and the two keys read from it.
/// Mirrors `src/lib/settings.ts`.
const STORE_FILE: &str = "settings.json";
const KEY_API_BASE_URL: &str = "apiBaseUrl";
const KEY_SESSION_COOKIE: &str = "sessionCookie";

const DEFAULT_BASE_URL: &str = "https://tools.services.nexus";

/// The hosts the `http` capability allows the webviews to call. A third copy
/// (`src/lib/settings.ts`, `capabilities/default.json`), because a request
/// made from here answers to no capability: the same rule has to hold by hand.
const ALLOWED_BASE_URLS: [&str; 3] = [
    "https://tools.services.nexus",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
];

const EVENTS_PATH: &str = "/api/events";
const SQUADS_PATH: &str = "/api/squads";

/// What is asked of the stream. Every topic the app draws, whatever is on
/// screen: the connection is one per client, not one per window.
const TOPICS: &str = "squad,note";

const BACKOFF_MIN: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
/// A connection that held this long resets the backoff: the trouble is over.
const STABLE_AFTER: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Against a server without `/api/events`, how often the squad is read instead.
const POLL_FALLBACK: Duration = Duration::from_secs(10);
/// How long that lasts before the stream is tried again.
const REPROBE_AFTER: Duration = Duration::from_secs(5 * 60);

/// Where the stream stands. Mirrors `FeedStatus` in `src/types/nexus.ts`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeedStatus {
    /// No session: nothing to connect with.
    #[default]
    Idle,
    Connecting,
    Connected,
    /// Lost, and about to be tried again.
    Reconnecting,
    /// The server has no stream to offer; the squad is read every few seconds.
    Polling,
    /// The session was refused; stopped until it changes.
    Unauthorized,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedStatusEvent {
    status: FeedStatus,
}

/// What the squad overlay receives, and what [`feed_snapshot`] answers for it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadFeedView {
    /// The squad the stream was asked for — `None` for the API's pick — so a
    /// late delivery lands under the key it belongs to and no other.
    squad: Option<String>,
    id: String,
    view: Value,
}

/// What a stream is opened for. A change to any of it — another account,
/// another server, another squad — is another stream.
#[derive(Clone, PartialEq, Eq)]
struct Target {
    base_url: String,
    cookie: String,
    squad: Option<String>,
}

struct Running {
    target: Target,
    generation: u64,
    cancel: watch::Sender<bool>,
}

#[derive(Default)]
struct FeedState {
    /// The squad the overlay looks at, `None` for the API's pick.
    squad: Option<String>,
    /// Whether the squad overlay is on screen. Only the polling fallback
    /// cares: a stream costs the same whatever is visible, a poll does not.
    squad_visible: bool,
    status: FeedStatus,
    last_squad: Option<SquadFeedView>,
    last_note: Option<Value>,
    running: Option<Running>,
    /// Counts the streams ever started, so a task that outlived its
    /// cancellation by a moment can tell it is no longer the one.
    generation: u64,
}

#[derive(Default)]
pub struct EventFeed(Mutex<FeedState>);

/// The state, borrowed from the app rather than from the `State` handle, so
/// the guard outlives the handle it was taken through.
fn lock(app: &AppHandle) -> Result<MutexGuard<'_, FeedState>, String> {
    let feed: &EventFeed = app.state::<EventFeed>().inner();
    feed.0.lock().map_err(|error| error.to_string())
}

/* ------------------------------------------------------------------ */
/* Starting and stopping                                               */
/* ------------------------------------------------------------------ */

/// Wires the stream to the session. Called once, from `setup`.
///
/// The store is the frontend's: it is read here, never written, and it is not
/// even open until a webview has loaded it. So the stream starts when a window
/// says the session is settled (`feed_sync`, from the auth context of every
/// window) and again on every sign-in or sign-out (`auth://session-changed`,
/// which the webviews emit for each other and which reaches here too).
pub(crate) fn install(app: &AppHandle) {
    let handle = app.clone();
    app.listen_any(SESSION_CHANGED_EVENT, move |_| sync(&handle));
}

/// Told by `announce_squad_visibility`, which is where showing and hiding happen.
pub(crate) fn set_squad_visible(app: &AppHandle, visible: bool) {
    if let Ok(mut state) = lock(app) {
        state.squad_visible = visible;
    }
}

fn normalize_base_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

/// The server and the session, as the frontend stored them.
///
/// `None` for the cookie is «no session»: signed out, or the store not yet
/// opened by any window — which comes to the same thing, since a window opens
/// it before it can sign anyone in. The base URL is checked against the same
/// list the capability enforces on the webviews, and falls back to the default
/// rather than trusting a hand-edited file.
fn read_target(app: &AppHandle) -> (String, Option<String>) {
    let Some(store) = app.get_store(STORE_FILE) else {
        return (DEFAULT_BASE_URL.to_string(), None);
    };

    let base_url = store
        .get(KEY_API_BASE_URL)
        .and_then(|value| value.as_str().map(normalize_base_url))
        .filter(|url| ALLOWED_BASE_URLS.contains(&url.as_str()))
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

    let cookie = store
        .get(KEY_SESSION_COOKIE)
        .and_then(|value| value.as_str().map(str::to_string))
        .filter(|cookie| !cookie.is_empty());

    (base_url, cookie)
}

/// Makes the running stream match the session and the squad on record:
/// starts one, stops one, or replaces one. Idempotent, so every window may
/// ask without a second thought.
pub(crate) fn sync(app: &AppHandle) {
    let (base_url, cookie) = read_target(app);

    let Ok(mut state) = lock(app) else {
        return;
    };

    let wanted = cookie.map(|cookie| Target {
        base_url,
        cookie,
        squad: state.squad.clone(),
    });

    if state.running.as_ref().map(|running| &running.target) == wanted.as_ref() {
        return;
    }

    if let Some(running) = state.running.take() {
        let _ = running.cancel.send(true);
    }

    match wanted {
        None => {
            state.status = FeedStatus::Idle;
            state.last_squad = None;
            state.last_note = None;
            drop(state);
            announce_status(app, FeedStatus::Idle);
            log("event feed: stopped (no session)");
        }
        Some(target) => {
            state.generation += 1;
            let generation = state.generation;
            let (cancel, cancelled) = watch::channel(false);
            state.running = Some(Running {
                target: target.clone(),
                generation,
                cancel,
            });
            drop(state);

            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                run(app, target, generation, cancelled).await;
            });
        }
    }
}

/// Whether the stream that reports is still the one on record.
fn is_current(app: &AppHandle, generation: u64) -> bool {
    lock(app)
        .map(|state| owns(&state, generation))
        .unwrap_or(false)
}

fn announce_status(app: &AppHandle, status: FeedStatus) {
    let _ = app.emit(FEED_STATUS_EVENT, FeedStatusEvent { status });
}

fn set_status(app: &AppHandle, generation: u64, status: FeedStatus) {
    let Ok(mut state) = lock(app) else {
        return;
    };
    if !owns(&state, generation) || state.status == status {
        return;
    }
    state.status = status;
    drop(state);
    announce_status(app, status);
}

/* ------------------------------------------------------------------ */
/* Delivering                                                          */
/* ------------------------------------------------------------------ */

/// Whether the stream numbered `generation` is the one on record. A task
/// that outlived its cancellation by a moment must not speak for the next.
fn owns(state: &FeedState, generation: u64) -> bool {
    state
        .running
        .as_ref()
        .is_some_and(|running| running.generation == generation)
}

fn deliver_squad(app: &AppHandle, generation: u64, squad: Option<String>, id: String, view: Value) {
    let payload = SquadFeedView { squad, id, view };

    {
        let Ok(mut state) = lock(app) else {
            return;
        };
        if !owns(&state, generation) {
            return;
        }
        state.last_squad = Some(payload.clone());
    }

    let _ = app.emit_to(SQUAD_WINDOW, SQUAD_VIEW_EVENT, payload);
}

fn deliver_note(app: &AppHandle, generation: u64, note: Value) {
    {
        let Ok(mut state) = lock(app) else {
            return;
        };
        if !owns(&state, generation) {
            return;
        }
        state.last_note = Some(note.clone());
    }

    let _ = app.emit(NOTE_CHANGED_EVENT, note);
}

/* ------------------------------------------------------------------ */
/* The stream                                                          */
/* ------------------------------------------------------------------ */

/// How one attempt ended, and what the loop does next.
enum Outcome {
    /// Told to stop: the task ends.
    Cancelled,
    /// The server closed on purpose: reconnect at once.
    Bye,
    /// Lost, refused or broken: reconnect after the backoff.
    Ended(String),
    /// The session is no good: stop until it changes.
    Unauthorized,
    /// No such route: the server predates the stream.
    NotFound,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .expect("an HTTP client with default settings")
    })
}

fn url_for(target: &Target, path: &str, topics: bool) -> String {
    let mut url = format!("{}{}", target.base_url, path);
    let mut params: Vec<String> = Vec::new();
    if topics {
        params.push(format!("topics={TOPICS}"));
    }
    if let Some(squad) = &target.squad {
        params.push(format!("squad={}", urlencode(squad)));
    }
    if !params.is_empty() {
        url.push('?');
        url.push_str(&params.join("&"));
    }
    url
}

/// Enough for an id: everything outside the unreserved set is escaped.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// ±20 %, so clients that lost the server together do not come back together.
fn jitter(duration: Duration) -> Duration {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.subsec_nanos())
        .unwrap_or(0);
    let factor = 0.8 + 0.4 * f64::from(nanos % 1_000) / 1_000.0;
    duration.mul_f64(factor)
}

async fn run(
    app: AppHandle,
    target: Target,
    generation: u64,
    mut cancelled: watch::Receiver<bool>,
) {
    let mut backoff = BACKOFF_MIN;

    // Said once: a retry stays «reconnecting» until it is through, rather
    // than flickering through «connecting» on every attempt.
    set_status(&app, generation, FeedStatus::Connecting);

    loop {
        if *cancelled.borrow() || !is_current(&app, generation) {
            return;
        }

        let started = Instant::now();

        match stream_once(&app, &target, generation, &mut cancelled).await {
            Outcome::Cancelled => return,
            Outcome::Unauthorized => {
                log("event feed: session refused, stopping until it changes");
                set_status(&app, generation, FeedStatus::Unauthorized);
                return;
            }
            Outcome::NotFound => {
                log(format!(
                    "event feed: no {EVENTS_PATH} on this server, reading the squad every {} s instead",
                    POLL_FALLBACK.as_secs()
                ));
                if let Outcome::Cancelled =
                    poll_squad(&app, &target, generation, &mut cancelled).await
                {
                    return;
                }
                backoff = BACKOFF_MIN;
            }
            Outcome::Bye => {
                backoff = BACKOFF_MIN;
            }
            Outcome::Ended(reason) => {
                if started.elapsed() >= STABLE_AFTER {
                    backoff = BACKOFF_MIN;
                }

                let wait = jitter(backoff);
                log(format!(
                    "event feed: {reason}; reconnecting in {:.1} s",
                    wait.as_secs_f64()
                ));
                set_status(&app, generation, FeedStatus::Reconnecting);

                tokio::select! {
                    _ = cancelled.changed() => return,
                    _ = tokio::time::sleep(wait) => {}
                }

                backoff = (backoff * 2).min(BACKOFF_MAX);
            }
        }
    }
}

/// One connection, read until it ends.
async fn stream_once(
    app: &AppHandle,
    target: &Target,
    generation: u64,
    cancelled: &mut watch::Receiver<bool>,
) -> Outcome {
    let request = client()
        .get(url_for(target, EVENTS_PATH, true))
        .header(COOKIE, &target.cookie)
        .header(ACCEPT, "text/event-stream");

    let response = tokio::select! {
        _ = cancelled.changed() => return Outcome::Cancelled,
        response = request.send() => response,
    };

    let mut response = match response {
        Ok(response) => response,
        Err(error) => return Outcome::Ended(format!("cannot connect ({error})")),
    };

    match response.status().as_u16() {
        200 => {}
        401 => return Outcome::Unauthorized,
        404 => return Outcome::NotFound,
        status => return Outcome::Ended(format!("HTTP {status}")),
    }

    set_status(app, generation, FeedStatus::Connected);
    log("event feed: connected");

    let mut parser = SseParser::default();
    let mut buffer: VecDeque<u8> = VecDeque::new();

    loop {
        let chunk = tokio::select! {
            _ = cancelled.changed() => return Outcome::Cancelled,
            chunk = response.chunk() => chunk,
        };

        let bytes = match chunk {
            Ok(Some(bytes)) => bytes,
            Ok(None) => return Outcome::Ended("stream closed".to_string()),
            Err(error) => return Outcome::Ended(format!("stream broke ({error})")),
        };

        buffer.extend(bytes.iter().copied());

        while let Some(line) = take_line(&mut buffer) {
            let Some(event) = parser.feed(&line) else {
                continue;
            };

            match event.name.as_str() {
                "squad.view" => match serde_json::from_str::<Value>(&event.data) {
                    Ok(view) => deliver_squad(
                        app,
                        generation,
                        target.squad.clone(),
                        event.id.unwrap_or_default(),
                        view,
                    ),
                    Err(error) => log(format!("event feed: unreadable squad view ({error})")),
                },
                "note" => match serde_json::from_str::<Value>(&event.data) {
                    Ok(note) => deliver_note(app, generation, note),
                    Err(error) => log(format!("event feed: unreadable note ({error})")),
                },
                "bye" => return Outcome::Bye,
                // A topic this build does not draw yet.
                _ => {}
            }
        }
    }
}

/// The fallback against a server that has no stream: the squad, read the way
/// the overlay used to read it — but only while the overlay is up, and six
/// times less often. Gives the stream another try after a while.
async fn poll_squad(
    app: &AppHandle,
    target: &Target,
    generation: u64,
    cancelled: &mut watch::Receiver<bool>,
) -> Outcome {
    set_status(app, generation, FeedStatus::Polling);
    let until = Instant::now() + REPROBE_AFTER;

    loop {
        let visible = lock(app).map(|state| state.squad_visible).unwrap_or(false);

        if visible {
            let request = client()
                .get(url_for(target, SQUADS_PATH, false))
                .header(COOKIE, &target.cookie)
                .header(ACCEPT, "application/json")
                .timeout(POLL_FALLBACK);

            let response = tokio::select! {
                _ = cancelled.changed() => return Outcome::Cancelled,
                response = request.send() => response,
            };

            match response {
                Ok(response) if response.status().as_u16() == 401 => return Outcome::Unauthorized,
                Ok(response) if response.status().is_success() => match response
                    .json::<Value>()
                    .await
                {
                    Ok(view) => {
                        deliver_squad(app, generation, target.squad.clone(), String::new(), view)
                    }
                    Err(error) => log(format!("event feed: unreadable squad ({error})")),
                },
                Ok(response) => log(format!(
                    "event feed: squad read failed (HTTP {})",
                    response.status()
                )),
                Err(error) => log(format!("event feed: squad read failed ({error})")),
            }
        }

        tokio::select! {
            _ = cancelled.changed() => return Outcome::Cancelled,
            _ = tokio::time::sleep(POLL_FALLBACK) => {}
        }

        if Instant::now() >= until {
            return Outcome::Bye;
        }
    }
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/// One line, without its terminator, once the buffer holds a whole one.
fn take_line(buffer: &mut VecDeque<u8>) -> Option<String> {
    let end = buffer.iter().position(|&byte| byte == b'\n')?;
    let mut line: Vec<u8> = buffer.drain(..=end).collect();
    line.pop();
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    Some(String::from_utf8_lossy(&line).into_owned())
}

struct SseEvent {
    name: String,
    data: String,
    id: Option<String>,
}

/// As much of `text/event-stream` as the server uses: `event`, `data`, `id`,
/// comments, and a blank line to dispatch. `retry` is the browser's business.
#[derive(Default)]
struct SseParser {
    event: String,
    data: String,
    id: Option<String>,
}

impl SseParser {
    fn feed(&mut self, line: &str) -> Option<SseEvent> {
        if line.is_empty() {
            if self.data.is_empty() {
                self.event.clear();
                self.id = None;
                return None;
            }

            let event = SseEvent {
                name: if self.event.is_empty() {
                    "message".to_string()
                } else {
                    std::mem::take(&mut self.event)
                },
                data: std::mem::take(&mut self.data),
                id: self.id.take(),
            };
            return Some(event);
        }

        if line.starts_with(':') {
            return None;
        }

        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };

        match field {
            "event" => self.event = value.to_string(),
            "data" => {
                if !self.data.is_empty() {
                    self.data.push('\n');
                }
                self.data.push_str(value);
            }
            "id" => self.id = Some(value.to_string()),
            _ => {}
        }

        None
    }
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/// The session was checked by a window: start, stop or keep the stream
/// accordingly. Every window says so once its auth context has settled.
#[tauri::command]
pub fn feed_sync(app: AppHandle) {
    sync(&app);
}

/// Which squad the overlay looks at. Another squad is another stream.
#[tauri::command]
pub fn feed_set_squad(app: AppHandle, squad: Option<String>) -> Result<(), String> {
    {
        let mut state = lock(&app)?;
        if state.squad == squad {
            return Ok(());
        }
        state.squad = squad;
    }
    sync(&app);
    Ok(())
}

/// The last thing received for a topic, so a window that mounts — or re-reads
/// — after the stream did its work has it at once. For `squad`, only if it was
/// received for the squad asked about.
#[tauri::command]
pub fn feed_snapshot(
    feed: State<'_, EventFeed>,
    topic: String,
    squad: Option<String>,
) -> Result<Option<Value>, String> {
    let state = feed.0.lock().map_err(|error| error.to_string())?;

    Ok(match topic.as_str() {
        "squad" => state
            .last_squad
            .as_ref()
            .filter(|last| last.squad == squad)
            .and_then(|last| serde_json::to_value(last).ok()),
        "note" => state.last_note.clone(),
        _ => None,
    })
}

#[tauri::command]
pub fn feed_status(feed: State<'_, EventFeed>) -> Result<FeedStatus, String> {
    feed.0
        .lock()
        .map(|state| state.status)
        .map_err(|error| error.to_string())
}
