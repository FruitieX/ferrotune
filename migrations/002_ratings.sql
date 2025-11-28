-- User ratings for songs, albums, and artists (1-5 scale)
CREATE TABLE IF NOT EXISTS ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK(item_type IN ('song', 'album', 'artist')),
    item_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    rated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_user ON ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_item ON ratings(item_type, item_id);
