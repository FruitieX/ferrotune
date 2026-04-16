-- Add skip tracking to listening sessions
ALTER TABLE listening_sessions ADD COLUMN skipped BOOLEAN NOT NULL DEFAULT 0;
