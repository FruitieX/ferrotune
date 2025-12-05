-- Add metadata columns to music_folders for independent library management
-- last_scanned_at: timestamp of the last successful scan of this folder
-- scan_error: error message if the last scan failed (NULL if successful)

ALTER TABLE music_folders ADD COLUMN last_scanned_at TIMESTAMP;
ALTER TABLE music_folders ADD COLUMN scan_error TEXT;
