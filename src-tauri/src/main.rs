// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod local_stt;
mod secure_ai;

fn main() {
    tauri::Builder::default()
        // Только для нативных подтверждений из Rust; из JavaScript диалоги недоступны (нет разрешения в capabilities).
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            secure_ai::secret_set,
            secure_ai::secret_has,
            secure_ai::ai_cloud_chat,
            local_stt::local_stt_status,
            local_stt::local_stt_install,
            local_stt::local_stt_remove,
            local_stt::local_stt_transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running Svetlana 2.0 desktop");
}
