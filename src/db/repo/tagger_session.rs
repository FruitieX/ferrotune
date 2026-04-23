//! Query surface for the tagger session API.
//!
//! Wraps the `tagger_sessions`, `tagger_session_tracks`, `tagger_pending_edits`
//! and `tagger_scripts` tables. All queries use SeaORM / `sea_query` so we
//! don't need to maintain paired SQLite + Postgres SQL strings.

use crate::db::{entity, models, Database};
use crate::error::Result;
use chrono::{DateTime, Utc};
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
};

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

pub struct ScriptInsert<'a> {
    pub id: &'a str,
    pub user_id: i64,
    pub name: &'a str,
    pub script_type: &'a str,
    pub script: &'a str,
    pub position: i64,
    pub now: DateTime<Utc>,
}

pub async fn insert_tagger_script<C: ConnectionTrait>(
    conn: &C,
    script: ScriptInsert<'_>,
) -> Result<()> {
    entity::tagger_scripts::ActiveModel {
        id: ActiveValue::Set(script.id.to_string()),
        user_id: ActiveValue::Set(script.user_id),
        name: ActiveValue::Set(script.name.to_string()),
        r#type: ActiveValue::Set(script.script_type.to_string()),
        script: ActiveValue::Set(script.script.to_string()),
        position: ActiveValue::Set(script.position),
        created_at: ActiveValue::Set(script.now.fixed_offset()),
        updated_at: ActiveValue::Set(script.now.fixed_offset()),
    }
    .insert(conn)
    .await?;
    Ok(())
}

pub async fn count_tagger_scripts_for_user<C: ConnectionTrait>(
    conn: &C,
    user_id: i64,
) -> Result<i64> {
    let n = entity::tagger_scripts::Entity::find()
        .filter(entity::tagger_scripts::Column::UserId.eq(user_id))
        .count(conn)
        .await?;
    Ok(n as i64)
}

pub async fn list_tagger_scripts_for_user<C: ConnectionTrait>(
    conn: &C,
    user_id: i64,
) -> Result<Vec<models::TaggerScript>> {
    use entity::tagger_scripts::Column as S;
    let rows = entity::tagger_scripts::Entity::find()
        .select_only()
        .column(S::Id)
        .column(S::UserId)
        .column(S::Name)
        .column_as(S::Type, "script_type")
        .column(S::Script)
        .column(S::Position)
        .column(S::CreatedAt)
        .column(S::UpdatedAt)
        .filter(S::UserId.eq(user_id))
        .order_by_asc(S::Position)
        .into_model::<models::TaggerScript>()
        .all(conn)
        .await?;
    Ok(rows)
}

