pub mod config;
pub mod node_agent;
pub mod ollama_manager;

use std::sync::Mutex;
use tauri::{Manager, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let dashboard_i = tauri::menu::MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
            let tasks_i = tauri::menu::MenuItem::with_id(app, "tasks", "AI Task Manager", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&dashboard_i, &tasks_i, &quit_i])?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .on_menu_event(|app: &tauri::AppHandle, event| match event.id.as_ref() {
                    "quit" => {
                        tauri::async_runtime::block_on(async move {
                            node_agent::unregister_node().await;
                        });
                        app.exit(0);
                    }
                    "dashboard" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().unwrap_or(());
                            window.set_focus().unwrap_or(());
                        }
                    }
                    "tasks" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().unwrap_or(());
                            window.set_focus().unwrap_or(());
                            let _ = window.emit("navigate", "/tasks");
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // 1. Programmatic window creation (Window State Plugin managed via label "main")
            let handle = app.handle().clone();
            let _window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("AIMindMesh Core")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 768.0)
                .resizable(true)
                .decorations(true)
                .center()
                .build()?;

            node_agent::spawn_node_agent(handle.clone());
            ollama_manager::spawn_monitoring_thread(handle);
            Ok(())
        })
        .manage(Mutex::new(ollama_manager::OllamaState {
            process: None,
            running: false,
        }))
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::save_config,
            config::get_vpn_ip,
            ollama_manager::start_ollama
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            if let Some(window) = tauri::Manager::get_webview_window(app_handle, label.as_str()) {
                let _ = window.hide();
                api.prevent_close();
            }
        }
        tauri::RunEvent::ExitRequested { .. } => {
            tauri::async_runtime::block_on(async {
                node_agent::unregister_node().await;
            });
        }
        _ => {}
    });
}
