use std::path::{Path, PathBuf};

/// Environment variable for data directory (database, cache, etc.)
/// When set, this is used as the base directory for all data storage.
/// This is particularly useful for container deployments.
pub const DATA_DIR_ENV: &str = "FERROTUNE_DATA_DIR";

/// Environment variable for the database connection URL.
///
/// Supported schemes:
/// - `sqlite://<path>` or `sqlite:<path>` — SQLite file (relative or absolute path)
/// - `postgres://<user>:<pw>@<host>:<port>/<db>` or `postgresql://...` — Postgres server
///
/// This is the primary way to configure the database for deployments.
pub const DATABASE_URL_ENV: &str = "FERROTUNE_DATABASE_URL";

/// Environment variable for the server bind host.
pub const HOST_ENV: &str = "FERROTUNE_HOST";

/// Environment variable for the server bind port.
pub const PORT_ENV: &str = "FERROTUNE_PORT";

/// Environment variable for the byte-range-addressable transcode cache directory.
/// Useful for configless/container deployments that mount an ephemeral volume.
pub const TRANSCODE_CACHE_PATH_ENV: &str = "FERROTUNE_TRANSCODE_CACHE_PATH";

/// Environment variable for the maximum transcode cache size in MiB.
pub const TRANSCODE_CACHE_MAX_MB_ENV: &str = "FERROTUNE_TRANSCODE_CACHE_MAX_MB";

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

#[derive(Debug, Clone)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub music: MusicConfig,
    pub cache: CacheConfig,
}

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub name: String,
    /// Default admin username (created on first run if no users exist)
    pub admin_user: String,
    /// Default admin password (created on first run if no users exist)
    pub admin_password: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum DatabaseBackend {
    #[default]
    Sqlite,
    Postgres,
}

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub backend: DatabaseBackend,
    pub path: PathBuf,
    pub url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MusicConfig {
    pub folders: Vec<MusicFolder>,
    pub readonly_tags: bool,
}

