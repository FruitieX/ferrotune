-- Store server configuration in database
-- This allows starting ferrotune without a config file
-- Settings are stored as JSON key-value pairs for flexibility

CREATE TABLE IF NOT EXISTS server_config (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default values
INSERT OR IGNORE INTO server_config (key, value) VALUES
    ('server.name', '"Ferrotune"'),
    ('server.host', '"127.0.0.1"'),
    ('server.port', '4040'),
    ('server.admin_user', '"admin"'),
    ('server.admin_password', '"admin"'),
    ('cache.max_cover_size', '1024'),
    ('music.readonly_tags', 'true'),
    ('configured', 'false');
