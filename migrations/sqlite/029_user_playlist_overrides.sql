-- Per-user local overrides for non-owned playlists (folder placement).
-- This allows users to move shared/public playlists into their own folder
-- structure without affecting the owner's view.
CREATE TABLE IF NOT EXISTS user_playlist_overrides (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, playlist_id)
);

CREATE INDEX IF NOT EXISTS idx_user_playlist_overrides_user ON user_playlist_overrides(user_id);
