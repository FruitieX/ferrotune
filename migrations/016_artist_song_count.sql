ALTER TABLE artists ADD COLUMN song_count INTEGER NOT NULL DEFAULT 0;

UPDATE artists SET song_count = (
    SELECT COUNT(*) FROM songs WHERE songs.artist_id = artists.id
);
