ALTER TABLE users DROP COLUMN subsonic_token;

UPDATE play_queues SET source_api = 'legacy' WHERE source_api = 'subsonic';