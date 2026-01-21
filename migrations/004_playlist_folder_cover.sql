-- Add cover art support for playlist folders
ALTER TABLE playlist_folders ADD COLUMN cover_art BLOB DEFAULT NULL;
