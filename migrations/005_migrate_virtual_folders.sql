-- Migration: Add indices to support folder path migration
-- The actual data migration will be done via Rust code after schema migrations

-- Add index on playlist names for efficient path extraction  
CREATE INDEX IF NOT EXISTS idx_playlists_name_path ON playlists(name) WHERE name LIKE '%/%';

-- Add index on smart playlist names for efficient path extraction  
CREATE INDEX IF NOT EXISTS idx_smart_playlists_name_path ON smart_playlists(name) WHERE name LIKE '%/%';

-- Track whether folder migration has been completed
INSERT OR IGNORE INTO server_config (key, value) VALUES ('folder_migration_complete', 'false');
