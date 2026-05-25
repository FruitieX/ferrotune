CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_url_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_url_tokens_session_id ON auth_url_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_auth_url_tokens_user_id ON auth_url_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_url_tokens_token_hash ON auth_url_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_url_tokens_expires_at ON auth_url_tokens(expires_at);

DROP TABLE IF EXISTS api_keys;
