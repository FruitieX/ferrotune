//! Bliss audio analysis for song similarity.
//!
//! This module provides functionality to analyze audio files using bliss-audio
//! and compute acoustic similarity between songs. Each song is represented as
//! a 23-dimensional feature vector covering tempo, spectral characteristics,
//! and chroma/harmonic content. Similarity is determined via euclidean distance
//! between these vectors.

use crate::db::raw;
use crate::error::{Error, Result};
use bliss_audio::decoder::symphonia::SymphoniaDecoder;
use bliss_audio::decoder::Decoder as BlissDecoder;
use bliss_audio::playlist::euclidean_distance;
use bliss_audio::{Analysis, FeaturesVersion, NUMBER_FEATURES};
use rand::seq::SliceRandom;
use std::path::Path;

/// Result of bliss audio analysis for a single track.
#[derive(Debug, Clone)]
pub struct BlissResult {
    /// Feature vector (23 f32 values).
    pub features: Vec<f32>,
    /// The bliss FeaturesVersion used for this analysis.
    pub version: i32,
}

/// Analyze an audio file and extract its bliss feature vector.
///
/// Uses bliss-audio's Symphonia decoder to decode and analyze the track,
/// extracting 23 acoustic features (tempo, spectral, chroma).
pub fn analyze_track(path: &Path) -> Result<BlissResult> {
    let song = SymphoniaDecoder::song_from_path(path).map_err(|e| {
        Error::Internal(format!(
            "Bliss analysis failed for {}: {}",
            path.display(),
            e
        ))
    })?;

    let features = song.analysis.as_vec();
    let version = match song.features_version {
        FeaturesVersion::Version1 => 1,
        FeaturesVersion::Version2 => 2,
    };

    Ok(BlissResult { features, version })
}

