-- Add subsonic_token column for OpenSubsonic token+salt authentication
-- This stores the plaintext password for computing md5(password + salt) tokens
-- The password_hash column stores argon2 hashes for direct password auth

-- Add the subsonic_token column
ALTER TABLE users ADD COLUMN subsonic_token TEXT;

-- Copy existing password_hash values to subsonic_token for migration
-- Note: After migration, users should be recreated or have their passwords reset
-- to get proper argon2 hashes in password_hash
UPDATE users SET subsonic_token = password_hash;