#[derive(Debug, Clone)]
pub struct MusicFolder {
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct CacheConfig {
    pub path: PathBuf,
    pub max_cover_size: u32,
    pub transcode_path: PathBuf,
    pub max_transcode_size_mb: u64,
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

fn default_transcode_cache_path() -> PathBuf {
    std::env::temp_dir().join("ferrotune").join("transcodes")
}

fn default_max_cover_size() -> u32 {
    1024
}

fn default_max_transcode_size_mb() -> u64 {
    10 * 1024
}

fn redact_database_url(url: &str) -> String {
    if let Some((scheme, rest)) = url.split_once("://") {
        if let Some((_, after_credentials)) = rest.rsplit_once('@') {
            return format!("{}://[REDACTED]@{}", scheme, after_credentials);
        }

        return format!("{}://{}", scheme, rest);
    }

    url.to_string()
}

impl DatabaseConfig {
    pub fn sqlite(path: PathBuf) -> Self {
        Self {
            backend: DatabaseBackend::Sqlite,
            path,
            url: None,
        }
    }

    pub fn postgres(url: impl Into<String>) -> Self {
        Self {
            backend: DatabaseBackend::Postgres,
            path: default_db_path(),
            url: Some(url.into()),
        }
    }

    /// Build a [`DatabaseConfig`] from the `FERROTUNE_DATABASE_URL` env var, if set.
    ///
    /// See [`Self::from_url`] for the accepted URL formats. Returns `Ok(None)`
    /// when the env var is unset or empty.
    pub fn from_env() -> crate::error::Result<Option<Self>> {
        match std::env::var(DATABASE_URL_ENV) {
            Ok(v) if !v.trim().is_empty() => Self::from_url(v.trim()).map(Some),
            _ => Ok(None),
        }
    }

    /// Parse a database URL string into a [`DatabaseConfig`].
    ///
    /// Accepted formats:
    /// - `sqlite://<path>` / `sqlite:<path>` → SQLite at `<path>` (supports `~/`)
    /// - `postgres://…` / `postgresql://…` → Postgres with the given URL
    pub fn from_url(value: &str) -> crate::error::Result<Self> {
        // Postgres: preserve the whole URL as-is (sqlx expects it).
        if value.starts_with("postgres://") || value.starts_with("postgresql://") {
            return Ok(Self::postgres(value));
        }

        // SQLite: accept `sqlite://path` or `sqlite:path`.
        let sqlite_path = value
            .strip_prefix("sqlite://")
            .or_else(|| value.strip_prefix("sqlite:"));
        if let Some(path) = sqlite_path {
            if path.is_empty() {
                return Err(crate::error::Error::Config(format!(
                    "{DATABASE_URL_ENV} sqlite scheme requires a path"
                )));
            }
            return Ok(Self::sqlite(expand_tilde(Path::new(path))));
        }

        Err(crate::error::Error::Config(format!(
            "{DATABASE_URL_ENV} must use scheme sqlite://, postgres:// or postgresql:// (got: {})",
            redact_database_url(value)
        )))
    }

    pub fn validate(&self) -> crate::error::Result<()> {
        match self.backend {
            DatabaseBackend::Sqlite => Ok(()),
            DatabaseBackend::Postgres => match self.url.as_deref() {
                Some(url) if !url.trim().is_empty() => Ok(()),
                _ => Err(crate::error::Error::Config(
                    "database.url is required when database.backend = \"postgres\"".to_string(),
                )),
            },
        }
    }

    pub fn connection_label(&self) -> String {
        match self.backend {
            DatabaseBackend::Sqlite => format!("sqlite:{}", self.path.display()),
            DatabaseBackend::Postgres => self
                .url
                .as_deref()
                .map(redact_database_url)
                .unwrap_or_else(|| "postgresql:<missing-url>".to_string()),
        }
    }
}

impl ServerConfig {
    fn apply_env_overrides(&mut self) -> crate::error::Result<()> {
        if let Some(host) = host_from_env() {
            self.host = host;
        }

        if let Some(port) = port_from_env()? {
            self.port = port;
        }

        Ok(())
    }
}

impl CacheConfig {
    fn apply_env_overrides(&mut self) -> crate::error::Result<()> {
        if let Some(path) = transcode_cache_path_from_env() {
            self.transcode_path = path;
        }

        if let Some(max_size_mb) = transcode_cache_max_size_mb_from_env()? {
            self.max_transcode_size_mb = max_size_mb;
        }

        Ok(())
    }
}

fn transcode_cache_path_from_env() -> Option<PathBuf> {
    std::env::var(TRANSCODE_CACHE_PATH_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn transcode_cache_max_size_mb_from_env() -> crate::error::Result<Option<u64>> {
    let value = match std::env::var(TRANSCODE_CACHE_MAX_MB_ENV) {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return Ok(None),
    };

    value.trim().parse::<u64>().map(Some).map_err(|error| {
        crate::error::Error::Config(format!(
            "{TRANSCODE_CACHE_MAX_MB_ENV} must be an unsigned integer MiB value: {error}"
        ))
    })
}

fn host_from_env() -> Option<String> {
    std::env::var(HOST_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn port_from_env() -> crate::error::Result<Option<u16>> {
    let value = match std::env::var(PORT_ENV) {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return Ok(None),
    };

    value.trim().parse::<u16>().map(Some).map_err(|error| {
        crate::error::Error::Config(format!("{PORT_ENV} must be a TCP port number: {error}"))
    })
}

impl Config {
    /// Build runtime configuration from environment variables and defaults.
    pub fn from_env() -> crate::error::Result<Self> {
        let mut config = Self::defaults();
        if let Some(db) = DatabaseConfig::from_env()? {
            tracing::info!(
                "Using database from {}: {}",
                DATABASE_URL_ENV,
                db.connection_label()
            );
            config.database = db;
        }

        config.server.apply_env_overrides()?;
        config.cache.apply_env_overrides()?;
        config.expand_paths();
        config.database.validate()?;
        Ok(config)
    }

    /// Create a default runtime configuration for embedded callers.
    ///
    /// This is intentionally forgiving so embedded callers can override fields
    /// directly after construction without failing because of unrelated process
    /// environment state. The binary startup path should use [`Self::from_env`].
    pub fn default_configless() -> Self {
        let mut config = Self::defaults();
        if let Ok(Some(database)) = DatabaseConfig::from_env() {
            config.database = database;
        }
        if let Err(error) = config.server.apply_env_overrides() {
            tracing::warn!(error = %error, "Ignoring invalid server environment override");
        }
        if let Err(error) = config.cache.apply_env_overrides() {
            tracing::warn!(error = %error, "Ignoring invalid transcode cache environment override");
        }
        config.expand_paths();
        config
    }

    fn defaults() -> Self {
        Self {
            server: ServerConfig {
                host: default_host(),
                port: default_port(),
                name: default_name(),
                admin_user: default_admin_user(),
                admin_password: default_admin_password(),
            },
            database: DatabaseConfig::sqlite(default_db_path()),
            music: MusicConfig {
                folders: Vec::new(),
                readonly_tags: true,
            },
            cache: CacheConfig {
                path: default_cache_path(),
                max_cover_size: default_max_cover_size(),
                transcode_path: default_transcode_cache_path(),
                max_transcode_size_mb: default_max_transcode_size_mb(),
            },
        }
    }

    /// Expand tilde (~) in all path fields
    /// Also apply FERROTUNE_DATA_DIR override if set
    fn expand_paths(&mut self) {
        self.cache.path = if std::env::var(DATA_DIR_ENV).is_ok() {
            get_cache_dir()
        } else {
            expand_tilde(&self.cache.path)
        };
        self.cache.transcode_path = expand_tilde(&self.cache.transcode_path);

        if self.database.backend == DatabaseBackend::Sqlite {
            let database_url_is_set = std::env::var(DATABASE_URL_ENV)
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false);

            if std::env::var(DATA_DIR_ENV).is_ok() && !database_url_is_set {
                self.database.path = get_data_dir().join("ferrotune.db");
            } else {
                self.database.path = expand_tilde(&self.database.path);
            }
        }

        for folder in &mut self.music.folders {
            folder.path = expand_tilde(&folder.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::{LazyLock, Mutex, MutexGuard};

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    struct EnvGuard {
        _guard: MutexGuard<'static, ()>,
        saved: Vec<(&'static str, Option<OsString>)>,
    }

    impl EnvGuard {
        fn new(vars: &[&'static str]) -> Self {
            let guard = ENV_LOCK.lock().expect("env lock should not be poisoned");
            let saved = vars
                .iter()
                .map(|&var| (var, std::env::var_os(var)))
                .collect::<Vec<_>>();
            for var in vars {
                std::env::remove_var(var);
            }
            Self {
                _guard: guard,
                saved,
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (var, value) in &self.saved {
                match value {
                    Some(value) => std::env::set_var(var, value),
                    None => std::env::remove_var(var),
                }
            }
        }
    }

    fn transcode_cache_env_guard() -> EnvGuard {
        EnvGuard::new(&[
            DATABASE_URL_ENV,
            DATA_DIR_ENV,
            HOST_ENV,
            PORT_ENV,
            TRANSCODE_CACHE_PATH_ENV,
            TRANSCODE_CACHE_MAX_MB_ENV,
        ])
    }

    #[test]
    fn parses_postgres_database_url() {
        let db =
            DatabaseConfig::from_url("postgres://u:p@host:5432/db").expect("postgres url parses");
        assert_eq!(db.backend, DatabaseBackend::Postgres);
        assert_eq!(db.url.as_deref(), Some("postgres://u:p@host:5432/db"));
        db.validate().expect("postgres url is valid");

        let db =
            DatabaseConfig::from_url("postgresql://u:p@host/db").expect("postgresql url parses");
        assert_eq!(db.backend, DatabaseBackend::Postgres);
    }

    #[test]
    fn parses_sqlite_database_url() {
        let db = DatabaseConfig::from_url("sqlite:///var/lib/ferrotune/db.sqlite")
            .expect("sqlite url parses");
        assert_eq!(db.backend, DatabaseBackend::Sqlite);
        assert_eq!(db.path, PathBuf::from("/var/lib/ferrotune/db.sqlite"));

        let db = DatabaseConfig::from_url("sqlite:relative.db").expect("sqlite short form parses");
        assert_eq!(db.backend, DatabaseBackend::Sqlite);
        assert_eq!(db.path, PathBuf::from("relative.db"));
    }

    #[test]
    fn rejects_unknown_database_url_scheme() {
        let err = DatabaseConfig::from_url("mysql://u:p@host/db")
            .expect_err("unknown scheme should fail");
        assert!(
            err.to_string().contains("FERROTUNE_DATABASE_URL"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_empty_sqlite_path() {
        let err = DatabaseConfig::from_url("sqlite:").expect_err("empty sqlite path should fail");
        assert!(
            err.to_string().contains("sqlite scheme requires a path"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn config_from_env_uses_database_url() {
        let _env = transcode_cache_env_guard();
        std::env::set_var(
            DATABASE_URL_ENV,
            "postgres://ferrotune:secret@localhost:5432/ferrotune",
        );

        let config = Config::from_env().expect("env config should load");
        assert_eq!(config.database.backend, DatabaseBackend::Postgres);
        assert_eq!(
            config.database.url.as_deref(),
            Some("postgres://ferrotune:secret@localhost:5432/ferrotune")
        );
        assert_eq!(
            config.database.connection_label(),
            "postgres://[REDACTED]@localhost:5432/ferrotune"
        );
    }

    #[test]
    fn config_from_env_uses_server_host_and_port() {
        let _env = transcode_cache_env_guard();
        std::env::set_var(HOST_ENV, "0.0.0.0");
        std::env::set_var(PORT_ENV, "14040");

        let config = Config::from_env().expect("env config should load");
        assert_eq!(config.server.host, "0.0.0.0");
        assert_eq!(config.server.port, 14040);
    }

    #[test]
    fn configless_uses_transcode_cache_env_overrides() {
        let _env = transcode_cache_env_guard();
        std::env::set_var(
            TRANSCODE_CACHE_PATH_ENV,
            "/tmp/ferrotune-configless-transcodes",
        );
        std::env::set_var(TRANSCODE_CACHE_MAX_MB_ENV, "4096");

        let config = Config::default_configless();
        assert_eq!(
            config.cache.transcode_path,
            PathBuf::from("/tmp/ferrotune-configless-transcodes")
        );
        assert_eq!(config.cache.max_transcode_size_mb, 4096);
    }

    #[test]
    fn rejects_invalid_transcode_cache_max_env_override() {
        let _env = transcode_cache_env_guard();
        std::env::set_var(TRANSCODE_CACHE_MAX_MB_ENV, "not-a-number");

        let err = Config::from_env().expect_err("invalid env override should fail");
        assert!(
            err.to_string().contains(TRANSCODE_CACHE_MAX_MB_ENV),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_invalid_port_env_override() {
        let _env = transcode_cache_env_guard();
        std::env::set_var(PORT_ENV, "not-a-port");

        let err = Config::from_env().expect_err("invalid port env should fail");
        assert!(
            err.to_string().contains(PORT_ENV),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn data_dir_controls_default_sqlite_and_cache_paths() {
        let _env = transcode_cache_env_guard();
        std::env::set_var(DATA_DIR_ENV, "/tmp/ferrotune-data-dir-test");

        let config = Config::from_env().expect("env config should load");
        assert_eq!(
            config.database.path,
            PathBuf::from("/tmp/ferrotune-data-dir-test/ferrotune.db")
        );
        assert_eq!(
            config.cache.path,
            PathBuf::from("/tmp/ferrotune-data-dir-test/cache")
        );
    }
}
