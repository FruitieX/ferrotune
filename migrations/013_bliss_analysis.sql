-- Add bliss audio analysis features for song similarity/radio
-- bliss_features: 92-byte BLOB (23 x f32, little-endian) containing audio feature vector
-- bliss_version: integer tracking which bliss FeaturesVersion was used for analysis
ALTER TABLE songs ADD COLUMN bliss_features BLOB;
ALTER TABLE songs ADD COLUMN bliss_version INTEGER;
