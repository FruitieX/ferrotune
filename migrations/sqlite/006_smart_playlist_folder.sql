-- Add folder_id to smart_playlists table
ALTER TABLE smart_playlists ADD COLUMN folder_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL;

-- Add index for folder lookups
CREATE INDEX IF NOT EXISTS idx_smart_playlists_folder ON smart_playlists(folder_id);
