-- Playlist folders table
CREATE TABLE IF NOT EXISTS playlist_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES playlist_folders(id) ON DELETE CASCADE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_playlist_folders_owner ON playlist_folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_playlist_folders_parent ON playlist_folders(parent_id);

-- Add folder_id to playlists table
ALTER TABLE playlists ADD COLUMN folder_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL;
ALTER TABLE playlists ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_playlists_folder ON playlists(folder_id);
