use chrono::{DateTime, Duration, Utc};
use rand::{rngs::OsRng, RngCore};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use crate::{
    db::{entity, models::User, Database},
    error::{Error, Result},
};

const SESSION_TOKEN_BYTES: usize = 32;
const URL_TOKEN_BYTES: usize = 32;
const URL_TOKEN_ALL_SCOPE: &str = "all";
const SESSION_DURATION_DAYS: i64 = 30;
const SESSION_RENEWAL_THRESHOLD_DAYS: i64 = 7;

#[derive(Debug, Clone)]
pub struct CreatedAuthSession {
    pub session_id: String,
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct CreatedUrlToken {
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct AuthenticatedSession {
    pub session_id: String,
    pub user: User,
    pub expires_at: DateTime<Utc>,
}

pub fn hash_auth_token(token: &str) -> String {
    blake3::hash(token.as_bytes()).to_hex().to_string()
}

pub fn session_duration() -> Duration {
    Duration::days(SESSION_DURATION_DAYS)
}

pub async fn create_session(
    database: &Database,
    user_id: i64,
    client_name: Option<&str>,
    duration: Duration,
) -> Result<CreatedAuthSession> {
    let now = Utc::now();
    let expires_at = now + duration;
    let session_id = Uuid::new_v4().to_string();
    let token = generate_token("fts", SESSION_TOKEN_BYTES);
    let token_hash = hash_auth_token(&token);

    let model = entity::auth_sessions::ActiveModel {
        id: Set(session_id.clone()),
        token_hash: Set(token_hash),
        user_id: Set(user_id),
        client_name: Set(client_name.map(str::to_string)),
        created_at: Set(now.fixed_offset()),
        last_used_at: Set(Some(now.fixed_offset())),
        expires_at: Set(expires_at.fixed_offset()),
        revoked_at: Set(None),
    };

    entity::auth_sessions::Entity::insert(model)
        .exec(database.conn())
        .await?;

    Ok(CreatedAuthSession {
        session_id,
        token,
        expires_at,
    })
}

pub async fn authenticate_session_token(
    database: &Database,
    token: &str,
) -> Result<Option<AuthenticatedSession>> {
    let token_hash = hash_auth_token(token);
    let now = Utc::now();
    let Some(session) = entity::auth_sessions::Entity::find()
        .filter(entity::auth_sessions::Column::TokenHash.eq(token_hash))
        .filter(entity::auth_sessions::Column::RevokedAt.is_null())
        .filter(entity::auth_sessions::Column::ExpiresAt.gt(now.fixed_offset()))
        .one(database.conn())
        .await?
    else {
        return Ok(None);
    };

    let expires_at = touch_session(database, &session, now).await?;

    let Some(user) = super::users::get_user_by_id(database, session.user_id).await? else {
        return Ok(None);
    };

    Ok(Some(AuthenticatedSession {
        session_id: session.id,
        user,
        expires_at,
    }))
}

pub async fn revoke_session_token(database: &Database, token: &str) -> Result<()> {
    let token_hash = hash_auth_token(token);
    let now = Utc::now().fixed_offset();

    entity::auth_sessions::Entity::update_many()
        .col_expr(
            entity::auth_sessions::Column::RevokedAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(entity::auth_sessions::Column::TokenHash.eq(token_hash))
        .filter(entity::auth_sessions::Column::RevokedAt.is_null())
        .exec(database.conn())
        .await?;

    Ok(())
}

pub async fn create_url_token(
    database: &Database,
    session_id: &str,
    user_id: i64,
    scope: &str,
    duration: Duration,
) -> Result<CreatedUrlToken> {
    let normalized_scope = normalize_url_token_scope(scope)?;
    let now = Utc::now();
    let expires_at = now + duration;
    let token = generate_token("ftu", URL_TOKEN_BYTES);
    let token_hash = hash_auth_token(&token);

    let model = entity::auth_url_tokens::ActiveModel {
        id: Set(Uuid::new_v4().to_string()),
        token_hash: Set(token_hash),
        session_id: Set(session_id.to_string()),
        user_id: Set(user_id),
        scope: Set(normalized_scope),
        created_at: Set(now.fixed_offset()),
        expires_at: Set(expires_at.fixed_offset()),
    };

    entity::auth_url_tokens::Entity::insert(model)
        .exec(database.conn())
        .await?;

    Ok(CreatedUrlToken { token, expires_at })
}

pub async fn authenticate_url_token(
    database: &Database,
    token: &str,
    required_scope: &str,
) -> Result<Option<AuthenticatedSession>> {
    let required_scope = normalize_url_token_scope(required_scope)?;
    let token_hash = hash_auth_token(token);
    let now = Utc::now();

    let Some(url_token) = entity::auth_url_tokens::Entity::find()
        .filter(entity::auth_url_tokens::Column::TokenHash.eq(token_hash))
        .filter(entity::auth_url_tokens::Column::ExpiresAt.gt(now.fixed_offset()))
        .one(database.conn())
        .await?
    else {
        return Ok(None);
    };

    if url_token.scope != URL_TOKEN_ALL_SCOPE && url_token.scope != required_scope {
        return Ok(None);
    }

    let Some(session) = entity::auth_sessions::Entity::find()
        .filter(entity::auth_sessions::Column::Id.eq(url_token.session_id))
        .filter(entity::auth_sessions::Column::RevokedAt.is_null())
        .filter(entity::auth_sessions::Column::ExpiresAt.gt(now.fixed_offset()))
        .one(database.conn())
        .await?
    else {
        return Ok(None);
    };

    let expires_at = touch_session(database, &session, now).await?;

    let Some(user) = super::users::get_user_by_id(database, session.user_id).await? else {
        return Ok(None);
    };

    Ok(Some(AuthenticatedSession {
        session_id: session.id,
        user,
        expires_at,
    }))
}

fn normalize_url_token_scope(scope: &str) -> Result<String> {
    let normalized = scope.trim().to_ascii_lowercase();
    match normalized.as_str() {
        URL_TOKEN_ALL_SCOPE | "media" | "events" => Ok(normalized),
        _ => Err(Error::InvalidRequest(format!(
            "Unsupported URL token scope: {scope}"
        ))),
    }
}

async fn touch_session(
    database: &Database,
    session: &entity::auth_sessions::Model,
    now: DateTime<Utc>,
) -> Result<DateTime<Utc>> {
    let current_expires_at = session.expires_at.with_timezone(&Utc);
    let expires_at = renewed_session_expires_at(current_expires_at, now);
    let mut update = entity::auth_sessions::Entity::update_many();
    update = update.col_expr(
        entity::auth_sessions::Column::LastUsedAt,
        sea_orm::sea_query::Expr::value(now.fixed_offset()),
    );

    if expires_at != current_expires_at {
        update = update.col_expr(
            entity::auth_sessions::Column::ExpiresAt,
            sea_orm::sea_query::Expr::value(expires_at.fixed_offset()),
        );
    }

    update
        .filter(entity::auth_sessions::Column::Id.eq(&session.id))
        .exec(database.conn())
        .await?;

    Ok(expires_at)
}

fn renewed_session_expires_at(
    current_expires_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> DateTime<Utc> {
    if current_expires_at - now <= session_renewal_threshold() {
        now + session_duration()
    } else {
        current_expires_at
    }
}

fn session_renewal_threshold() -> Duration {
    Duration::days(SESSION_RENEWAL_THRESHOLD_DAYS)
}

fn generate_token(prefix: &str, bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut value);
    format!("{prefix}_{}", hex::encode(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo::users;

    async fn create_test_user(database: &Database) -> i64 {
        users::create_user(
            database,
            "session-user",
            "password-hash",
            Some("session@example.com"),
            true,
        )
        .await
        .expect("user should be created")
    }

    async fn stored_session_expires_at(database: &Database, session_id: &str) -> DateTime<Utc> {
        entity::auth_sessions::Entity::find_by_id(session_id.to_string())
            .one(database.conn())
            .await
            .expect("session should query")
            .expect("session should exist")
            .expires_at
            .with_timezone(&Utc)
    }

    fn assert_expires_at_close(actual: DateTime<Utc>, expected: DateTime<Utc>) {
        assert!(actual >= expected - Duration::seconds(1));
        assert!(actual <= expected + Duration::seconds(1));
    }

    #[tokio::test]
    async fn session_and_url_tokens_authenticate_and_revoke() {
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("in-memory database should migrate");
        let user_id = create_test_user(&database).await;

        let session = create_session(
            &database,
            user_id,
            Some("test-client"),
            Duration::minutes(10),
        )
        .await
        .expect("session should be created");

        assert_ne!(session.token, hash_auth_token(&session.token));
        let authenticated = authenticate_session_token(&database, &session.token)
            .await
            .expect("session auth should query")
            .expect("session token should authenticate");
        assert_eq!(authenticated.user.id, user_id);
        assert_eq!(authenticated.user.username, "session-user");

        let url_token = create_url_token(
            &database,
            &session.session_id,
            user_id,
            "media",
            Duration::minutes(5),
        )
        .await
        .expect("URL token should be created");

        let media_user = authenticate_url_token(&database, &url_token.token, "media")
            .await
            .expect("URL-token auth should query")
            .expect("matching URL-token scope should authenticate");
        assert_eq!(media_user.user.id, user_id);

        let events_user = authenticate_url_token(&database, &url_token.token, "events")
            .await
            .expect("URL-token auth should query");
        assert!(events_user.is_none());

        revoke_session_token(&database, &session.token)
            .await
            .expect("session should be revoked");
        let revoked_session = authenticate_session_token(&database, &session.token)
            .await
            .expect("revoked session auth should query");
        assert!(revoked_session.is_none());
        let revoked_url_token = authenticate_url_token(&database, &url_token.token, "media")
            .await
            .expect("revoked URL-token auth should query");
        assert!(revoked_url_token.is_none());
    }

    #[tokio::test]
    async fn bearer_session_authentication_extends_near_expiry_session() {
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("in-memory database should migrate");
        let user_id = create_test_user(&database).await;

        let session = create_session(&database, user_id, Some("test-client"), Duration::days(1))
            .await
            .expect("session should be created");

        let authenticated = authenticate_session_token(&database, &session.token)
            .await
            .expect("session auth should query")
            .expect("session token should authenticate");
        let stored_expires_at = stored_session_expires_at(&database, &session.session_id).await;
        let minimum_extended_expiry = Utc::now() + Duration::days(20);

        assert!(authenticated.expires_at > minimum_extended_expiry);
        assert!(stored_expires_at > minimum_extended_expiry);
    }

    #[tokio::test]
    async fn bearer_session_authentication_keeps_far_expiry_unchanged() {
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("in-memory database should migrate");
        let user_id = create_test_user(&database).await;

        let session = create_session(&database, user_id, Some("test-client"), Duration::days(20))
            .await
            .expect("session should be created");

        let authenticated = authenticate_session_token(&database, &session.token)
            .await
            .expect("session auth should query")
            .expect("session token should authenticate");
        let stored_expires_at = stored_session_expires_at(&database, &session.session_id).await;

        assert_expires_at_close(authenticated.expires_at, session.expires_at);
        assert_expires_at_close(stored_expires_at, session.expires_at);
    }

    #[tokio::test]
    async fn url_token_authentication_extends_parent_session() {
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("in-memory database should migrate");
        let user_id = create_test_user(&database).await;
        let session = create_session(&database, user_id, Some("test-client"), Duration::days(1))
            .await
            .expect("session should be created");
        let url_token = create_url_token(
            &database,
            &session.session_id,
            user_id,
            "media",
            Duration::minutes(5),
        )
        .await
        .expect("URL token should be created");

        let authenticated = authenticate_url_token(&database, &url_token.token, "media")
            .await
            .expect("URL-token auth should query")
            .expect("matching URL-token scope should authenticate");
        let stored_expires_at = stored_session_expires_at(&database, &session.session_id).await;
        let minimum_extended_expiry = Utc::now() + Duration::days(20);

        assert!(authenticated.expires_at > minimum_extended_expiry);
        assert!(stored_expires_at > minimum_extended_expiry);
    }
}
