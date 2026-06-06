use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerConfig {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OllamaConfig {
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub auto_stop_on_exit: bool,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub preferred_routing: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub vpn_ip: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UiConfig {
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default)]
    pub start_with_system: bool,
    #[serde(default)]
    pub theme: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoggingConfig {
    #[serde(default)]
    pub level: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdatesConfig {
    #[serde(default)]
    pub check_automatic: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub ollama: OllamaConfig,
    #[serde(default)]
    pub node: NodeConfig,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
    #[serde(default)]
    pub updates: UpdatesConfig,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            url: "http://10.2.0.1:3030".to_string(), // Server default IP typically
            api_key: "pre-shared-secret".to_string(),
        }
    }
}

impl Default for OllamaConfig {
    fn default() -> Self {
        Self {
            auto_start: true,
            auto_stop_on_exit: false,
            model: "llama3.2:latest".to_string(),
            preferred_routing: "server".to_string(),
        }
    }
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            id: "".to_string(), // Empty by default, will be generated on load
            name: "laptop".to_string(),
            vpn_ip: String::new(),
        }
    }
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            start_minimized: false,
            start_with_system: false,
            theme: "dark".to_string(),
        }
    }
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "INFO".to_string(),
        }
    }
}

impl Default for UpdatesConfig {
    fn default() -> Self {
        Self {
            check_automatic: true,
        }
    }
}

pub fn get_config_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("AIMindMeshClient")
            .join("config.toml")
    } else {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("aimindmesh-client")
            .join("config.toml")
    }
}

#[tauri::command]
pub fn get_config() -> Result<AppConfig, String> {
    let path = get_config_path();
    let mut config = if !path.exists() {
        AppConfig::default()
    } else {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read config file: {}", e))?;
            
        toml::from_str(&content)
            .map_err(|e| format!("Failed to parse config: {}", e))?
    };

    // If ID is empty or just missing, generate a fresh UUID
    if config.node.id.is_empty() {
        config.node.id = uuid::Uuid::new_v4().to_string();
        let _ = save_config(config.clone());
    }
    
    // Ensure default name if empty
    if config.node.name.is_empty() {
        config.node.name = "laptop".to_string();
        let _ = save_config(config.clone());
    }

    Ok(config)
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    let content = toml::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
        
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write config file: {}", e))
}

#[tauri::command]
pub fn get_vpn_ip() -> Result<String, String> {
    // Return statically via config as requested: "l'indirizzo IP da controllare comunque dovrà poi essere configurabile"
    // So reading from current config's node.vpn_ip
    let conf = get_config()?;
    Ok(conf.node.vpn_ip)
}
