use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Expand tilde (~) in paths to the user's home directory
fn expand_tilde(path: &Path) -> PathBuf {
    if let Some(path_str) = path.to_str() {
        if let Some(stripped) = path_str.strip_prefix("~/") {
            if let Some(home) = dirs::home_dir() {
                return home.join(stripped);
            }
        } else if path_str == "~" {
            if let Some(home) = dirs::home_dir() {
                return home;
            }
        }
    }
    path.to_path_buf()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub music: MusicConfig,
    pub cache: CacheConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// Port for the Ferrotune Admin API (separate from OpenSubsonic API)
    #[serde(default = "default_admin_port")]
    pub admin_port: u16,
    #[serde(default = "default_name")]
    pub name: String,
    /// Default admin username (created on first run if no users exist)
    #[serde(default = "default_admin_user")]
    pub admin_user: String,
    /// Default admin password (created on first run if no users exist)
    #[serde(default = "default_admin_password")]
    pub admin_password: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_db_path")]
    pub path: PathBuf,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MusicConfig {
    pub folders: Vec<MusicFolder>,
    #[serde(default = "default_true")]
    pub readonly_tags: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MusicFolder {
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CacheConfig {
    #[serde(default = "default_cache_path")]
    pub path: PathBuf,
    #[serde(default = "default_max_cover_size")]
    pub max_cover_size: u32,
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_port() -> u16 {
    4040
}

fn default_admin_port() -> u16 {
    4041
}

fn default_name() -> String {
    "Ferrotune".to_string()
}

fn default_admin_user() -> String {
    "admin".to_string()
}

fn default_admin_password() -> String {
    "admin".to_string()
}

fn default_db_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ferrotune")
        .join("ferrotune.db")
}

fn default_cache_path() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ferrotune")
}

fn default_max_cover_size() -> u32 {
    1024
}

fn default_true() -> bool {
    true
}

impl Config {
    pub fn load() -> crate::error::Result<Self> {
        let config_path = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ferrotune")
            .join("config.toml");

        Self::load_from(&config_path)
    }

    pub fn load_from(path: &PathBuf) -> crate::error::Result<Self> {
        if !path.exists() {
            return Err(crate::error::Error::Config(config::ConfigError::Message(
                format!(
                    "Config file not found at {}. Please create it first.",
                    path.display()
                ),
            )));
        }

        let settings = config::Config::builder()
            .add_source(config::File::from(path.as_ref()))
            .build()?;

        let mut config: Self = settings.try_deserialize()?;
        config.expand_paths();
        Ok(config)
    }

    /// Expand tilde (~) in all path fields
    fn expand_paths(&mut self) {
        self.database.path = expand_tilde(&self.database.path);
        self.cache.path = expand_tilde(&self.cache.path);
        for folder in &mut self.music.folders {
            folder.path = expand_tilde(&folder.path);
        }
    }

    pub fn example() -> String {
        let example = Config {
            server: ServerConfig {
                host: "127.0.0.1".to_string(),
                port: 4040,
                admin_port: 4041,
                name: "Ferrotune".to_string(),
                admin_user: "admin".to_string(),
                admin_password: "changeme".to_string(),
            },
            database: DatabaseConfig {
                path: PathBuf::from("~/.local/share/ferrotune/ferrotune.db"),
            },
            music: MusicConfig {
                folders: vec![
                    MusicFolder {
                        name: "Music".to_string(),
                        path: PathBuf::from("/path/to/music"),
                    },
                    MusicFolder {
                        name: "More Music".to_string(),
                        path: PathBuf::from("/path/to/more/music"),
                    },
                ],
                readonly_tags: true,
            },
            cache: CacheConfig {
                path: PathBuf::from("~/.cache/ferrotune"),
                max_cover_size: 1024,
            },
        };

        toml::to_string_pretty(&example).unwrap()
    }
}
