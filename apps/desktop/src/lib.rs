/// Quadrant's desktop shell.
///
/// The HTTP plugin is the reason this app is a desktop app at all: requests
/// are issued from Rust, so the CORS rules that block a browser from calling
/// the provider registry or crawling practice websites simply do not apply.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Quadrant");
}
