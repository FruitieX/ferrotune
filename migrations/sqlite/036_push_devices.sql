-- Native app installs that a push message (Firebase Cloud Messaging) can wake
-- to take over playback while their session event stream is closed.
CREATE TABLE IF NOT EXISTS push_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    device_label TEXT,
    token TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user_id ON push_devices(user_id);
