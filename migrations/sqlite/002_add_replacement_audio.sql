-- Add replacement audio support to tagger pending edits
-- This allows users to replace the audio content of a library track while preserving tags

-- Add column to track the replacement audio file (staged filename - UUID based)
ALTER TABLE tagger_pending_edits ADD COLUMN replacement_audio_filename TEXT DEFAULT NULL;

-- Add column to store the original filename for display purposes
ALTER TABLE tagger_pending_edits ADD COLUMN replacement_audio_original_name TEXT DEFAULT NULL;
