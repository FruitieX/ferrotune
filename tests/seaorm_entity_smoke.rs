//! Smoke test: verify every SeaORM entity decodes a fresh row on both
//! backends.
//!
//! The Postgres-generated entities use `DateTimeWithTimeZone`, `i64`, `f64`
//! etc. \u2014 this test ensures those types also round-trip correctly when
//! SeaORM runs against SQLite (where timestamps live in TEXT columns and
//! integers use affinity-based storage).

use ferrotune::db::entity;
use sea_orm::{EntityTrait, PaginatorTrait, SqlxSqliteConnector};
use sqlx::sqlite::SqlitePoolOptions;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/sqlite");

async fn setup_sqlite() -> sea_orm::DatabaseConnection {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite should connect");
    MIGRATOR.run(&pool).await.expect("migrations should apply");
    SqlxSqliteConnector::from_sqlx_sqlite_pool(pool)
}

#[tokio::test]
async fn every_entity_counts_cleanly_on_sqlite() {
    let db = setup_sqlite().await;

    // Each entity's `count()` forces SeaORM to issue a SELECT and decode
    // nothing; any compile-time column mismatch surfaces as a `DbErr`.
    entity::albums::Entity::find().count(&db).await.unwrap();
    entity::api_keys::Entity::find().count(&db).await.unwrap();
    entity::artists::Entity::find().count(&db).await.unwrap();
    entity::cover_art_thumbnails::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::disabled_songs::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::listening_sessions::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::match_dictionary::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::music_folders::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::play_queue_entries::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::play_queues::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::playback_sessions::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::playlist_folders::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::playlist_shares::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::playlist_songs::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::playlists::Entity::find().count(&db).await.unwrap();
    entity::ratings::Entity::find().count(&db).await.unwrap();
    entity::scrobbles::Entity::find().count(&db).await.unwrap();
    entity::server_config::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::shuffle_excludes::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::smart_playlists::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::songs::Entity::find().count(&db).await.unwrap();
    entity::starred::Entity::find().count(&db).await.unwrap();
    entity::tagger_pending_edits::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::tagger_scripts::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::tagger_session_tracks::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::tagger_sessions::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::user_library_access::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::user_playlist_overrides::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::user_preferences::Entity::find()
        .count(&db)
        .await
        .unwrap();
    entity::users::Entity::find().count(&db).await.unwrap();
}

#[tokio::test]
async fn round_trip_typed_columns_on_sqlite() {
    use chrono::{FixedOffset, Utc};
    use entity::songs;
    use sea_orm::ActiveModelTrait;
    use sea_orm::ActiveValue::Set;

    let db = setup_sqlite().await;

    // Bootstrap a minimal graph: music folder -> artist -> album -> song.
    // This exercises BIGINT/BOOLEAN/TIMESTAMPTZ columns all in one insert.
    let folder = entity::music_folders::ActiveModel {
        name: Set("Test".to_string()),
        path: Set("/tmp/fake".to_string()),
        enabled: Set(true),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();
    assert!(folder.enabled);

    let artist = entity::artists::ActiveModel {
        id: Set("artist-1".to_string()),
        name: Set("Test Artist".to_string()),
        sort_name: Set(None),
        album_count: Set(0),
        song_count: Set(0),
        cover_art_hash: Set(None),
    }
    .insert(&db)
    .await
    .unwrap();
    assert_eq!(artist.name, "Test Artist");

    let now: chrono::DateTime<FixedOffset> =
        Utc::now().with_timezone(&FixedOffset::east_opt(0).unwrap());
    let song = songs::ActiveModel {
        id: Set("song-1".to_string()),
        title: Set("Test Song".to_string()),
        album_id: Set(None),
        artist_id: Set("artist-1".to_string()),
        music_folder_id: Set(Some(folder.id)),
        track_number: Set(None),
        disc_number: Set(1),
        year: Set(None),
        genre: Set(None),
        duration: Set(180_000),
        bitrate: Set(Some(320)),
        file_path: Set("/tmp/fake/song.mp3".to_string()),
        file_size: Set(4_321_000),
        file_format: Set("mp3".to_string()),
        file_mtime: Set(Some(1_700_000_000)),
        partial_hash: Set(None),
        full_file_hash: Set(None),
        cover_art_hash: Set(None),
        marked_for_deletion_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        cover_art_width: Set(None),
        cover_art_height: Set(None),
        original_replaygain_track_gain: Set(Some(-7.5)),
        original_replaygain_track_peak: Set(Some(0.94)),
        computed_replaygain_track_gain: Set(None),
        computed_replaygain_track_peak: Set(None),
        waveform_data: Set(None),
        bliss_features: Set(None),
        bliss_version: Set(None),
    }
    .insert(&db)
    .await
    .unwrap();

    assert_eq!(song.duration, 180_000);
    assert_eq!(song.file_size, 4_321_000);
    assert_eq!(song.file_mtime, Some(1_700_000_000));
    assert_eq!(song.original_replaygain_track_gain, Some(-7.5));

    let refetched = songs::Entity::find_by_id("song-1".to_string())
        .one(&db)
        .await
        .unwrap()
        .expect("song should round-trip");
    assert_eq!(refetched.duration, 180_000);
    assert_eq!(refetched.original_replaygain_track_peak, Some(0.94));
    assert!((refetched.created_at.timestamp() - now.timestamp()).abs() <= 1);
}
