use serde::Serialize;
use std::{
    collections::hash_map::RandomState,
    hash::{BuildHasher, Hasher},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWorkerConfig {
    endpoint: String,
    token: String,
}

#[derive(Default)]
struct WorkerProcess {
    child: Option<Child>,
    config: Option<BrowserWorkerConfig>,
}

/// Lifecycle owner for the desktop browser sidecar. It starts with Svetlana and is killed when
/// the application exits; no separate terminal or manual worker startup is required.
#[derive(Default)]
pub struct BrowserWorkerManager {
    worker: Mutex<WorkerProcess>,
}

impl BrowserWorkerManager {
    pub fn ensure_started(&self, app: &AppHandle) -> Result<BrowserWorkerConfig, String> {
        let mut worker = self.worker.lock().map_err(|_| "Блокировка браузера повреждена".to_string())?;
        if let Some(child) = worker.child.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    if let Some(config) = worker.config.clone() {
                        return Ok(config);
                    }
                }
                _ => {
                    worker.child = None;
                    worker.config = None;
                }
            }
        }

        let (worker_dir, server, node, browsers) = locate_runtime(app)?;
        let token = secure_token();
        let port = free_loopback_port()?;
        let origin = current_app_origin(app);
        let mut command = Command::new(&node);
        command
            .arg(&server)
            .current_dir(&worker_dir)
            .env("SVETLANA_BROWSER_HOST", "127.0.0.1")
            .env("SVETLANA_BROWSER_PORT", port.to_string())
            .env("SVETLANA_BROWSER_TOKEN", &token)
            .env("SVETLANA_BROWSER_ALLOWED_ORIGIN", origin)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if browsers.is_dir() {
            command.env("PLAYWRIGHT_BROWSERS_PATH", &browsers);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = command.spawn().map_err(|e| format!(
            "Не удалось запустить встроенный браузер ({:?}): {}. Проверьте целостность установщика.",
            node.file_name().unwrap_or_default(), e
        ))?;
        let address = format!("127.0.0.1:{port}").parse().map_err(|e| format!("Некорректный локальный адрес браузера: {e}"))?;
        let mut ready = false;
        for _ in 0..80 {
            match child.try_wait() {
                Ok(Some(status)) => {
                    return Err(format!("Встроенный браузер завершился при запуске ({status}). Проверьте комплект runtime в установщике."));
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("Не удалось проверить состояние браузера: {error}"));
                }
                Ok(None) => {}
            }
            if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
                ready = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if !ready {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Встроенный браузер не запустил локальный сервис за 8 секунд. Проверьте комплект runtime в установщике.".into());
        }

        let config = BrowserWorkerConfig {
            endpoint: format!("http://127.0.0.1:{port}"),
            token,
        };
        worker.child = Some(child);
        worker.config = Some(config.clone());
        Ok(config)
    }

    pub fn stop(&self) {
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(mut child) = worker.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            worker.config = None;
        }
    }
}

impl Drop for BrowserWorkerManager {
    fn drop(&mut self) {
        if let Ok(worker) = self.worker.get_mut() {
            if let Some(mut child) = worker.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
pub fn browser_worker_config(
    app: AppHandle,
    state: State<'_, BrowserWorkerManager>,
) -> Result<BrowserWorkerConfig, String> {
    state.ensure_started(&app)
}

fn locate_runtime(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let resource_dir = app.path().resource_dir().ok();
    if let Some(resources) = resource_dir {
        let dir = resources.join("browser-worker");
        let server = dir.join("server.mjs");
        let node = dir.join("node.exe");
        let browsers = dir.join(".browsers");
        if server.is_file() && node.is_file() && browsers.is_dir() {
            return Ok((dir, server, node, browsers));
        }
    }

    // Development fallback. Production packages the Node executable, worker dependencies and
    // Playwright Chromium under the resource directory above.
    let cwd = std::env::current_dir().unwrap_or_default();
    let dir = cwd.join("browser-worker");
    let server = dir.join("server.mjs");
    if server.is_file() {
        let node = PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" });
        let browsers = dir.join(".browsers");
        return Ok((dir, server, node, browsers));
    }
    Err("В установщике отсутствует встроенный Browser Worker. Переустановите актуальную версию Светланы.".into())
}

fn current_app_origin(app: &AppHandle) -> String {
    app.get_webview_window("main")
        .and_then(|window| window.url().ok())
        .map(|url| url.as_str().split('/').take(3).collect::<Vec<_>>().join("/"))
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
        .unwrap_or_else(|| "http://tauri.localhost".to_string())
}

fn free_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Не удалось выбрать локальный порт браузера: {e}"))?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

/// Uses the OS-seeded RandomState (SipHash keys) to create a per-launch 256-bit bearer token.
/// The token never enters agent prompts or persistent browser storage.
fn secure_token() -> String {
    let seed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos().to_le_bytes();
    let mut result = String::with_capacity(64);
    for counter in 0u64..4 {
        let state = RandomState::new();
        let mut hasher = state.build_hasher();
        hasher.write(&seed);
        hasher.write(&counter.to_le_bytes());
        hasher.write(&std::process::id().to_le_bytes());
        result.push_str(&format!("{:016x}", hasher.finish()));
    }
    result
}
