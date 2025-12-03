-- Add file modification time column for incremental scanning
-- This stores the Unix timestamp (seconds since epoch) of the file's last modification
ALTER TABLE songs ADD COLUMN file_mtime INTEGER;

-- Create index for efficient mtime lookups during scanning
CREATE INDEX IF NOT EXISTS idx_songs_mtime ON songs(file_mtime);
