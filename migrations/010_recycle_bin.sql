-- Soft delete / Recycle bin support for songs
-- Songs marked for deletion are hidden from normal queries but not immediately deleted

-- Add column to track when a song was marked for deletion
ALTER TABLE songs ADD COLUMN marked_for_deletion_at TEXT DEFAULT NULL;

-- Create index for efficient querying of marked songs
CREATE INDEX IF NOT EXISTS idx_songs_marked_for_deletion ON songs(marked_for_deletion_at)
WHERE marked_for_deletion_at IS NOT NULL;
