//! TypeScript-facing DTOs derived from SeaORM entity models.
//!
//! The frontend binding layer (`bindings/`) is generated from the `TS`
//! derives on these structs. Keeping DTOs separate from
//! [`crate::db::entity`] models lets us evolve the database schema without
//! breaking the wire format, and lets us compose joined columns (e.g.
//! `play_count`, `starred_at`) without leaking SeaORM relations into
//! serialized output.

#![allow(dead_code)]
