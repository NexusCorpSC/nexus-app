//! Signing in through the browser, on Nexus Tools itself.
//!
//! The app has no sign-in form of its own: it opens the site's
//! `/desktop/connect` page in the browser and waits on a port of the loopback
//! interface. The site signs the user in if they are not already — whatever way
//! the site offers, Discord and passkeys included — then sends the browser back
//! here with a one-time code, which the webview trades for a session of its own
//! (`src/lib/api/auth.ts`). This is the loopback redirect of RFC 8252, the one
//! that asks nothing of the system: no URL scheme to register, no installer to
//! change.
//!
//! One attempt at a time: a new one, or `cancel_browser_sign_in`, ends the one
//! before it, which answers the webview with an error it ignores.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State, Url, Window};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::diagnostics::log;

/// How long the browser is waited for: time to sign in, even from scratch.
const TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// How much of a request is read: its first line is all that matters.
const MAX_REQUEST_BYTES: usize = 8 * 1024;

/// What the page left in the browser tab says, once the app has what it needs.
const DONE_PAGE: &str = r#"<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Nexus App</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center;
         justify-content: center; background: #06243a; color: #cce7ff;
         font-family: system-ui, sans-serif; }
  main { max-width: 24rem; padding: 2rem; text-align: center; }
  p { color: #9ed0ffcc; }
</style></head>
<body><main>
  <h1>Connexion terminée</h1>
  <p>Vous pouvez fermer cet onglet et retourner dans Nexus App.</p>
</main></body>
</html>"#;

/// The attempt under way, if any: sending on it ends it.
#[derive(Default)]
pub struct BrowserSignIn(Mutex<Option<oneshot::Sender<()>>>);

/// What the site sent back: the code, and the state the app gave it.
#[derive(Serialize)]
pub struct BrowserCallback {
    code: String,
    state: String,
}

/// Opens `url` in the browser, with the port to come back to, and waits for
/// the browser to come back.
#[tauri::command]
pub async fn browser_sign_in(
    app: AppHandle,
    window: Window,
    attempt: State<'_, BrowserSignIn>,
    url: String,
) -> Result<BrowserCallback, String> {
    let mut url = Url::parse(&url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(format!(
            "Adresse de connexion invalide : seules http et https sont acceptées, pas {}.",
            url.scheme()
        ));
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    url.query_pairs_mut().append_pair("port", &port.to_string());

    let (cancel, cancelled) = oneshot::channel();
    if let Some(previous) = attempt.0.lock().map_err(|e| e.to_string())?.replace(cancel) {
        let _ = previous.send(());
    }

    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| e.to_string())?;

    let outcome = tokio::select! {
        answer = tokio::time::timeout(TIMEOUT, wait_for_callback(listener)) => {
            answer.unwrap_or_else(|_| Err("le navigateur n'est pas revenu à temps".into()))
        }
        _ = cancelled => Err("connexion annulée".into()),
    };

    // Back to the window the sign-in started from: the browser has the focus.
    if outcome.is_ok() {
        let shown = if window.label() == crate::MAIN_WINDOW {
            crate::show_main_window(&app)
        } else {
            window.set_focus().map_err(|e| e.to_string())
        };
        if let Err(error) = shown {
            log(format!("cannot bring {} back: {error}", window.label()));
        }
    }

    outcome
}

/// Ends the attempt under way, if any.
#[tauri::command]
pub fn cancel_browser_sign_in(attempt: State<'_, BrowserSignIn>) -> Result<(), String> {
    if let Some(previous) = attempt.0.lock().map_err(|e| e.to_string())?.take() {
        let _ = previous.send(());
    }
    Ok(())
}

/// Answers requests until one is the callback. Anything else — the favicon the
/// browser asks for, a stray probe — gets a 404 and is forgotten.
async fn wait_for_callback(listener: TcpListener) -> Result<BrowserCallback, String> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;

        let Some(target) = read_target(&mut stream).await else {
            continue;
        };

        match parse_callback(&target) {
            Some(callback) => {
                respond(&mut stream, "200 OK", DONE_PAGE).await;
                return Ok(callback);
            }
            None => respond(&mut stream, "404 Not Found", "").await,
        }
    }
}

/// The request target of an HTTP request line: `GET /callback?… HTTP/1.1`.
async fn read_target(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];

    while !buffer.windows(2).any(|pair| pair == b"\r\n") {
        let read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut chunk))
            .await
            .ok()?
            .ok()?;
        if read == 0 || buffer.len() + read > MAX_REQUEST_BYTES {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }

    let text = String::from_utf8_lossy(&buffer);
    let mut parts = text.lines().next()?.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    parts.next().map(str::to_owned)
}

fn parse_callback(target: &str) -> Option<BrowserCallback> {
    let url = Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != "/callback" {
        return None;
    }

    let mut code = None;
    let mut state = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            _ => {}
        }
    }

    Some(BrowserCallback {
        code: code?,
        state: state?,
    })
}

async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_callback() {
        let callback = parse_callback("/callback?code=abc&state=xyz").unwrap();
        assert_eq!(callback.code, "abc");
        assert_eq!(callback.state, "xyz");
    }

    #[test]
    fn ignores_anything_else() {
        assert!(parse_callback("/favicon.ico").is_none());
        assert!(parse_callback("/callback?code=abc").is_none());
    }

    async fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let request = format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn waits_past_other_requests_for_the_callback() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiting = tokio::spawn(wait_for_callback(listener));

        assert!(get(port, "/favicon.ico").await.starts_with("HTTP/1.1 404"));
        let done = get(port, "/callback?code=c%2Bd&state=s").await;
        assert!(done.starts_with("HTTP/1.1 200"));
        assert!(done.contains("Connexion terminée"));

        let callback = waiting.await.unwrap().unwrap();
        assert_eq!(callback.code, "c+d");
        assert_eq!(callback.state, "s");
    }
}
