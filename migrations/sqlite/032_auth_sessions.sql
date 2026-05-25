CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    client_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_url_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    scope TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (session_id) REFERENCES auth_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_url_tokens_session_id ON auth_url_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_auth_url_tokens_user_id ON auth_url_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_url_tokens_token_hash ON auth_url_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_url_tokens_expires_at ON auth_url_tokens(expires_at);

DROP TABLE IF EXISTS api_keys;
