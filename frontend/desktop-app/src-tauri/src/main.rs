#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    fs::File,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Returns the user's Downloads folder path
#[tauri::command]
fn get_downloads_dir() -> Result<String, String> {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "无法获取下载文件夹路径".into())
}

/// Opens a folder in the system file manager
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {e}"))?;
    }
    Ok(())
}

#[derive(Serialize)]
struct UpdateResult {
    status: String,
    message: String,
    version: Option<String>,
}

#[derive(Default)]
struct BackendProcessState(Mutex<Option<Child>>);

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 8080;
const BACKEND_STARTUP_TIMEOUT: Duration = Duration::from_secs(12);
const BACKEND_POLL_INTERVAL: Duration = Duration::from_millis(250);
const BACKEND_REQUEST_TIMEOUT: Duration = Duration::from_millis(500);
const BACKEND_SIDECAR_NAME: &str = "device-control-backend.exe";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
async fn check_update_from(app: tauri::AppHandle, endpoint: String) -> Result<UpdateResult, String> {
    let url: url::Url = endpoint.parse().map_err(|e| format!("无效的更新地址: {e}"))?;

    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| format!("构建更新器失败: {e}"))?
        .build()
        .map_err(|e| format!("构建更新器失败: {e}"))?;

    let update: Option<tauri_plugin_updater::Update> = updater.check().await.map_err(|e| format!("检查更新失败: {e}"))?;

    match update {
        Some(update) => {
            let version = update.version.clone();
            update
                .download_and_install(|_chunk_len: usize, _content_len: Option<u64>| {}, || {})
                .await
                .map_err(|e| format!("下载安装失败: {e}"))?;
            Ok(UpdateResult {
                status: "updated".into(),
                message: format!("版本 {version} 已安装，应用即将重启。"),
                version: Some(version),
            })
        }
        None => Ok(UpdateResult {
            status: "latest".into(),
            message: "当前已经是最新版本。".into(),
            version: None,
        }),
    }
}

fn ensure_backend_started(app: &tauri::AppHandle) -> Result<(), String> {
    if backend_is_healthy() {
        return Ok(());
    }

    let backend_path = resolve_backend_binary(app)?;
    let desktop_rules_path = resolve_desktop_rules_path(app)?;

    let mut command = Command::new(&backend_path);
    command
        .env("SERVER_ADDR", format!(":{BACKEND_PORT}"))
        .env("REQUEST_TIMEOUT_MS", "15000")
        .env("DESKTOP_RULES_PATH", &desktop_rules_path)
        .stdin(Stdio::null())
        .stdout(backend_log_stdio()?)
        .stderr(backend_log_stdio()?);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let child = command.spawn().map_err(|error| {
        format!(
            "启动本地后端失败: {error} (path: {})",
            backend_path.display()
        )
    })?;

    {
        let state = app.state::<BackendProcessState>();
        let mut guard = state
            .0
            .lock()
            .map_err(|_| String::from("无法获取后端进程状态锁"))?;
        *guard = Some(child);
    }

    wait_for_backend_ready(app)
}

fn wait_for_backend_ready(app: &tauri::AppHandle) -> Result<(), String> {
    let deadline = Instant::now() + BACKEND_STARTUP_TIMEOUT;

    while Instant::now() < deadline {
        if backend_is_healthy() {
            return Ok(());
        }

        let exited = {
            let state = app.state::<BackendProcessState>();
            let mut guard = state
                .0
                .lock()
                .map_err(|_| String::from("无法获取后端进程状态锁"))?;
            if let Some(child) = guard.as_mut() {
                child
                    .try_wait()
                    .map_err(|error| format!("检查后端进程状态失败: {error}"))?
            } else {
                None
            }
        };

        if let Some(status) = exited {
            clear_backend_process_state(app)?;
            return Err(format!("本地后端启动后立即退出，退出码: {status}"));
        }

        std::thread::sleep(BACKEND_POLL_INTERVAL);
    }

    stop_backend_process(app)?;
    Err(String::from("等待本地后端就绪超时，请检查 8080 端口是否被占用"))
}

fn clear_backend_process_state(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BackendProcessState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| String::from("无法获取后端进程状态锁"))?;
    *guard = None;
    Ok(())
}

fn stop_backend_process(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BackendProcessState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| String::from("无法获取后端进程状态锁"))?;

    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    Ok(())
}

fn resolve_backend_binary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("解析资源目录失败: {error}"))?;
    let backend_path = resource_dir.join(BACKEND_SIDECAR_NAME);

    if backend_path.exists() {
        Ok(backend_path)
    } else {
        Err(format!("安装包中缺少后端二进制: {}", backend_path.display()))
    }
}

fn resolve_desktop_rules_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("解析资源目录失败: {error}"))?;
    let rules_path = resource_dir.join("config").join("desktop_rules.json");

    if rules_path.exists() {
        Ok(rules_path)
    } else {
        Err(format!("安装包中缺少桌面规则文件: {}", rules_path.display()))
    }
}

fn backend_is_healthy() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], BACKEND_PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, BACKEND_REQUEST_TIMEOUT) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(BACKEND_REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(BACKEND_REQUEST_TIMEOUT));

    if stream
        .write_all(
            format!(
                "GET /healthz HTTP/1.1\r\nHost: {BACKEND_HOST}:{BACKEND_PORT}\r\nConnection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .is_err()
    {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }

    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn backend_log_stdio() -> Result<Stdio, String> {
    if cfg!(debug_assertions) {
        Ok(Stdio::inherit())
    } else {
        let log_dir = std::env::temp_dir().join("device-control-center");
        std::fs::create_dir_all(&log_dir)
            .map_err(|error| format!("创建后端日志目录失败: {error}"))?;
        let log_path = log_dir.join("backend.log");
        let file = File::options()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| format!("打开后端日志文件失败: {error}"))?;
        Ok(Stdio::from(file))
    }
}

fn main() {
    tauri::Builder::default()
        .manage(BackendProcessState::default())
        .setup(|app| {
            ensure_backend_started(&app.handle())
                .map_err(|message| std::io::Error::other(message).into())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![check_update_from, get_downloads_dir, open_folder])
        .build(tauri::generate_context!())
        .expect("failed to build tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = stop_backend_process(app);
            }
        });
}
