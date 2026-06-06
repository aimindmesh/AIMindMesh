use tauri::{AppHandle, Emitter};
use serde::Serialize;
use std::process::{Command, Child};
use std::sync::Mutex;
use std::time::Duration;
use reqwest::Client;
use sysinfo::System;

#[derive(Clone, Serialize)]
pub struct OllamaStatusEvent {
    pub running: bool,
    pub model: Option<String>,
    pub ram_usage_mb: Option<u64>,
}

pub struct OllamaState {
    pub process: Option<Child>,
    pub running: bool,
}

#[tauri::command]
pub async fn start_ollama(state: tauri::State<'_, Mutex<OllamaState>>) -> Result<(), String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    
    if st.running {
        return Ok(());
    }

    match Command::new("ollama")
        .arg("serve")
        .env("OLLAMA_HOST", "0.0.0.0:11434")
        .spawn()
    {
        Ok(child) => {
            st.process = Some(child);
            st.running = true;
            Ok(())
        }
        Err(e) => Err(format!("Failed to start Ollama process automatically. Is it in your PATH? Error: {}", e)),
    }
}

pub fn spawn_monitoring_thread(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();

        let mut sys = System::new_all();
        
        loop {
            let running = match client.get("http://localhost:11434/api/tags").send().await {
                Ok(resp) => resp.status().is_success(),
                Err(_) => false,
            };

            let mut ram_usage_mb = None;
            let mut active_model = None;

            if running {
                // Check memory usage of 'ollama' processes
                sys.refresh_all();
                let mut total_memory = 0;
                for process in sys.processes_by_exact_name("ollama".as_ref()) {
                    total_memory += process.memory(); // memory in bytes
                }
                
                for process in sys.processes_by_exact_name("ollama runner".as_ref()) {
                    total_memory += process.memory();
                }

                if total_memory > 0 {
                    ram_usage_mb = Some(total_memory / 1_048_576);
                }

                // Check active models loaded
                if let Ok(resp) = client.get("http://localhost:11434/api/ps").send().await {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        if let Some(models) = json.get("models").and_then(|m| m.as_array()) {
                            if !models.is_empty() {
                                active_model = models[0].get("name").and_then(|n| n.as_str()).map(|s| s.to_string());
                            }
                        }
                    }
                }
            }

            let event = OllamaStatusEvent {
                running,
                model: active_model,
                ram_usage_mb,
            };

            let _ = app.emit("ollama-status-changed", event);

            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}