pub async fn delete_tagger_scripts_for_user<C: ConnectionTrait>(
    conn: &C,
    user_id: i64,
) -> Result<u64> {
    let res = entity::tagger_scripts::Entity::delete_many()
        .filter(entity::tagger_scripts::Column::UserId.eq(user_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_tagger_script_by_id<C: ConnectionTrait>(
    conn: &C,
    script_id: &str,
    user_id: i64,
) -> Result<u64> {
    let res = entity::tagger_scripts::Entity::delete_many()
        .filter(entity::tagger_scripts::Column::Id.eq(script_id))
        .filter(entity::tagger_scripts::Column::UserId.eq(user_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

pub async fn find_session_id_for_user<C: ConnectionTrait>(
    conn: &C,
    user_id: i64,
) -> Result<Option<i64>> {
    let id = entity::tagger_sessions::Entity::find()
        .select_only()
        .column(entity::tagger_sessions::Column::Id)
        .filter(entity::tagger_sessions::Column::UserId.eq(user_id))
        .into_tuple::<i64>()
        .one(conn)
        .await?;
    Ok(id)
}

pub async fn find_latest_session_id_for_user<C: ConnectionTrait>(
    conn: &C,
    user_id: i64,
) -> Result<Option<i64>> {
    let id = entity::tagger_sessions::Entity::find()
        .select_only()
        .column(entity::tagger_sessions::Column::Id)
        .filter(entity::tagger_sessions::Column::UserId.eq(user_id))
        .order_by_desc(entity::tagger_sessions::Column::UpdatedAt)
        .limit(1)
        .into_tuple::<i64>()
        .one(conn)
        .await?;
    Ok(id)
}

pub async fn insert_session_for_user(database: &Database, user_id: i64) -> Result<i64> {
    use sea_orm::ActiveModelTrait;
    let now = Utc::now().fixed_offset();
    // Set all columns the schema marks NOT NULL to their defaults. Relying on
    // SQL-level defaults would require per-dialect INSERT ... DEFAULT VALUES
    // handling.
    let model = entity::tagger_sessions::ActiveModel {
        user_id: ActiveValue::Set(user_id),
        visible_columns: ActiveValue::Set("[]".to_string()),
        column_widths: ActiveValue::Set("{}".to_string()),
        file_column_width: ActiveValue::Set(400),
        show_library_prefix: ActiveValue::Set(true),
        show_computed_path: ActiveValue::Set(false),
        details_panel_open: ActiveValue::Set(false),
        dangerous_char_mode: ActiveValue::Set("replace".to_string()),
        dangerous_char_replacement: ActiveValue::Set("_".to_string()),
        created_at: ActiveValue::Set(now),
        updated_at: ActiveValue::Set(now),
        ..Default::default()
    }
    .insert(database.conn())
    .await?;
    Ok(model.id)
}

pub async fn fetch_tagger_session<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
) -> Result<Option<models::TaggerSession>> {
    use entity::tagger_sessions::Column as S;
    let row = entity::tagger_sessions::Entity::find_by_id(session_id)
        .select_only()
        .column(S::Id)
        .column(S::UserId)
        .column(S::ActiveRenameScriptId)
        .column(S::ActiveTagScriptId)
        .column(S::TargetLibraryId)
        .column(S::VisibleColumns)
        .column(S::ColumnWidths)
        .column(S::FileColumnWidth)
        .column(S::ShowLibraryPrefix)
        .column(S::ShowComputedPath)
        .column(S::DetailsPanelOpen)
        .column(S::DangerousCharMode)
        .column(S::DangerousCharReplacement)
        .column(S::CreatedAt)
        .column(S::UpdatedAt)
        .into_model::<models::TaggerSession>()
        .one(conn)
        .await?;
    Ok(row)
}

/// Update a single session column and bump `updated_at`. The `value` is any
/// SeaORM [`Value`] so this helper works for text / bool / i64 fields alike.
pub async fn update_session_field<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    field: entity::tagger_sessions::Column,
    value: sea_orm::Value,
) -> Result<()> {
    let now = Utc::now().fixed_offset();
    entity::tagger_sessions::Entity::update_many()
        .col_expr(field, Expr::value(value))
        .col_expr(entity::tagger_sessions::Column::UpdatedAt, Expr::value(now))
        .filter(entity::tagger_sessions::Column::Id.eq(session_id))
        .exec(conn)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Session tracks
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromQueryResult)]
pub struct SessionTrackRow {
    pub track_id: String,
    pub track_type: String,
}

pub async fn fetch_session_tracks<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
) -> Result<Vec<SessionTrackRow>> {
    use entity::tagger_session_tracks::Column as T;
    let rows = entity::tagger_session_tracks::Entity::find()
        .select_only()
        .column(T::TrackId)
        .column(T::TrackType)
        .filter(T::SessionId.eq(session_id))
        .order_by_asc(T::Position)
        .into_model::<SessionTrackRow>()
        .all(conn)
        .await?;
    Ok(rows)
}

pub async fn list_staged_session_track_ids<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
) -> Result<Vec<String>> {
    use entity::tagger_session_tracks::Column as T;
    let rows = entity::tagger_session_tracks::Entity::find()
        .select_only()
        .column(T::TrackId)
        .filter(T::SessionId.eq(session_id))
        .filter(T::TrackType.eq("staged"))
        .into_tuple::<String>()
        .all(conn)
        .await?;
    Ok(rows)
}

pub async fn fetch_session_track_type<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    track_id: &str,
) -> Result<Option<String>> {
    use entity::tagger_session_tracks::Column as T;
    let row = entity::tagger_session_tracks::Entity::find()
        .select_only()
        .column(T::TrackType)
        .filter(T::SessionId.eq(session_id))
        .filter(T::TrackId.eq(track_id))
        .into_tuple::<String>()
        .one(conn)
        .await?;
    Ok(row)
}

pub async fn fetch_session_max_position<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
) -> Result<i64> {
    use entity::tagger_session_tracks::Column as T;
    let max: Option<Option<i64>> = entity::tagger_session_tracks::Entity::find()
        .select_only()
        .expr(Expr::col(T::Position).max())
        .filter(T::SessionId.eq(session_id))
        .into_tuple()
        .one(conn)
        .await?;
    Ok(max.and_then(|m| m).unwrap_or(-1))
}

