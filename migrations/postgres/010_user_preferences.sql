CREATE TABLE IF NOT EXISTS user_preferences (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    accent_color TEXT NOT NULL DEFAULT 'rust',
    custom_accent_hue DOUBLE PRECISION,
    custom_accent_lightness DOUBLE PRECISION,
    custom_accent_chroma DOUBLE PRECISION,
    preferences_json TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);