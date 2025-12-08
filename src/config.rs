use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Environment variable for data directory (database, cache, etc.)
/// When set, this is used as the base directory for all data storage.
/// This is particularly useful for container deployments.
pub const DATA_DIR_ENV: &str = "FERROTUNE_DATA_DIR";

/// Get the data directory from environment or use platform-specific defaults.
/// Priority: FERROTUNE_DATA_DIR env var > platform-specific defaults
pub fn get_data_dir() -> PathBuf {
    if let Ok(data_dir) = std::env::var(DATA_DIR_ENV) {
        PathBuf::from(data_dir)
    } else {
        // Fall back to platform-specific directory
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ferrotune")
    }
}

/// Get the cache directory. Uses data dir subdirectory if FERROTUNE_DATA_DIR is set,
/// otherwise uses platform-specific cache directory.
pub fn get_cache_dir() -> PathBuf {
    if std::env::var(DATA_DIR_ENV).is_ok() {
        // When data dir is set, put cache inside it
        get_data_dir().join("cache")
    } else {
        // Fall back to platform-specific cache directory
        dirs::cache_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ferrotune")
    }
}

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
    get_data_dir().join("ferrotune.db")
}

fn default_cache_path() -> PathBuf {
    get_cache_dir()
}

fn default_max_cover_size() -> u32 {
    1024
}

fn default_true() -> bool {
    true
}

impl Config {
    /// Load configuration from the default location.
    /// Returns Ok(None) if no config file exists (configless mode).
    pub fn load() -> crate::error::Result<Option<Self>> {
        let config_path = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ferrotune")
            .join("config.toml");

        if !config_path.exists() {
            return Ok(None);
        }

        Self::load_from(&config_path).map(Some)
    }

    /// Load configuration from a specific path.
    pub fn load_from(path: &PathBuf) -> crate::error::Result<Self> {
        if !path.exists() {
            return Err(crate::error::Error::Config(config::ConfigError::Message(
                format!("Config file not found at {}.", path.display()),
            )));
        }

        let settings = config::Config::builder()
            .add_source(config::File::from(path.as_ref()))
            .build()?;

        let mut config: Self = settings.try_deserialize()?;
        config.expand_paths();
        Ok(config)
    }

    /// Create a default configuration for configless operation.
    /// Uses environment variables and platform defaults.
    pub fn default_configless() -> Self {
        let mut config = Self {
            server: ServerConfig {
                host: default_host(),
                port: default_port(),
                name: default_name(),
                admin_user: default_admin_user(),
                admin_password: default_admin_password(),
            },
            database: DatabaseConfig {
                path: default_db_path(),
            },
            music: MusicConfig {
                folders: Vec::new(), // No folders - will be added via admin UI
                readonly_tags: true,
            },
            cache: CacheConfig {
                path: default_cache_path(),
                max_cover_size: default_max_cover_size(),
            },
        };
        config.expand_paths();
        config
    }

    /// Expand tilde (~) in all path fields
    /// Also apply FERROTUNE_DATA_DIR override if set
    fn expand_paths(&mut self) {
        // If FERROTUNE_DATA_DIR is set, it overrides database and cache paths
        if std::env::var(DATA_DIR_ENV).is_ok() {
            self.database.path = get_data_dir().join("ferrotune.db");
            self.cache.path = get_cache_dir();
        } else {
            self.database.path = expand_tilde(&self.database.path);
            self.cache.path = expand_tilde(&self.cache.path);
        }

        for folder in &mut self.music.folders {
            folder.path = expand_tilde(&folder.path);
        }
    }

    pub fn example() -> String {
        let example = Config {
            server: ServerConfig {
                host: "127.0.0.1".to_string(),
                port: 4040,
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
