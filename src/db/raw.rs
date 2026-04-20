//! Dialect-aware raw SQL helpers for queries that do not translate cleanly
//! into the SeaORM query builder.
//!
//! Typical uses:
//! * FTS5 virtual-table queries on SQLite vs. `to_tsvector`/`to_tsquery` on
//!   PostgreSQL.
//! * Recursive CTEs (`WITH RECURSIVE`) used for directory walks.
//! * High-volume bulk inserts/upserts where the query builder is too slow.
//!
//! Each helper takes a pair of pre-parameterised SQL strings \u2014 one per
//! backend \u2014 and a shared list of bind values. The correct variant is
//! selected via [`sea_orm::DbBackend`].
//!
//! ```ignore
//! let rows = raw::query_all::<MyShape>(
//!     db,
//!     // SQLite: uses `?` placeholders
//!     "SELECT id, name FROM songs_fts WHERE songs_fts MATCH ?",
//!     // PostgreSQL: uses `$1` placeholders
//!     "SELECT id, name FROM songs WHERE search_vector @@ plainto_tsquery($1)",
//!     [Value::from(query)],
//! ).await?;
//! ```

#![allow(dead_code)]

use sea_orm::{
    ConnectionTrait, DbBackend, DbErr, ExecResult, FromQueryResult, QueryResult, Statement, Value,
    Values,
};

/// Pick the SQL string that matches `db`'s backend.
fn pick_sql<'a>(
    db: &impl ConnectionTrait,
    sqlite: &'a str,
    postgres: &'a str,
) -> (&'a str, DbBackend) {
    let backend = db.get_database_backend();
    let sql = match backend {
        DbBackend::Sqlite => sqlite,
        DbBackend::Postgres => postgres,
        DbBackend::MySql => {
            // MySQL is not a target backend for Ferrotune. Fall back to the
            // SQLite variant so the error surfaces clearly if someone wires it
            // up later.
            sqlite
        }
    };
    (sql, backend)
}

fn stmt(db: &impl ConnectionTrait, sqlite: &str, postgres: &str, values: Values) -> Statement {
    let (sql, backend) = pick_sql(db, sqlite, postgres);
    Statement::from_sql_and_values(backend, sql, values)
}

/// Execute a statement that does not return rows.
pub async fn execute(
    db: &impl ConnectionTrait,
    sqlite: &str,
    postgres: &str,
    values: impl IntoIterator<Item = Value>,
) -> Result<ExecResult, DbErr> {
    let values = Values(values.into_iter().collect());
    db.execute(stmt(db, sqlite, postgres, values)).await
}

/// Run a SELECT-like statement and deserialise every row into `T`.
pub async fn query_all<T: FromQueryResult>(
    db: &impl ConnectionTrait,
    sqlite: &str,
    postgres: &str,
    values: impl IntoIterator<Item = Value>,
) -> Result<Vec<T>, DbErr> {
    let values = Values(values.into_iter().collect());
    let rows = db.query_all(stmt(db, sqlite, postgres, values)).await?;
    rows.into_iter()
        .map(|row| T::from_query_result(&row, ""))
        .collect()
}

/// Run a SELECT-like statement and deserialise at most one row into `T`.
pub async fn query_one<T: FromQueryResult>(
    db: &impl ConnectionTrait,
    sqlite: &str,
    postgres: &str,
    values: impl IntoIterator<Item = Value>,
) -> Result<Option<T>, DbErr> {
    let values = Values(values.into_iter().collect());
    db.query_one(stmt(db, sqlite, postgres, values))
        .await?
        .map(|row| T::from_query_result(&row, ""))
        .transpose()
}

/// Run a SELECT-like statement and return the raw [`QueryResult`] rows.
///
/// Prefer [`query_all`] when you can describe the row shape with a struct.
pub async fn query_rows(
    db: &impl ConnectionTrait,
    sqlite: &str,
    postgres: &str,
    values: impl IntoIterator<Item = Value>,
) -> Result<Vec<QueryResult>, DbErr> {
    let values = Values(values.into_iter().collect());
    db.query_all(stmt(db, sqlite, postgres, values)).await
}

/// Run a statement that returns a single scalar value in the first column.
pub async fn query_scalar<T>(
    db: &impl ConnectionTrait,
    sqlite: &str,
    postgres: &str,
    values: impl IntoIterator<Item = Value>,
) -> Result<Option<T>, DbErr>
where
    T: sea_orm::TryGetable,
{
    let values = Values(values.into_iter().collect());
    let row = db.query_one(stmt(db, sqlite, postgres, values)).await?;
    match row {
        Some(row) => Ok(Some(row.try_get_by_index::<T>(0)?)),
        None => Ok(None),
    }
}
