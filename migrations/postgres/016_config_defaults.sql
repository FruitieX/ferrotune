-- Ensure configless runtime settings have database defaults.
DELETE FROM server_config
WHERE key IN ('server.host', 'server.port', 'server.admin_user', 'server.admin_password');

INSERT INTO server_config (key, value) VALUES
    ('server.name', '"Ferrotune"'),
    ('cache.max_cover_size', '1024'),
    ('music.readonly_tags', 'true'),
    ('music.allow_file_deletion', 'false'),
    ('initial_setup_complete', 'false')
ON CONFLICT (key) DO NOTHING;
