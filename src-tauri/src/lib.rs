use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
pub struct TerminalSession {
    id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalOutput {
    session_id: String,
    data: String,
}

type Sessions = Arc<Mutex<HashMap<String, Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>>>>;
type Writers = Arc<Mutex<HashMap<String, Arc<Mutex<Box<dyn Write + Send>>>>>>;

#[derive(Default)]
pub struct TerminalState {
    sessions: Sessions,
    writers: Writers,
}

#[tauri::command]
async fn create_terminal_session(
    state: State<'_, TerminalState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();

    let pty_system = portable_pty::native_pty_system();

    let shell = if cfg!(target_os = "windows") {
        "cmd.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };

    let mut cmd = CommandBuilder::new(&shell);

    // Set essential environment variables for proper terminal operation
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Preserve important environment variables from the parent process
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
    if let Ok(user) = std::env::var("USER") {
        cmd.env("USER", user);
    }
    if let Ok(lang) = std::env::var("LANG") {
        cmd.env("LANG", lang);
    } else {
        cmd.env("LANG", "en_US.UTF-8");
    }

    // Set Homebrew environment variables if available
    // Ensure Homebrew paths are available even if not in environment
    let current_path = std::env::var("PATH").unwrap_or_default();
    let homebrew_paths = vec![
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
    ];

    let mut path_components: Vec<&str> = current_path.split(':').collect();
    for homebrew_path in &homebrew_paths {
        if !path_components.contains(homebrew_path) {
            path_components.insert(0, homebrew_path);
        }
    }
    let enhanced_path = path_components.join(":");
    cmd.env("PATH", enhanced_path);

    // Set Homebrew environment variables if not already set
    if std::env::var("HOMEBREW_PREFIX").is_err() {
        // Try Apple Silicon path first, then Intel
        let homebrew_prefix = if std::path::Path::new("/opt/homebrew").exists() {
            "/opt/homebrew"
        } else {
            "/usr/local"
        };
        cmd.env("HOMEBREW_PREFIX", homebrew_prefix);
        cmd.env("HOMEBREW_CELLAR", format!("{}/Cellar", homebrew_prefix));
        cmd.env("HOMEBREW_REPOSITORY", homebrew_prefix);
        cmd.env("INFOPATH", format!("{}/share/info:", homebrew_prefix));
    }

    // Set working directory to user's home directory
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(&home);
    }

    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    let mut child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get writer: {}", e))?;

    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(session_id.clone(), Arc::new(Mutex::new(pty_pair.master)));
    }

    {
        let mut writers = state.writers.lock().unwrap();
        writers.insert(session_id.clone(), Arc::new(Mutex::new(writer)));
    }

    let session_id_clone = session_id.clone();
    let app_handle_clone = app_handle.clone();

    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 8192];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let output = TerminalOutput {
                        session_id: session_id_clone.clone(),
                        data,
                    };

                    if let Err(_) = app_handle_clone.emit("terminal-output", &output) {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let session_id_clone2 = session_id.clone();
    let app_handle_clone2 = app_handle.clone();
    let sessions_clone = state.sessions.clone();
    let writers_clone = state.writers.clone();

    thread::spawn(move || {
        let _ = child.wait();

        {
            let mut sessions = sessions_clone.lock().unwrap();
            sessions.remove(&session_id_clone2);
        }

        {
            let mut writers = writers_clone.lock().unwrap();
            writers.remove(&session_id_clone2);
        }

        let _ = app_handle_clone2.emit("terminal-exit", session_id_clone2);
    });

    Ok(session_id)
}

#[tauri::command]
async fn write_to_terminal(
    state: State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let writers = state.writers.lock().unwrap();

    if let Some(writer) = writers.get(&session_id) {
        let mut writer = writer.lock().unwrap();
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to terminal: {}", e))?;
    } else {
        return Err("Terminal session not found".to_string());
    }

    Ok(())
}

#[tauri::command]
async fn resize_terminal(
    state: State<'_, TerminalState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();

    if let Some(pty) = sessions.get(&session_id) {
        let pty = pty.lock().unwrap();
        pty.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize terminal: {}", e))?;
    } else {
        return Err("Terminal session not found".to_string());
    }

    Ok(())
}

#[tauri::command]
async fn close_terminal_session(
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<(), String> {
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.remove(&session_id);
    }
    {
        let mut writers = state.writers.lock().unwrap();
        writers.remove(&session_id);
    }
    Ok(())
}

#[tauri::command]
async fn list_terminal_sessions(state: State<'_, TerminalState>) -> Result<Vec<String>, String> {
    let sessions = state.sessions.lock().unwrap();
    Ok(sessions.keys().cloned().collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            create_terminal_session,
            write_to_terminal,
            resize_terminal,
            close_terminal_session,
            list_terminal_sessions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
