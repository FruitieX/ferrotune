-- Per-user Last.fm configuration and session keys for scrobbling
ALTER TABLE users ADD COLUMN lastfm_api_key TEXT;
ALTER TABLE users ADD COLUMN lastfm_api_secret TEXT;
ALTER TABLE users ADD COLUMN lastfm_session_key TEXT;
ALTER TABLE users ADD COLUMN lastfm_username TEXT;
