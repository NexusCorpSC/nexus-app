#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // `store` persists the API base URL and the better-auth session token.
        .plugin(tauri_plugin_store::Builder::new().build())
        // `http` performs API calls from Rust, so requests to the Nexus Tools
        // API are not subject to the webview's CORS policy and we can attach
        // the session cookie ourselves.
        .plugin(tauri_plugin_http::init())
        // `opener` sends external links to the user's real browser.
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
