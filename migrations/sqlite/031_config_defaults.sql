-- Ensure configless runtime settings have database defaults.
DELETE FROM server_config
WHERE key IN ('server.host', 'server.port', 'server.admin_user', 'server.admin_password');

INSERT OR IGNORE INTO server_config (key, value) VALUES
    ('music.readonly_tags', 'true'),
    ('music.allow_file_deletion', 'false');
