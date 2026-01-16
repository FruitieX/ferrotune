//! Custom integration tests that don't fit the hurl pattern.
//!
//! These tests have special requirements like multi-folder setup
//! that can't be easily expressed in hurl scripts.

mod common;

use common::{fixtures_dir, TestServer, TestServerConfig};
use std::path::Path;

/// Check if test fixtures exist.
fn fixtures_exist() -> bool {
    let music_dir = fixtures_dir().join("music");
    music_dir.exists()
        && music_dir
            .read_dir()
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dst)?;

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

/// Test that a full rescan of one folder doesn't delete songs from other folders.
/// This is a regression test for a bug where clean_missing_files would query ALL
/// songs but check them against only the current folder's base path.
#[test]
fn test_multi_folder_rescan_preserves_other_folders() {
    if !fixtures_exist() {
        eprintln!("Skipping test: fixtures not generated. Run `moon run generate-fixtures` first.");
        return;
    }

    // Create two separate music directories with different files
    // Use process ID and timestamp to ensure unique directory even in parallel runs
    let unique_id = format!(
        "{}_{:?}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let temp_dir = std::env::temp_dir().join(format!("ferrotune_multi_folder_test_{}", unique_id));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).unwrap();
    }

    let folder_a = temp_dir.join("folder_a");
    let folder_b = temp_dir.join("folder_b");
    std::fs::create_dir_all(&folder_a).unwrap();
    std::fs::create_dir_all(&folder_b).unwrap();

    // Copy fixtures to both folders (copy entire directory structure)
    let fixtures_music = fixtures_dir().join("music");
    if fixtures_music.exists() {
        // Copy to folder_a
        copy_dir_recursive(&fixtures_music, &folder_a).expect("Failed to copy to folder_a");
        // Copy to folder_b
        copy_dir_recursive(&fixtures_music, &folder_b).expect("Failed to copy to folder_b");
    }

    // Create server with two music folders
    let extra_config = format!(
        r#"
[[music.folders]]
name = "Folder B"
path = "{}"
"#,
        folder_b.display()
    );

    let config = TestServerConfig {
        music_path: Some(folder_a.clone()),
        copy_fixtures: false,
        extra_config: Some(extra_config),
        ..Default::default()
    };

    let server = TestServer::with_config(config).expect("Failed to start test server");

    // Initial scan
    server.scan_library().expect("Initial scan failed");

    // Count songs via API
    let response = reqwest::blocking::get(server.api_url("getRandomSongs?size=1000"))
        .expect("Failed to get songs");
    let initial_count = response.text().unwrap().matches("<song ").count();

    eprintln!("Initial song count: {}", initial_count);
    assert!(initial_count > 0, "Should have songs after initial scan");

    // Do a full rescan (this should NOT delete songs from folder_b)
    server.scan_library().expect("Full rescan failed");

    // Count songs again
    let response = reqwest::blocking::get(server.api_url("getRandomSongs?size=1000"))
        .expect("Failed to get songs after rescan");
    let final_count = response.text().unwrap().matches("<song ").count();

    eprintln!("Final song count after rescan: {}", final_count);

    // Clean up
    std::fs::remove_dir_all(&temp_dir).ok();

    // The counts should be equal - no songs should have been deleted
    assert_eq!(
        initial_count, final_count,
        "Full rescan should not delete songs from other folders! Had {} songs, now have {}",
        initial_count, final_count
    );
}
