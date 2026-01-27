-- Add cover art dimension columns to songs and albums tables
-- cover_art_resolution stores the smaller of width/height (the limiting dimension)

ALTER TABLE songs ADD COLUMN cover_art_width INTEGER DEFAULT NULL;
ALTER TABLE songs ADD COLUMN cover_art_height INTEGER DEFAULT NULL;

ALTER TABLE albums ADD COLUMN cover_art_width INTEGER DEFAULT NULL;
ALTER TABLE albums ADD COLUMN cover_art_height INTEGER DEFAULT NULL;
