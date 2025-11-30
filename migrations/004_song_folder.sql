-- Add music_folder_id to songs table to track which folder each song belongs to
-- This fixes the full rescan bug where songs from other folders would be incorrectly deleted

ALTER TABLE songs ADD COLUMN music_folder_id INTEGER REFERENCES music_folders(id) ON DELETE CASCADE;

-- Create index for efficient folder-based queries
CREATE INDEX IF NOT EXISTS idx_songs_music_folder ON songs(music_folder_id);

-- Backfill existing songs by matching their file_path against music folder paths
-- Songs will be associated with the first folder whose path is a prefix of the absolute path
-- Note: This requires the app to run the backfill logic since SQLite can't easily do path matching
