use sqlx::SqlitePool;

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
    pool: &SqlitePool,
    user_id: i64,
    playlist_owner_id: i64,
    playlist_id: &str,
    is_public: bool,
) -> sqlx::Result<PlaylistAccess> {
    if user_id == playlist_owner_id {
        return Ok(PlaylistAccess {
            is_owner: true,
            can_read: true,
            can_edit: true,
        });
    }

    // Check if the playlist is shared with this user
    let share: Option<(bool,)> = sqlx::query_as(
        "SELECT can_edit FROM playlist_shares WHERE playlist_id = ? AND shared_with_user_id = ?",
    )
    .bind(playlist_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if let Some((can_edit,)) = share {
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