pub async fn insert_session_track_ignore_duplicate<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    track_id: &str,
    track_type: &str,
    position: i64,
) -> Result<u64> {
    use entity::tagger_session_tracks::Column as T;
    let res =
        entity::tagger_session_tracks::Entity::insert(entity::tagger_session_tracks::ActiveModel {
            session_id: ActiveValue::Set(session_id),
            track_id: ActiveValue::Set(track_id.to_string()),
            track_type: ActiveValue::Set(track_type.to_string()),
            position: ActiveValue::Set(position),
            ..Default::default()
        })
        .on_conflict(
            OnConflict::columns([T::SessionId, T::TrackId])
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec(conn)
        .await;

    // `do_nothing` returns `TryInsertResult`; translate to rows-affected.
    match res {
        Ok(sea_orm::TryInsertResult::Inserted(_)) => Ok(1),
        Ok(sea_orm::TryInsertResult::Conflicted) => Ok(0),
        Ok(sea_orm::TryInsertResult::Empty) => Ok(0),
        Err(e) => Err(e.into()),
    }
}

pub async fn delete_session_tracks<C: ConnectionTrait>(conn: &C, session_id: i64) -> Result<u64> {
    let res = entity::tagger_session_tracks::Entity::delete_many()
        .filter(entity::tagger_session_tracks::Column::SessionId.eq(session_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_session_track<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    track_id: &str,
) -> Result<u64> {
    let res = entity::tagger_session_tracks::Entity::delete_many()
        .filter(entity::tagger_session_tracks::Column::SessionId.eq(session_id))
        .filter(entity::tagger_session_tracks::Column::TrackId.eq(track_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn insert_session_track<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    track_id: &str,
    track_type: &str,
    position: i64,
) -> Result<()> {
    entity::tagger_session_tracks::ActiveModel {
        session_id: ActiveValue::Set(session_id),
        track_id: ActiveValue::Set(track_id.to_string()),
        track_type: ActiveValue::Set(track_type.to_string()),
        position: ActiveValue::Set(position),
        ..Default::default()
    }
    .insert(conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Pending edits
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromQueryResult)]
pub struct PendingEditRow {
    pub id: i64,
    pub session_id: i64,
    pub track_id: String,
    pub edited_tags: String,
    pub computed_path: Option<String>,
    pub cover_art_removed: bool,
    pub cover_art_filename: Option<String>,
    pub replacement_audio_filename: Option<String>,
    pub replacement_audio_original_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn pending_edit_select() -> sea_orm::Select<entity::tagger_pending_edits::Entity> {
    use entity::tagger_pending_edits::Column as P;
    entity::tagger_pending_edits::Entity::find()
        .select_only()
        .column(P::Id)
        .column(P::SessionId)
        .column(P::TrackId)
        .column(P::EditedTags)
        .column(P::ComputedPath)
        .column(P::CoverArtRemoved)
        .column(P::CoverArtFilename)
        .column(P::ReplacementAudioFilename)
        .column(P::ReplacementAudioOriginalName)
        .column(P::CreatedAt)
        .column(P::UpdatedAt)
}

pub async fn fetch_pending_edits_for_session<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
) -> Result<Vec<PendingEditRow>> {
    let rows = pending_edit_select()
        .filter(entity::tagger_pending_edits::Column::SessionId.eq(session_id))
        .into_model::<PendingEditRow>()
        .all(conn)
        .await?;
    Ok(rows)
}

pub async fn fetch_pending_edit<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    track_id: &str,
) -> Result<Option<PendingEditRow>> {
    let row = pending_edit_select()
        .filter(entity::tagger_pending_edits::Column::SessionId.eq(session_id))
        .filter(entity::tagger_pending_edits::Column::TrackId.eq(track_id))
        .into_model::<PendingEditRow>()
        .one(conn)
        .await?;
    Ok(row)
}

pub async fn fetch_cover_art_filenames_for_session<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
) -> Result<Vec<Option<String>>> {
    use entity::tagger_pending_edits::Column as P;
    let rows = entity::tagger_pending_edits::Entity::find()
        .select_only()
        .column(P::CoverArtFilename)
        .filter(P::SessionId.eq(session_id))
        .filter(P::CoverArtFilename.is_not_null())
        .into_tuple::<Option<String>>()
        .all(conn)
        .await?;
    Ok(rows)
}

pub struct PendingEditUpsert<'a> {
    pub session_id: i64,
    pub track_id: &'a str,
    pub track_type: &'a str,
    pub edited_tags_json: &'a str,
    pub computed_path: Option<&'a str>,
    pub cover_art_removed: bool,
    pub now: DateTime<Utc>,
}

pub async fn upsert_pending_edit<C: ConnectionTrait>(
    conn: &C,
    edit: PendingEditUpsert<'_>,
) -> Result<()> {
    use entity::tagger_pending_edits::Column as P;
    let model = entity::tagger_pending_edits::ActiveModel {
        session_id: ActiveValue::Set(edit.session_id),
        track_id: ActiveValue::Set(edit.track_id.to_string()),
        track_type: ActiveValue::Set(edit.track_type.to_string()),
        edited_tags: ActiveValue::Set(edit.edited_tags_json.to_string()),
        computed_path: ActiveValue::Set(edit.computed_path.map(str::to_string)),
        cover_art_removed: ActiveValue::Set(edit.cover_art_removed),
        cover_art_filename: ActiveValue::Set(None),
        replacement_audio_filename: ActiveValue::Set(None),
        replacement_audio_original_name: ActiveValue::Set(None),
        created_at: ActiveValue::Set(edit.now.fixed_offset()),
        updated_at: ActiveValue::Set(edit.now.fixed_offset()),
        ..Default::default()
    };

    entity::tagger_pending_edits::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([P::SessionId, P::TrackId])
                .update_columns([
                    P::EditedTags,
                    P::ComputedPath,
                    P::CoverArtRemoved,
                    P::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(())
}

pub struct CoverArtStateUpsert<'a> {
    pub session_id: i64,
    pub track_id: &'a str,
    pub track_type: &'a str,
    pub cover_art_filename: Option<&'a str>,
    pub cover_art_removed: bool,
    pub now: DateTime<Utc>,
}

pub async fn upsert_pending_edit_cover_art_state<C: ConnectionTrait>(
    conn: &C,
    edit: CoverArtStateUpsert<'_>,
) -> Result<()> {
    use entity::tagger_pending_edits::Column as P;
    let model = entity::tagger_pending_edits::ActiveModel {
        session_id: ActiveValue::Set(edit.session_id),
        track_id: ActiveValue::Set(edit.track_id.to_string()),
        track_type: ActiveValue::Set(edit.track_type.to_string()),
        edited_tags: ActiveValue::Set("{}".to_string()),
        cover_art_filename: ActiveValue::Set(edit.cover_art_filename.map(str::to_string)),
        cover_art_removed: ActiveValue::Set(edit.cover_art_removed),
        computed_path: ActiveValue::Set(None),
        replacement_audio_filename: ActiveValue::Set(None),
        replacement_audio_original_name: ActiveValue::Set(None),
        created_at: ActiveValue::Set(edit.now.fixed_offset()),
        updated_at: ActiveValue::Set(edit.now.fixed_offset()),
        ..Default::default()
    };

    entity::tagger_pending_edits::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([P::SessionId, P::TrackId])
                .update_columns([P::CoverArtFilename, P::CoverArtRemoved, P::UpdatedAt])
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(())
}

pub struct LibraryPendingEditUpsert<'a> {
    pub session_id: i64,
    pub track_id: &'a str,
    pub edited_tags_json: &'a str,
    pub cover_art_filename: Option<&'a str>,
    pub cover_art_removed: bool,
    pub replacement_audio_filename: Option<&'a str>,
    pub replacement_audio_original_name: Option<&'a str>,
    pub now: DateTime<Utc>,
}

pub async fn upsert_library_pending_edit<C: ConnectionTrait>(
    conn: &C,
    edit: LibraryPendingEditUpsert<'_>,
) -> Result<()> {
    use entity::tagger_pending_edits::Column as P;
    let model = entity::tagger_pending_edits::ActiveModel {
        session_id: ActiveValue::Set(edit.session_id),
        track_id: ActiveValue::Set(edit.track_id.to_string()),
        track_type: ActiveValue::Set("library".to_string()),
        edited_tags: ActiveValue::Set(edit.edited_tags_json.to_string()),
        cover_art_filename: ActiveValue::Set(edit.cover_art_filename.map(str::to_string)),
        cover_art_removed: ActiveValue::Set(edit.cover_art_removed),
        replacement_audio_filename: ActiveValue::Set(
            edit.replacement_audio_filename.map(str::to_string),
        ),
        replacement_audio_original_name: ActiveValue::Set(
            edit.replacement_audio_original_name.map(str::to_string),
        ),
        computed_path: ActiveValue::Set(None),
        created_at: ActiveValue::Set(edit.now.fixed_offset()),
        updated_at: ActiveValue::Set(edit.now.fixed_offset()),
        ..Default::default()
    };

    entity::tagger_pending_edits::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([P::SessionId, P::TrackId])
                .update_columns([
                    P::EditedTags,
                    P::CoverArtFilename,
                    P::CoverArtRemoved,
                    P::ReplacementAudioFilename,
                    P::ReplacementAudioOriginalName,
                    P::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(())
}

pub async fn clear_pending_edit_replacement_audio<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    track_id: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    use entity::tagger_pending_edits::Column as P;
    entity::tagger_pending_edits::Entity::update_many()
        .col_expr(P::ReplacementAudioFilename, Expr::value(None::<String>))
        .col_expr(P::ReplacementAudioOriginalName, Expr::value(None::<String>))
        .col_expr(P::UpdatedAt, Expr::value(now.fixed_offset()))
        .filter(P::SessionId.eq(session_id))
        .filter(P::TrackId.eq(track_id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_pending_edit<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    track_id: &str,
) -> Result<u64> {
    let res = entity::tagger_pending_edits::Entity::delete_many()
        .filter(entity::tagger_pending_edits::Column::SessionId.eq(session_id))
        .filter(entity::tagger_pending_edits::Column::TrackId.eq(track_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_pending_edits_for_session<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
) -> Result<u64> {
    let res = entity::tagger_pending_edits::Entity::delete_many()
        .filter(entity::tagger_pending_edits::Column::SessionId.eq(session_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

// ---------------------------------------------------------------------------
// Cleanup / merge joins
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromQueryResult)]
pub struct TrackCleanupInfo {
    pub track_type: String,
    pub cover_art_filename: Option<String>,
    pub replacement_audio_filename: Option<String>,
}

pub async fn fetch_track_cleanup_info<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    track_id: &str,
) -> Result<Option<TrackCleanupInfo>> {
    use entity::tagger_pending_edits::Column as P;
    use entity::tagger_session_tracks::Column as T;
    use sea_orm::{JoinType, RelationDef};

    // There is no direct FK between `tagger_session_tracks` and
    // `tagger_pending_edits` (both reference `tagger_sessions` by id).
    // Build a join on (session_id, track_id) manually.
    let join_def: RelationDef =
        entity::tagger_session_tracks::Entity::belongs_to(entity::tagger_pending_edits::Entity)
            .from((T::SessionId, T::TrackId))
            .to((P::SessionId, P::TrackId))
            .into();

    let row = entity::tagger_session_tracks::Entity::find()
        .select_only()
        .column(T::TrackType)
        .expr_as(
            Expr::col((entity::tagger_pending_edits::Entity, P::CoverArtFilename)),
            "cover_art_filename",
        )
        .expr_as(
            Expr::col((
                entity::tagger_pending_edits::Entity,
                P::ReplacementAudioFilename,
            )),
            "replacement_audio_filename",
        )
        .join(JoinType::LeftJoin, join_def)
        .filter(T::SessionId.eq(session_id))
        .filter(T::TrackId.eq(track_id))
        .into_model::<TrackCleanupInfo>()
        .one(conn)
        .await?;
    Ok(row)
}

#[derive(Debug, Clone, FromQueryResult)]
pub struct PendingEditMergeState {
    pub edited_tags: String,
    pub cover_art_filename: Option<String>,
    pub cover_art_removed: bool,
    pub replacement_audio_filename: Option<String>,
    pub replacement_audio_original_name: Option<String>,
}

pub async fn fetch_pending_edit_merge_state<C: ConnectionTrait>(
    conn: &C,
    session_id: i64,
    track_id: &str,
) -> Result<Option<PendingEditMergeState>> {
    use entity::tagger_pending_edits::Column as P;
    let row = entity::tagger_pending_edits::Entity::find()
        .select_only()
        .column(P::EditedTags)
        .column(P::CoverArtFilename)
        .column(P::CoverArtRemoved)
        .column(P::ReplacementAudioFilename)
        .column(P::ReplacementAudioOriginalName)
        .filter(P::SessionId.eq(session_id))
        .filter(P::TrackId.eq(track_id))
        .into_model::<PendingEditMergeState>()
        .one(conn)
        .await?;
    Ok(row)
}
