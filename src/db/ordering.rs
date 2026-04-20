//! Backend-aware ordering helpers.
//!
//! SQLite supports `COLLATE NOCASE` natively on indexed string columns, so
//! `ORDER BY col COLLATE NOCASE` is cheap. PostgreSQL does not have NOCASE;
//! we fall back to `ORDER BY LOWER(col)` (backed by functional indexes
//! declared in the migration layer).
//!
//! Use [`case_insensitive_order`] to build an ordering expression that
//! works on both backends without callers needing to inspect the dialect.

#![allow(dead_code)]

use sea_orm::sea_query::{Expr, Func, IntoColumnRef, SimpleExpr};
use sea_orm::DbBackend;

/// Build a case-insensitive ORDER BY expression for `col`.
///
/// * On SQLite, emits `col COLLATE NOCASE` (implemented as `Expr::cust_with_expr`).
/// * On PostgreSQL, emits `LOWER(col)`.
pub fn case_insensitive_order<C>(backend: DbBackend, col: C) -> SimpleExpr
where
    C: IntoColumnRef,
{
    let col_expr: SimpleExpr = Expr::col(col).into();
    match backend {
        DbBackend::Sqlite => Expr::cust_with_expr("$1 COLLATE NOCASE", col_expr),
        DbBackend::Postgres | DbBackend::MySql => SimpleExpr::FunctionCall(Func::lower(col_expr)),
    }
}
