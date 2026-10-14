-- Repeatable "still love this one" likes on songs: one row per like. A tap
-- within the server's undo window of the newest like deletes it instead.
CREATE TABLE IF NOT EXISTS song_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    liked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- The like also favorited the song, so undoing it unfavorites it.
    starred_song BOOLEAN NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_song_likes_user_song ON song_likes(user_id, song_id, liked_at);
CREATE INDEX IF NOT EXISTS idx_song_likes_user_liked_at ON song_likes(user_id, liked_at);
