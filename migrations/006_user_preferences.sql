-- User preferences table for storing user settings like accent color
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    accent_color TEXT NOT NULL DEFAULT 'rust',
    custom_accent_hue REAL,
    custom_accent_lightness REAL,
    custom_accent_chroma REAL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
