#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    fs,
    fs::File,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
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
        .ok_or_else(|| "                                                                                                                                                                                                                ".into())
}

/// Opens a URL in the system default browser
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {e}"))?;
    }
    Ok(())
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
    run_update_from_endpoint(&app, endpoint).await
}

#[tauri::command]
async fn check_update_from_zip(app: tauri::AppHandle, zip_url: String) -> Result<UpdateResult, String> {
    log_updater("check_update_from_zip:start", &format!("zip_url={zip_url}"));
    let prepared = tauri::async_runtime::spawn_blocking(move || prepare_zip_update_bundle(&zip_url))
        .await
        .map_err(|e| format!("解析更新压缩包任务失败: {e}"))??;
    log_updater(
        "check_update_from_zip:prepared",
        &format!(
            "bundle_dir={} latest_json={} msi={}",
            prepared.bundle_dir.display(),
            prepared.latest_json_path.display(),
            prepared.msi_path.display()
        ),
    );

    let (port, stop_flag, server_handle) =
        spawn_local_update_server(prepared.bundle_dir.clone()).map_err(|e| format!("启动本地更新服务失败: {e}"))?;
    log_updater("check_update_from_zip:server", &format!("port={port}"));

    let run_result = async {
        rewrite_manifest_url(&prepared.latest_json_path, &prepared.msi_path, &prepared.bundle_dir, port)?;
        let latest_rel = to_relative_url_path(&prepared.latest_json_path, &prepared.bundle_dir)?;
        let endpoint = format!("http://127.0.0.1:{port}/{latest_rel}");
        log_updater("check_update_from_zip:endpoint", &endpoint);
        run_update_from_endpoint(&app, endpoint).await
    }
    .await;

    stop_flag.store(true, Ordering::Relaxed);
    let _ = server_handle.join();
    let _ = fs::remove_dir_all(&prepared.bundle_dir);

    if let Err(ref e) = run_result {
        log_updater("check_update_from_zip:error", e);
    } else {
        log_updater("check_update_from_zip:success", "updated or latest");
    }

    run_result
}

async fn run_update_from_endpoint(app: &tauri::AppHandle, endpoint: String) -> Result<UpdateResult, String> {
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

struct PreparedZipBundle {
    bundle_dir: PathBuf,
    latest_json_path: PathBuf,
    msi_path: PathBuf,
}

fn prepare_zip_update_bundle(zip_url: &str) -> Result<PreparedZipBundle, String> {
    let response = reqwest::blocking::get(zip_url).map_err(|e| format!("下载更新包失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载更新包失败: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .map_err(|e| format!("读取更新包响应失败: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let bundle_dir = std::env::temp_dir().join(format!("dcc-update-zip-{now}"));
    fs::create_dir_all(&bundle_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    let zip_path = bundle_dir.join("update.zip");
    fs::write(&zip_path, &bytes).map_err(|e| format!("写入更新压缩包失败: {e}"))?;

    let zip_file = File::open(&zip_path).map_err(|e| format!("打开更新压缩包失败: {e}"))?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|e| format!("解析更新压缩包失败: {e}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取压缩包条目失败: {e}"))?;
        let out_path = bundle_dir.join(entry.mangled_name());

        if entry.name().ends_with('/') {
            fs::create_dir_all(&out_path).map_err(|e| format!("创建目录失败: {e}"))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        let mut out_file = File::create(&out_path).map_err(|e| format!("创建文件失败: {e}"))?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| format!("解压文件失败: {e}"))?;
    }

    let latest_json_path = find_first_file_named(&bundle_dir, "latest.json")
        .ok_or_else(|| String::from("压缩包中缺少 latest.json"))?;
    let msi_path = find_first_file_with_ext(&bundle_dir, "msi")
        .ok_or_else(|| String::from("压缩包中缺少 msi 安装包"))?;

    Ok(PreparedZipBundle {
        bundle_dir,
        latest_json_path,
        msi_path,
    })
}

fn find_first_file_named(root: &Path, target_name: &str) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|n| n.to_str()) == Some(target_name) {
                return Some(path);
            }
        }
    }
    None
}

fn find_first_file_with_ext(root: &Path, ext: &str) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case(ext))
                .unwrap_or(false)
            {
                return Some(path);
            }
        }
    }
    None
}

fn to_relative_url_path(path: &Path, root: &Path) -> Result<String, String> {
    let rel = path
        .strip_prefix(root)
        .map_err(|e| format!("计算相对路径失败: {e}"))?;
    let mut encoded_parts = Vec::new();
    for comp in rel.components() {
        let part = comp.as_os_str().to_string_lossy().replace(' ', "%20");
        encoded_parts.push(part);
    }
    Ok(encoded_parts.join("/"))
}

fn rewrite_manifest_url(latest_json_path: &Path, msi_path: &Path, bundle_root: &Path, port: u16) -> Result<(), String> {
    let content = fs::read_to_string(latest_json_path).map_err(|e| format!("读取 latest.json 失败: {e}"))?;
    let mut value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 latest.json 失败: {e}"))?;

    let msi_rel = to_relative_url_path(msi_path, bundle_root)?;
    let msi_url = format!("http://127.0.0.1:{port}/{msi_rel}");

    value["platforms"]["windows-x86_64"]["url"] = serde_json::Value::String(msi_url);

    let updated = serde_json::to_string_pretty(&value).map_err(|e| format!("序列化 latest.json 失败: {e}"))?;
    fs::write(latest_json_path, updated).map_err(|e| format!("写入 latest.json 失败: {e}"))
}

