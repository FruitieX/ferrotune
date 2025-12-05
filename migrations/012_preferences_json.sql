-- Add a JSON column to store arbitrary user preferences
-- This allows storing any key-value settings without schema changes
ALTER TABLE user_preferences ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}';
