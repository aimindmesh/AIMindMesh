use tauri::{AppHandle, Emitter};
use serde::Serialize;
use std::time::Duration;
use reqwest::Client;
use crate::config::get_config;

#[derive(Clone, Serialize)]
pub struct NodeStatusEvent {
    pub status: String, // "ONLINE" | "OFFLINE" | "CONNECTING"
}

#[derive(Serialize)]
pub struct RegisterPayload {
    pub id: String,
    pub name: String,
    pub r#type: String,
    #[serde(rename = "ollamaUrl")]
    pub ollama_url: String,
    pub models: Vec<String>,
}

#[derive(Serialize)]
pub struct HeartbeatPayload {
    pub id: String,
}

pub fn spawn_node_agent(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();

        let mut backoff_ms: u64 = 1000;
        let mut registered = false;
        let mut last_registered_model = String::new();
        let mut last_registered_ip = String::new();

        loop {
            // Load latest config every cycle to pick up changes saved via Settings
            let config = match get_config() {
                Ok(c) => c,
                Err(_) => {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };

            // Reactivity: If model or IP changed in config, force re-registration
            if registered && (config.ollama.model != last_registered_model || config.node.vpn_ip != last_registered_ip) {
                registered = false;
                let _ = app.emit("node-status-changed", NodeStatusEvent { status: "CONNECTING".to_string() });
            }

            let server_url = format!("{}/api/nodes", config.server.url.trim_end_matches('/'));

            if !registered {
                let _ = app.emit("node-status-changed", NodeStatusEvent { status: "CONNECTING".to_string() });
                let payload = RegisterPayload {
                    id: config.node.id.clone(),
                    name: config.node.name.clone(),
                    r#type: "pc_client".to_string(),
                    ollama_url: format!("http://{}:11434", config.node.vpn_ip),
                    models: vec![config.ollama.model.clone()],
                };

                let reg_url = format!("{}/register", server_url);
                
                match client.post(&reg_url)
                    .header("x-api-key", config.server.api_key.clone())
                    .json(&payload)
                    .send().await 
                {
                    Ok(resp) if resp.status().is_success() => {
                        registered = true;
                        last_registered_model = config.ollama.model.clone();
                        last_registered_ip = config.node.vpn_ip.clone();
                        backoff_ms = 1000; // reset backoff on success
                        let _ = app.emit("node-status-changed", NodeStatusEvent { status: "ONLINE".to_string() });
                    }
                    Ok(_) | Err(_) => {
                        let _ = app.emit("node-status-changed", NodeStatusEvent { status: "OFFLINE".to_string() });
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                        // Exponential backoff capped at 15s for faster VPN reconnection
                        backoff_ms = std::cmp::min(backoff_ms * 2, 15000);
                        continue;
                    }
                }
            }

            // Send heartbeats every 5 seconds, 6 times = 30s cycle
            for _ in 0..6 {
                tokio::time::sleep(Duration::from_secs(5)).await;
                
                // Re-check config during heartbeat loop
                if let Ok(latest_conf) = get_config() {
                    if latest_conf.ollama.model != last_registered_model || latest_conf.node.vpn_ip != last_registered_ip {
                        registered = false;
                        break;
                    }
                }

                let beat_payload = HeartbeatPayload { id: config.node.id.clone() };
                let beat_url = format!("{}/heartbeat", server_url);
                
                match client.post(&beat_url)
                    .header("x-api-key", config.server.api_key.clone())
                    .json(&beat_payload)
                    .send().await
                {
                    Ok(resp) if resp.status().is_success() => {
                        let _ = app.emit("node-status-changed", NodeStatusEvent { status: "ONLINE".to_string() });
                    }
                    _ => {
                        registered = false;
                        let _ = app.emit("node-status-changed", NodeStatusEvent { status: "OFFLINE".to_string() });
                        break;
                    }
                }
            }
        }
    });
}

pub async fn unregister_node() {
    if let Ok(config) = get_config() {
        let client = Client::builder().timeout(Duration::from_secs(3)).build().unwrap();
        let unreg_url = format!("{}/api/nodes/{}", config.server.url.trim_end_matches('/'), config.node.id);
        
        let _ = client.delete(&unreg_url)
            .header("x-api-key", config.server.api_key.clone())
            .send().await;
    }
}
