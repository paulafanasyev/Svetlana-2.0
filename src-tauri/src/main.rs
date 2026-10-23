// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser_worker;
mod local_stt;
mod secure_ai;

use tauri::Manager;

fn main() {
    let app = tauri::Builder::default()
        .manage(browser_worker::BrowserWorkerManager::default())
        .setup(|app| {
            let manager = app.state::<browser_worker::BrowserWorkerManager>();
            if let Err(error) = manager.ensure_started(app.handle()) {
                // A failed optional runtime must not prevent chat from starting. The in-chat
                // panel surfaces the same actionable error when browser work is requested.
                eprintln!("Встроенный браузер не запущен: {error}");
            }
            Ok(())
        })
        // Только для нативных подтверждений из Rust; из JavaScript диалоги недоступны (нет разрешения в capabilities).
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            secure_ai::secret_set,
            secure_ai::secret_has,
            secure_ai::ai_new_conversation,
            secure_ai::ai_cloud_chat,
            browser_worker::browser_worker_config,
            local_stt::local_stt_status,
            local_stt::local_stt_install,
            local_stt::local_stt_cancel,
            local_stt::local_stt_remove,
            local_stt::local_stt_transcribe
        ])
        .run(tauri::generate_context!());
    // Без паники: короткая запись в журнал (без ключей и данных) и выход с кодом ошибки.
    if let Err(e) = app {
        eprintln!("Светлана не запустилась: {e}");
        std::process::exit(1);
    }
}
