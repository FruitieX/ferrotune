//! Waveform generation endpoint.
//!
//! Generates waveform data by decoding audio and computing RMS values
//! for visualization purposes. Uses streaming to return data progressively.
//!
//! Memory-efficient: Uses streaming processing to avoid loading entire
//! audio files into memory. For a 2-hour mix, memory usage is ~O(resolution)
//! instead of O(file_duration * sample_rate).

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiResult, Result};
use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::LazyLock;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{CodecRegistry, DecoderOptions};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia_adapter_libopus::OpusDecoder;

/// Custom codec registry that includes Opus support via libopus adapter.
static CODEC_REGISTRY: LazyLock<CodecRegistry> = LazyLock::new(|| {
    let mut registry = CodecRegistry::new();
    // Register the libopus decoder for Opus support
    registry.register_all::<OpusDecoder>();
    // Register all default symphonia codecs
    symphonia::default::register_enabled_codecs(&mut registry);
    registry
});
use tokio::sync::mpsc;
use ts_rs::TS;

/// Query parameters for waveform endpoint.
#[derive(Deserialize)]
pub struct WaveformQuery {
    /// Number of bars/samples in the waveform (default: 200)
    #[serde(default = "default_resolution")]
    resolution: usize,
}

fn default_resolution() -> usize {
    200
}

/// Streaming chunk for progressive waveform loading.
#[derive(Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct WaveformChunk {
    /// Chunk index (0-based)
    pub chunk_index: usize,
    /// Total number of chunks
    pub total_chunks: usize,
    /// Raw RMS values for this chunk (NOT normalized - client normalizes across all chunks)
    pub rms_values: Vec<f32>,
    /// Whether this is the last chunk
    pub done: bool,
}

