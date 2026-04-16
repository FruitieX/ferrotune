-- ReplayGain support: store both original (from file) and computed (by scanner) gain values

-- Original ReplayGain tags from the media file
ALTER TABLE songs ADD COLUMN original_replaygain_track_gain REAL;
ALTER TABLE songs ADD COLUMN original_replaygain_track_peak REAL;

-- Computed ReplayGain values from EBU R128 analysis during scan
ALTER TABLE songs ADD COLUMN computed_replaygain_track_gain REAL;
ALTER TABLE songs ADD COLUMN computed_replaygain_track_peak REAL;

-- Index for efficient queries on songs with/without ReplayGain data
CREATE INDEX IF NOT EXISTS idx_songs_computed_replaygain ON songs(computed_replaygain_track_gain) 
WHERE computed_replaygain_track_gain IS NOT NULL;
