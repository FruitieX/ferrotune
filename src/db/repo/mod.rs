//! Domain-scoped query surface for the SeaORM migration.
//!
//! Each submodule groups queries that used to live in `src/db/queries.rs`.
//! Callers in `src/api/**` should depend on this module, never on SeaORM
//! entities or raw `DatabaseConnection`s directly \u2014 this keeps the query
//! layer swappable and ensures all queries run through the shared
//! ordering/raw helpers.

#![allow(dead_code)]

pub mod bliss;
pub mod browse;
pub mod config;
pub mod coverart;
pub mod duplicates;
pub mod history;
pub mod history_admin;
pub mod listening;
pub mod lists;
pub mod matching;
pub mod media;
pub mod music_folders;
pub mod playlists;
pub mod recycle_bin;
pub mod scanner;
pub mod scrobbles;
pub mod song_flags;
pub mod starring;
pub mod stats;
pub mod tagger;
pub mod tagger_session;
pub mod users;
pub mod waveform;
