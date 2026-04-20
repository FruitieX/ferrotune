//! Domain-scoped query surface for the SeaORM migration.
//!
//! Each submodule groups queries that used to live in `src/db/queries.rs`.
//! Callers in `src/api/**` should depend on this module, never on SeaORM
//! entities or raw `DatabaseConnection`s directly \u2014 this keeps the query
//! layer swappable and ensures all queries run through the shared
//! ordering/raw helpers.

#![allow(dead_code)]

pub mod browse;
pub mod users;