/// Serialize a bliss feature vector to bytes for BLOB storage.
/// Each f32 is stored as 4 bytes little-endian, producing a 92-byte BLOB.
pub fn features_to_blob(features: &[f32]) -> Vec<u8> {
    features.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Deserialize a BLOB back into a bliss feature vector.
pub fn blob_to_features(blob: &[u8]) -> Result<Vec<f32>> {
    if blob.len() != NUMBER_FEATURES * 4 {
        return Err(Error::Internal(format!(
            "Invalid bliss BLOB size: expected {} bytes, got {}",
            NUMBER_FEATURES * 4,
            blob.len()
        )));
    }

    Ok(blob
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

/// A song candidate with its bliss features, used for similarity queries.
struct SongCandidate {
    id: String,
    title: String,
    artist_id: String,
    features: Vec<f32>,
}

type BlissSeedRow = (Vec<u8>, String, String);
type BlissCandidateRow = (String, Vec<u8>, String, String);

/// Find the most similar songs to a seed song using bliss euclidean distance.
///
/// Loads all analyzed songs' feature vectors from the database, computes
/// euclidean distance against the seed song's features, and returns the
/// closest matches.
pub async fn find_similar_songs(
    database: &crate::db::Database,
    seed_song_id: &str,
    user_id: i64,
    count: usize,
) -> Result<Vec<(String, f32)>> {
    use sea_orm::{FromQueryResult, Value};

    #[derive(FromQueryResult)]
    struct SeedRow {
        bliss_features: Vec<u8>,
        title: String,
        artist_id: String,
    }
    #[derive(FromQueryResult)]
    struct CandidateRow {
        id: String,
        bliss_features: Vec<u8>,
        title: String,
        artist_id: String,
    }

    let seed_row = raw::query_one::<SeedRow>(
        database.conn(),
        "SELECT s.bliss_features, s.title, s.artist_id
         FROM songs s
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         WHERE s.id = ? AND s.bliss_features IS NOT NULL
           AND s.marked_for_deletion_at IS NULL
           AND mf.enabled = 1
           AND ula.user_id = ?",
        "SELECT s.bliss_features, s.title, s.artist_id
         FROM songs s
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         WHERE s.id = $1 AND s.bliss_features IS NOT NULL
           AND s.marked_for_deletion_at IS NULL
           AND mf.enabled
           AND ula.user_id = $2",
        [Value::from(seed_song_id.to_string()), Value::from(user_id)],
    )
    .await
    .map_err(|e| Error::Internal(format!("Failed to load seed song: {}", e)))?;

    let rows = raw::query_all::<CandidateRow>(
        database.conn(),
        "SELECT s.id, s.bliss_features, s.title, s.artist_id
         FROM songs s
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN disabled_songs ds ON ds.song_id = s.id AND ds.user_id = ?
         WHERE s.bliss_features IS NOT NULL
           AND s.id != ?
           AND s.marked_for_deletion_at IS NULL
           AND mf.enabled = 1
           AND ula.user_id = ?
           AND ds.id IS NULL",
        "SELECT s.id, s.bliss_features, s.title, s.artist_id
         FROM songs s
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN disabled_songs ds ON ds.song_id = s.id AND ds.user_id = $1
         WHERE s.bliss_features IS NOT NULL
           AND s.id != $2
           AND s.marked_for_deletion_at IS NULL
           AND mf.enabled
           AND ula.user_id = $3
           AND ds.id IS NULL",
        [
            Value::from(user_id),
            Value::from(seed_song_id.to_string()),
            Value::from(user_id),
        ],
    )
    .await
    .map_err(|e| Error::Internal(format!("Failed to load song features: {}", e)))?;

    let seed_row: Option<BlissSeedRow> = seed_row.map(|s| (s.bliss_features, s.title, s.artist_id));
    let rows: Vec<BlissCandidateRow> = rows
        .into_iter()
        .map(|r| (r.id, r.bliss_features, r.title, r.artist_id))
        .collect();

    let (seed_blob, seed_title, seed_artist_id) = seed_row.ok_or_else(|| {
        Error::NotFound(format!(
            "Song '{}' not found or has no bliss analysis",
            seed_song_id
        ))
    })?;

    let seed_features = blob_to_features(&seed_blob)?;
    let seed_analysis = Analysis::new(seed_features, FeaturesVersion::Version2)
        .map_err(|e| Error::Internal(format!("Failed to create seed analysis: {}", e)))?;
    let seed_arr = seed_analysis.as_arr1();

    // Convert to candidates
    let candidates: Vec<SongCandidate> = rows
        .into_iter()
        .filter_map(|(id, blob, title, artist_id)| {
            let features = blob_to_features(&blob).ok()?;
            Some(SongCandidate {
                id,
                title,
                artist_id,
                features,
            })
        })
        .collect();

    // Compute distances and sort
    let mut scored: Vec<(SongCandidate, f32)> = candidates
        .into_iter()
        .filter_map(|candidate| {
            let analysis =
                Analysis::new(candidate.features.clone(), FeaturesVersion::Version2).ok()?;
            let distance = euclidean_distance(&seed_arr, &analysis.as_arr1());
            Some((candidate, distance))
        })
        .collect();

    scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    // Dedup: skip near-duplicates (distance < 0.05) or same title+artist as seed
    let mut filtered: Vec<(SongCandidate, f32)> = scored
        .into_iter()
        .filter(|(candidate, distance)| {
            // Skip near-duplicates (likely same song, different version)
            if *distance < 0.05 {
                return false;
            }
            // Skip songs with same title and artist as seed
            if candidate.title == seed_title && candidate.artist_id == seed_artist_id {
                return false;
            }
            true
        })
        .collect();

    // Add randomness: take a pool of 3x the requested count from the top matches,
    // then shuffle the pool and pick the requested count. This ensures results
    // are still similar to the seed but vary between calls.
    let pool_size = (count * 3).min(filtered.len());
    filtered.truncate(pool_size);

    let mut rng = rand::thread_rng();
    filtered.shuffle(&mut rng);

    let results: Vec<(String, f32)> = filtered
        .into_iter()
        .take(count)
        .map(|(candidate, distance)| (candidate.id, distance))
        .collect();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_features_blob_roundtrip() {
        let features: Vec<f32> = (0..NUMBER_FEATURES).map(|i| i as f32 * 0.1).collect();
        let blob = features_to_blob(&features);
        assert_eq!(blob.len(), NUMBER_FEATURES * 4);

        let restored = blob_to_features(&blob).unwrap();
        assert_eq!(features.len(), restored.len());
        for (a, b) in features.iter().zip(restored.iter()) {
            assert!((a - b).abs() < f32::EPSILON);
        }
    }

    #[test]
    fn test_blob_to_features_invalid_size() {
        let blob = vec![0u8; 10]; // Wrong size
        assert!(blob_to_features(&blob).is_err());
    }
}
