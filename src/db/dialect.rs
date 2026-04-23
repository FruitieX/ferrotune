//! Dialect-aware SQL expression helpers.
//!
//! Where SeaORM cannot express a SQL operation natively because SQLite and
//! PostgreSQL diverge (date-part extraction, recursive CTE boilerplate, etc.),
//! this module provides `SimpleExpr` builders that select the correct SQL
//! fragment for the active backend.
//!
//! Prefer pulling data into Rust and post-processing there when feasible;
//! only reach for these helpers when DB-side grouping/filtering on the
//! derived value is needed.

#![allow(dead_code)]

use sea_orm::sea_query::{Expr, SimpleExpr};
use sea_orm::DbBackend;

/// Extract the 4-digit year from a timestamp column/expression as an integer.
///
/// * SQLite: `CAST(strftime('%Y', expr) AS INTEGER)`
/// * PostgreSQL: `EXTRACT(YEAR FROM expr)::INTEGER`
pub fn extract_year(backend: DbBackend, ts: SimpleExpr) -> SimpleExpr {
    match backend {
        DbBackend::Sqlite => Expr::cust_with_expr("CAST(strftime('%Y', $1) AS INTEGER)", ts),
        DbBackend::Postgres | DbBackend::MySql => {
            Expr::cust_with_expr("EXTRACT(YEAR FROM $1)::INTEGER", ts)
        }
    }
}

/// Extract the month number (1-12) from a timestamp column/expression.
pub fn extract_month(backend: DbBackend, ts: SimpleExpr) -> SimpleExpr {
    match backend {
        DbBackend::Sqlite => Expr::cust_with_expr("CAST(strftime('%m', $1) AS INTEGER)", ts),
        DbBackend::Postgres | DbBackend::MySql => {
            Expr::cust_with_expr("EXTRACT(MONTH FROM $1)::INTEGER", ts)
        }
    }
}
