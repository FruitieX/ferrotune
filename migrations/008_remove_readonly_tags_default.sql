-- Remove the initial 'music.readonly_tags' entry from server_config
-- This setting is now read dynamically from the database or falls back to the config file
-- There's no need to have an initial default value as the code handles this fallback
DELETE FROM server_config WHERE key = 'music.readonly_tags';
