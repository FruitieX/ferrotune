-- Accounts at an OpenID Connect provider (Pocket ID) linked to local users,
-- keyed by the provider's issuer and subject.
CREATE TABLE IF NOT EXISTS user_oidc_identities (
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMPTZ,
    PRIMARY KEY (issuer, subject)
);

CREATE INDEX IF NOT EXISTS idx_user_oidc_identities_user_id ON user_oidc_identities(user_id);
