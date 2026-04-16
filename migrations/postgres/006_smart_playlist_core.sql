CREATE TABLE smart_playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    comment TEXT,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    rules_json TEXT NOT NULL,
    sort_field TEXT,
    sort_direction TEXT DEFAULT 'desc',
    max_songs BIGINT,
    folder_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_played_at TIMESTAMPTZ
);

CREATE INDEX idx_smart_playlists_owner ON smart_playlists(owner_id);
CREATE INDEX idx_smart_playlists_folder ON smart_playlists(folder_id);
CREATE INDEX idx_smart_playlists_last_played ON smart_playlists(last_played_at);
CREATE INDEX idx_smart_playlists_name_path ON smart_playlists(name) WHERE name LIKE '%/%';