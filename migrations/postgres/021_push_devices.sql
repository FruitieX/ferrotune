-- Native app installs that a push message (Firebase Cloud Messaging) can wake
-- to take over playback while their session event stream is closed.
CREATE TABLE IF NOT EXISTS push_devices (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    device_label TEXT,
    token TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user_id ON push_devices(user_id);
