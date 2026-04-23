use crate::db::entity::playlist_shares;
use crate::error::Result;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};

/// Represents a user's access level to a playlist.
pub struct PlaylistAccess {
    pub is_owner: bool,
    pub can_read: bool,
    pub can_edit: bool,
}

/// Determine what access a user has to a given playlist.
///
/// Access levels:
/// - Owner: full access (read, edit, delete, manage shares)
/// - Shared with `can_edit=true`: read + edit
/// - Shared with `can_edit=false`: read-only
/// - Public playlist: read-only
/// - Otherwise: no access
pub async fn get_playlist_access(
    database: &crate::db::Database,
    user_id: i64,
    playlist_owner_id: i64,
    playlist_id: &str,
    is_public: bool,
) -> Result<PlaylistAccess> {
    if user_id == playlist_owner_id {
        return Ok(PlaylistAccess {
            is_owner: true,
            can_read: true,
            can_edit: true,
        });
    }

    #[derive(sea_orm::FromQueryResult)]
    struct ShareRow {
        can_edit: bool,
    }

    let share = playlist_shares::Entity::find()
        .select_only()
        .column(playlist_shares::Column::CanEdit)
        .filter(playlist_shares::Column::PlaylistId.eq(playlist_id))
        .filter(playlist_shares::Column::SharedWithUserId.eq(user_id))
        .into_model::<ShareRow>()
        .one(database.conn())
        .await?;

    if let Some(ShareRow { can_edit }) = share {
        return Ok(PlaylistAccess {
            is_owner: false,
            can_read: true,
            can_edit,
        });
    }

    // Public playlists are readable by everyone
    if is_public {
        return Ok(PlaylistAccess {
            is_owner: false,
            can_read: true,
            can_edit: false,
        });
    }

    Ok(PlaylistAccess {
        is_owner: false,
        can_read: false,
        can_edit: false,
    })
}
