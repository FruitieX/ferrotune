-- Add waveform data column to songs table.
-- Stores pre-computed normalized waveform heights as a BLOB (f32 little-endian values).
-- Resolution is fixed at the time of analysis (typically 500 bars).
ALTER TABLE songs ADD COLUMN waveform_data BLOB DEFAULT NULL;