/// Get waveform data as a Server-Sent Events stream.
///
/// Returns chunks of waveform data as audio is decoded, allowing the client
/// to progressively render the waveform.
pub async fn get_waveform_stream(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
    Query(params): Query<WaveformQuery>,
) -> FerrotuneApiResult<Sse<impl Stream<Item = std::result::Result<Event, Infallible>>>> {
    let resolution = params.resolution.clamp(10, 1000);

    // Get song from database
    let song = crate::db::queries::get_song_by_id(&state.pool, &song_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Song {} not found", song_id)))?;

    // Check if user has access to this song's library
    if !crate::api::ferrotune::users::user_has_song_access(&state.pool, user.user_id, &song_id)
        .await?
    {
        return Err(Error::Forbidden(format!("You do not have access to song {}", song_id)).into());
    }

    // Find the music folder for this song
    let music_folders = crate::db::queries::get_music_folders(&state.pool).await?;

    let mut full_path: Option<PathBuf> = None;
    for folder in &music_folders {
        let candidate = PathBuf::from(&folder.path).join(&song.file_path);
        if candidate.exists() {
            full_path = Some(candidate);
            break;
        }
    }

    let full_path =
        full_path.ok_or_else(|| Error::NotFound(format!("File not found: {}", song.file_path)))?;

    // Security: Ensure the resolved path is still within a music folder (from database)
    let canonical_path = full_path
        .canonicalize()
        .map_err(|_| Error::NotFound("File not found".to_string()))?;

    let mut is_within_folder = false;
    for folder in &music_folders {
        if let Ok(canonical_folder) = PathBuf::from(&folder.path).canonicalize() {
            if canonical_path.starts_with(&canonical_folder) {
                is_within_folder = true;
                break;
            }
        }
    }

    if !is_within_folder {
        tracing::warn!(
            "Attempted path traversal: requested {}, resolved to {}",
            song.file_path,
            canonical_path.display()
        );
        return Err(Error::NotFound("File not found".to_string()).into());
    }

    // Create channel for streaming chunks
    let (tx, rx) = mpsc::channel::<WaveformChunk>(16);

    // Spawn blocking task to decode audio and send chunks
    tokio::task::spawn_blocking(move || {
        let _ = generate_waveform_streaming(&full_path, resolution, tx);
    });

    // Convert receiver to stream
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let sse_stream = futures::stream::StreamExt::map(stream, |chunk| {
        let data = serde_json::to_string(&chunk).unwrap_or_default();
        Ok(Event::default().data(data))
    });

    Ok(Sse::new(sse_stream).keep_alive(KeepAlive::default()))
}

/// Generate waveform data progressively, sending chunks via channel.
///
/// Memory-efficient: Uses fixed-size chunks (in seconds of audio) and processes
/// incrementally without accumulating all samples. Each chunk computes RMS values
/// directly from decoded audio and immediately discards the sample data.
fn generate_waveform_streaming(
    path: &std::path::Path,
    resolution: usize,
    tx: mpsc::Sender<WaveformChunk>,
) -> Result<()> {
    // Fixed chunk size: 30 seconds of audio per chunk
    const CHUNK_DURATION_SECS: u64 = 30;

    let file = std::fs::File::open(path)
        .map_err(|e| Error::NotFound(format!("Could not open file: {}", e)))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| Error::InvalidRequest(format!("Could not probe audio format: {}", e)))?;

    let mut format = probed.format;

    let track = format
        .default_track()
        .ok_or_else(|| Error::InvalidRequest("No audio track found".to_string()))?;

    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let n_frames = track.codec_params.n_frames;

    // Calculate samples per chunk (fixed duration)
    let samples_per_chunk = (sample_rate as u64 * CHUNK_DURATION_SECS) as usize;

    // Estimate total samples and total chunks
    let estimated_samples = n_frames.unwrap_or(sample_rate as u64 * 300) as usize;
    let estimated_total_chunks = estimated_samples.div_ceil(samples_per_chunk);

    let mut decoder = CODEC_REGISTRY
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| Error::InvalidRequest(format!("Could not create decoder: {}", e)))?;

    // State for incremental processing within a chunk
    let mut current_chunk = 0;
    let mut samples_in_current_chunk: usize = 0;

    // RMS accumulator for current bar within the chunk
    let mut bar_sum: f64 = 0.0;
    let mut bar_count: usize = 0;

    // RMS values for current chunk
    let mut chunk_rms_values: Vec<f32> = Vec::new();

    // Decode packets and process incrementally
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => {
                tracing::warn!("Error reading packet: {}", e);
                break;
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let duration = decoded.capacity() as u64;
        let mut sample_buf = SampleBuffer::<f32>::new(duration, spec);
        sample_buf.copy_interleaved_ref(decoded);

        let channels = spec.channels.count().max(1);
        let samples = sample_buf.samples();

        // Process samples - combine all channels by averaging
        // Samples are interleaved: [L0, R0, L1, R1, ...] for stereo
        let mut frame_idx = 0;
        while frame_idx * channels < samples.len() {
            // Average all channels for this frame
            let mut frame_sum: f64 = 0.0;
            for ch in 0..channels {
                let sample_idx = frame_idx * channels + ch;
                if sample_idx < samples.len() {
                    let sample = samples[sample_idx] as f64;
                    frame_sum += sample * sample;
                }
            }
            // RMS of the frame (sqrt of mean of squared samples across channels)
            let frame_rms_squared = frame_sum / channels as f64;

            // Accumulate for current bar
            bar_sum += frame_rms_squared;
            bar_count += 1;
            samples_in_current_chunk += 1;
            frame_idx += 1;

            // Calculate bars per chunk based on progress
            let chunk_start_ratio =
                (current_chunk * samples_per_chunk) as f64 / estimated_samples as f64;
            let chunk_end_ratio =
                ((current_chunk + 1) * samples_per_chunk) as f64 / estimated_samples as f64;
            let bar_start = (chunk_start_ratio * resolution as f64).floor() as usize;
            let bar_end = (chunk_end_ratio * resolution as f64).ceil() as usize;
            let bars_in_chunk = bar_end.saturating_sub(bar_start).max(1);
            let samples_per_bar_in_chunk = samples_per_chunk / bars_in_chunk;

            // Check if we've completed a bar within this chunk
            let current_bar_in_chunk = chunk_rms_values.len();
            if samples_per_bar_in_chunk > 0
                && bar_count >= samples_per_bar_in_chunk
                && current_bar_in_chunk < bars_in_chunk
            {
                let rms = (bar_sum / bar_count as f64).sqrt() as f32;
                chunk_rms_values.push(rms);
                bar_sum = 0.0;
                bar_count = 0;
            }

            // Check if we've completed a chunk
            if samples_in_current_chunk >= samples_per_chunk {
                // Finalize any remaining bar data
                if bar_count > 0 {
                    let rms = (bar_sum / bar_count as f64).sqrt() as f32;
                    chunk_rms_values.push(rms);
                    bar_sum = 0.0;
                    bar_count = 0;
                }

                // Ensure we have at least one value
                if chunk_rms_values.is_empty() {
                    chunk_rms_values.push(0.0);
                }

                let chunk = WaveformChunk {
                    chunk_index: current_chunk,
                    total_chunks: estimated_total_chunks,
                    rms_values: std::mem::take(&mut chunk_rms_values),
                    done: false,
                };

                let _ = tx.blocking_send(chunk);
                current_chunk += 1;
                samples_in_current_chunk = 0;
            }
        }
    }

    // Send final chunk with remaining data
    if bar_count > 0 {
        let rms = (bar_sum / bar_count as f64).sqrt() as f32;
        chunk_rms_values.push(rms);
    }

    if !chunk_rms_values.is_empty() || current_chunk == 0 {
        let chunk = WaveformChunk {
            chunk_index: current_chunk,
            total_chunks: current_chunk + 1,
            rms_values: if chunk_rms_values.is_empty() {
                vec![0.0; resolution]
            } else {
                chunk_rms_values
            },
            done: true,
        };
        let _ = tx.blocking_send(chunk);
    } else {
        // Send done signal
        let chunk = WaveformChunk {
            chunk_index: current_chunk,
            total_chunks: current_chunk,
            rms_values: vec![],
            done: true,
        };
        let _ = tx.blocking_send(chunk);
    }

    Ok(())
}
