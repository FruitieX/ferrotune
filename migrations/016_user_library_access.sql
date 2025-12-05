-- Migration: User management and library access control
--
-- This migration adds:
-- 1. user_library_access table for per-user library (music folder) access
-- 2. playlist_shares table for sharing playlists between users

-- User library access control
-- Each row grants a user access to a specific music folder
CREATE TABLE IF NOT EXISTS user_library_access (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    music_folder_id INTEGER NOT NULL REFERENCES music_folders(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, music_folder_id)
);

CREATE INDEX IF NOT EXISTS idx_user_library_access_user ON user_library_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_library_access_folder ON user_library_access(music_folder_id);

-- Playlist sharing
-- Allows playlist owners to share their playlists with other users
CREATE TABLE IF NOT EXISTS playlist_shares (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    shared_with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_edit BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_shares_playlist ON playlist_shares(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_shares_user ON playlist_shares(shared_with_user_id);

-- Initialize library access for existing users
-- By default, all existing users get access to all existing music folders
INSERT INTO user_library_access (user_id, music_folder_id)
SELECT u.id, mf.id
FROM users u, music_folders mf
WHERE NOT EXISTS (
    SELECT 1 FROM user_library_access ula
    WHERE ula.user_id = u.id AND ula.music_folder_id = mf.id
);
