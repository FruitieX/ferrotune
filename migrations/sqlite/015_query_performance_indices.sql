-- Performance indices for home view and library view queries
--
-- These indices target the specific query patterns that cause slow performance:
-- 1. Scrobble aggregation subqueries (used by nearly every song/album query)
-- 2. EXISTS-based library access checks on songs (used by every album/artist list)
-- 3. Album ordering by created_at (newest albums)

-- Covering index for per-user scrobble aggregation:
--   SELECT song_id, SUM(play_count), MAX(played_at)
--   FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id
-- This is the most common scrobble pattern, used by search, library views, and queue materialization.
CREATE INDEX IF NOT EXISTS idx_scrobbles_user_submission_song_stats
    ON scrobbles(user_id, submission, song_id, play_count, played_at);

-- Covering index for global (all-user) scrobble aggregation:
--   SELECT song_id, SUM(play_count), MAX(played_at)
--   FROM scrobbles WHERE submission = 1 GROUP BY song_id
-- Used by SONG_BASE_QUERY_WITH_SCROBBLES for OpenSubsonic API compatibility.
CREATE INDEX IF NOT EXISTS idx_scrobbles_submission_song_stats
    ON scrobbles(submission, song_id, play_count, played_at);

-- Composite index for the EXISTS library access check on albums:
--   EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ... JOIN user_library_access ula ...
--           WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
-- Partial index excludes deleted songs to match the common query pattern.
CREATE INDEX IF NOT EXISTS idx_songs_album_music_folder
    ON songs(album_id, music_folder_id) WHERE marked_for_deletion_at IS NULL;

-- Composite index for the EXISTS library access check on artists:
--   EXISTS (SELECT 1 FROM songs s ... WHERE s.artist_id = a.id ...)
CREATE INDEX IF NOT EXISTS idx_songs_artist_music_folder
    ON songs(artist_id, music_folder_id) WHERE marked_for_deletion_at IS NULL;

-- Index for "newest" album sorting (ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_albums_created_at ON albums(created_at DESC);

-- Index for "recently played" queries that join scrobbles by user + played_at + song_id
CREATE INDEX IF NOT EXISTS idx_scrobbles_user_played_song
    ON scrobbles(user_id, played_at DESC, song_id);
