//! Cross-filesystem file operations
//!
//! Standard `fs::copy` and `fs::rename` can fail when operating across different
//! filesystems (e.g., NFS, CIFS, or when temp dir is on a different mount).
//! These utilities provide reliable alternatives that work across filesystem boundaries.

use std::path::Path;
use tokio::fs;

/// Copy a file, handling cross-filesystem scenarios.
///
/// Uses read + write instead of copy to work across filesystem boundaries,
/// since `fs::copy` may use syscalls like `copy_file_range` or `sendfile`
/// that fail on some filesystem combinations.
pub async fn copy_file_cross_fs(src: &Path, dst: &Path) -> std::io::Result<()> {
    let data = fs::read(src).await?;
    fs::write(dst, data).await
}

/// Move a file, handling cross-filesystem scenarios.
///
/// Tries rename first (fast, atomic), falls back to copy + delete for cross-device moves.
pub async fn move_file_cross_fs(src: &Path, dst: &Path) -> std::io::Result<()> {
    // Try rename first (fast and atomic for same filesystem)
    if fs::rename(src, dst).await.is_ok() {
        return Ok(());
    }

    // Fall back to copy + delete for cross-device moves
    copy_file_cross_fs(src, dst).await?;
    fs::remove_file(src).await?;
    Ok(())
}