fn decode_percent_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &path[i + 1..i + 3];
            if let Ok(value) = u8::from_str_radix(hex, 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn spawn_local_update_server(root: PathBuf) -> Result<(u16, Arc<AtomicBool>, thread::JoinHandle<()>), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("绑定本地端口失败: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("设置非阻塞失败: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取本地端口失败: {e}"))?
        .port();

    let stop = Arc::new(AtomicBool::new(false));
    let stop_in_thread = Arc::clone(&stop);

    let handle = thread::spawn(move || {
        while !stop_in_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = serve_local_file(&mut stream, &root);
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(30));
                }
                Err(_) => break,
            }
        }
    });

    Ok((port, stop, handle))
}

fn serve_local_file(stream: &mut TcpStream, root: &Path) -> Result<(), String> {
    let mut buffer = [0u8; 4096];
    let read_len = stream.read(&mut buffer).map_err(|e| format!("读取请求失败: {e}"))?;
    if read_len == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buffer[..read_len]);
    let first_line = request.lines().next().unwrap_or_default();
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let raw_path = parts.next().unwrap_or("/");

    if method != "GET" && method != "HEAD" {
        stream
            .write_all(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .map_err(|e| format!("写入响应失败: {e}"))?;
        return Ok(());
    }

    let path_only = raw_path.split('?').next().unwrap_or("/");
    let normalized = if path_only == "/" { "/latest.json" } else { path_only };
    let decoded = decode_percent_path(normalized.trim_start_matches('/'));
    log_updater("local_server:req", &format!("method={method} raw={raw_path} decoded={decoded}"));

    if decoded.contains("..") {
        stream
            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .map_err(|e| format!("写入响应失败: {e}"))?;
        return Ok(());
    }

    let target_path = root.join(decoded.replace('/', &std::path::MAIN_SEPARATOR.to_string()));
    if !target_path.exists() || !target_path.is_file() {
        log_updater(
            "local_server:404",
            &format!("target={} root={}", target_path.display(), root.display()),
        );
        stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .map_err(|e| format!("写入响应失败: {e}"))?;
        return Ok(());
    }

    let body = fs::read(&target_path).map_err(|e| format!("读取文件失败: {e}"))?;
    let content_type = if target_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("json"))
        .unwrap_or(false)
    {
        "application/json"
    } else {
        "application/octet-stream"
    };

    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(header.as_bytes())
        .map_err(|e| format!("写入响应头失败: {e}"))?;
    if method == "GET" {
        stream
            .write_all(&body)
            .map_err(|e| format!("写入响应体失败: {e}"))?;
    }
    Ok(())
}

fn log_updater(stage: &str, message: &str) {
    let log_dir = std::env::temp_dir().join("device-control-center");
    if fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let log_file = log_dir.join("updater.log");
    let line = format!("[{}] {} | {}\n", chrono_now(), stage, message);
    let _ = File::options()
        .create(true)
        .append(true)
        .open(log_file)
        .and_then(|mut f| f.write_all(line.as_bytes()));
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

fn chrono_now() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", now.as_secs())
}

fn main() {
    tauri::Builder::default()
        .manage(BackendProcessState::default())
        .setup(|app| {
            match ensure_backend_started(&app.handle()) {
                Ok(()) => {
                    if let Some(window) = app.get_webview_window("main") {
                        let version = app.package_info().version.to_string();
                        let title = format!("Device Control Center v{version}");
                        let _ = window.set_title(&title);
                    }
                    Ok(())
                }
                Err(message) => {
                    // 写入错误日志，方便远程排查
                    let log_dir = std::env::temp_dir().join("device-control-center");
                    let _ = std::fs::create_dir_all(&log_dir);
                    let log_path = log_dir.join("startup-error.log");
                    let _ = std::fs::write(
                        &log_path,
                        format!(
                            "[{}] 后端启动失败: {}\n资源目录: {:?}\n",
                            chrono_now(),
                            message,
                            app.path().resource_dir()
                        ),
                    );

                    // 弹窗告知用户
                    #[cfg(windows)]
                    {
                        use std::ffi::OsStr;
                        use std::os::windows::ffi::OsStrExt;
                        let text: Vec<u16> = OsStr::new(&format!(
                            "后端服务启动失败:\n\n{}\n\n日志: {}\n\n请检查安装是否完整，或联系技术支持。",
                            message,
                            log_path.display()
                        ))
                        .encode_wide()
                        .chain(std::iter::once(0))
                        .collect();
                        let title: Vec<u16> = OsStr::new("Device Control Center")
                            .encode_wide()
                            .chain(std::iter::once(0))
                            .collect();
                        unsafe {
                            windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                                std::ptr::null_mut(),
                                text.as_ptr(),
                                title.as_ptr(),
                                0x10, // MB_ICONERROR
                            );
                        }
                    }

                    Err(std::io::Error::other(message).into())
                }
            }
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_update_from,
            check_update_from_zip,
            get_downloads_dir,
            open_folder,
            open_url
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = stop_backend_process(app);
            }
        });
}
