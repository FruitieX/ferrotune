//! Waveform generation endpoint.
//!
//! Generates waveform data by decoding audio and computing RMS values
//! for visualization purposes. Supports both batch and streaming modes.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, Result};
use axum::{
    extract::{Path, Query, State},
    response::{
        sse::{Event, KeepAlive, Sse},
        Json,
    },
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tokio::sync::mpsc;

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

/// Waveform response.
#[derive(Serialize)]
pub struct WaveformResponse {
    /// Normalized heights (0.0 to 1.0) for each bar
    pub heights: Vec<f32>,
    /// Peak RMS value found (useful for debugging)
    pub peak_rms: f32,
}

/// Streaming chunk for progressive waveform loading.
#[derive(Serialize)]
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

/// Get waveform data for a song.
///
/// Returns an array of normalized amplitude values that can be used
/// to render a waveform visualization.
pub async fn get_waveform(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
    Query(params): Query<WaveformQuery>,
) -> Result<Json<WaveformResponse>> {
    let resolution = params.resolution.clamp(10, 1000);

    // Get song from database
    let song = crate::db::queries::get_song_by_id(&state.pool, &song_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Song {} not found", song_id)))?;

    // Find the music folder for this song
    let music_folders = crate::db::queries::get_music_folders(&state.pool).await?;

    let mut full_path: Option<PathBuf> = None;
    for folder in music_folders {
        let candidate = PathBuf::from(&folder.path).join(&song.file_path);
        if candidate.exists() {
            full_path = Some(candidate);
            break;
        }
    }

    let full_path =
        full_path.ok_or_else(|| Error::NotFound(format!("File not found: {}", song.file_path)))?;

    // Generate waveform in blocking task (audio decoding is CPU-intensive)
    let waveform = tokio::task::spawn_blocking(move || generate_waveform(&full_path, resolution))
        .await
        .map_err(|e| Error::InvalidRequest(format!("Waveform generation failed: {}", e)))??;

    Ok(Json(waveform))
}

/// Get waveform data as a Server-Sent Events stream.
///
/// Returns chunks of waveform data as audio is decoded, allowing the client
/// to progressively render the waveform.
pub async fn get_waveform_stream(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
    Query(params): Query<WaveformQuery>,
) -> Result<Sse<impl Stream<Item = std::result::Result<Event, Infallible>>>> {
    let resolution = params.resolution.clamp(10, 1000);

    // Get song from database
    let song = crate::db::queries::get_song_by_id(&state.pool, &song_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Song {} not found", song_id)))?;

    // Find the music folder for this song
    let music_folders = crate::db::queries::get_music_folders(&state.pool).await?;

    let mut full_path: Option<PathBuf> = None;
    for folder in music_folders {
        let candidate = PathBuf::from(&folder.path).join(&song.file_path);
        if candidate.exists() {
            full_path = Some(candidate);
            break;
        }
    }

    let full_path =
        full_path.ok_or_else(|| Error::NotFound(format!("File not found: {}", song.file_path)))?;

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

/// Generate waveform data from an audio file.
fn generate_waveform(path: &std::path::Path, resolution: usize) -> Result<WaveformResponse> {
    // Open the audio file
    let file = std::fs::File::open(path)
        .map_err(|e| Error::NotFound(format!("Could not open file: {}", e)))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Create a hint based on file extension
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    // Probe the format
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| Error::InvalidRequest(format!("Could not probe audio format: {}", e)))?;

    let mut format = probed.format;

    // Get the default track
    let track = format
        .default_track()
        .ok_or_else(|| Error::InvalidRequest("No audio track found".to_string()))?;

    let track_id = track.id;

    // Create a decoder
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| Error::InvalidRequest(format!("Could not create decoder: {}", e)))?;

    // Collect all samples
    let mut all_samples: Vec<f32> = Vec::new();

    // Decode all packets
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::ResetRequired) => {
                // Reset the decoder
                decoder.reset();
                continue;
            }
            Err(e) => {
                tracing::warn!("Error reading packet: {}", e);
                break;
            }
        };

        // Skip packets from other tracks
        if packet.track_id() != track_id {
            continue;
        }

        // Decode the packet
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(symphonia::core::errors::Error::DecodeError(e)) => {
                tracing::warn!("Decode error: {}", e);
                continue;
            }
            Err(e) => {
                tracing::warn!("Error decoding: {}", e);
                continue;
            }
        };

        // Get the audio specification
        let spec = *decoded.spec();

        // Create a sample buffer
        let duration = decoded.capacity() as u64;
        let mut sample_buf = SampleBuffer::<f32>::new(duration, spec);

        // Copy samples to buffer
        sample_buf.copy_interleaved_ref(decoded);

        // Take first channel only (or average channels if we want)
        let channels = spec.channels.count();
        let samples = sample_buf.samples();

        for (i, &sample) in samples.iter().enumerate() {
            // Take only first channel for simplicity
            if i % channels == 0 {
                all_samples.push(sample);
            }
        }
    }

    if all_samples.is_empty() {
        return Ok(WaveformResponse {
            heights: vec![0.15; resolution],
            peak_rms: 0.0,
        });
    }

    // Calculate RMS for each bar
    let samples_per_bar = all_samples.len() / resolution;
    if samples_per_bar == 0 {
        return Ok(WaveformResponse {
            heights: vec![0.15; resolution],
            peak_rms: 0.0,
        });
    }

    let mut raw_rms: Vec<f32> = Vec::with_capacity(resolution);
    let mut peak_rms: f32 = 0.0;

    for i in 0..resolution {
        let start = i * samples_per_bar;
        let end = ((i + 1) * samples_per_bar).min(all_samples.len());

        // Calculate RMS for this segment
        let mut sum: f64 = 0.0;
        let mut count = 0;

        for &sample in &all_samples[start..end] {
            sum += (sample as f64) * (sample as f64);
            count += 1;
        }

        let rms = if count > 0 {
            (sum / count as f64).sqrt() as f32
        } else {
            0.0
        };

        if rms > peak_rms {
            peak_rms = rms;
        }

        raw_rms.push(rms);
    }

    // Normalize using logarithmic scaling
    let heights: Vec<f32> = raw_rms
        .iter()
        .map(|&rms| {
            if rms <= 0.0 || peak_rms <= 0.0 {
                return 0.15; // Minimum height
            }

            // Normalize relative to peak
            let normalized = rms / peak_rms;

            // Apply logarithmic curve for better dynamics
            let log_scaled = (1.0 + normalized * 9.0).log10();

            // Map to visual height range (0.15 to 1.0)
            let height = 0.15 + log_scaled * 0.85;

            height.clamp(0.15, 1.0)
        })
        .collect();

    Ok(WaveformResponse { heights, peak_rms })
}

/// Generate waveform data progressively, sending chunks via channel.
fn generate_waveform_streaming(
    path: &std::path::Path,
    resolution: usize,
    tx: mpsc::Sender<WaveformChunk>,
) -> Result<()> {
    // Number of chunks to send (each chunk contains a portion of the waveform)
    const NUM_CHUNKS: usize = 8;
    let bars_per_chunk = resolution / NUM_CHUNKS;

    // Open the audio file
    let file = std::fs::File::open(path)
        .map_err(|e| Error::NotFound(format!("Could not open file: {}", e)))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Create a hint based on file extension
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    // Probe the format
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| Error::InvalidRequest(format!("Could not probe audio format: {}", e)))?;

    let mut format = probed.format;

    // Get the default track
    let track = format
        .default_track()
        .ok_or_else(|| Error::InvalidRequest("No audio track found".to_string()))?;

    let track_id = track.id;

    // Estimate total samples from duration if available
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let n_frames = track.codec_params.n_frames;
    let estimated_samples = n_frames.unwrap_or(sample_rate as u64 * 300) as usize; // Default to 5 mins
    let samples_per_chunk = estimated_samples / NUM_CHUNKS;

    // Create a decoder
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| Error::InvalidRequest(format!("Could not create decoder: {}", e)))?;

    let mut all_samples: Vec<f32> = Vec::new();
    let mut current_chunk = 0;

    // Decode packets and send chunks as we go
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

        let channels = spec.channels.count();
        let samples = sample_buf.samples();

        for (i, &sample) in samples.iter().enumerate() {
            if i % channels == 0 {
                all_samples.push(sample);
            }
        }

        // Check if we have enough samples for the next chunk
        while current_chunk < NUM_CHUNKS - 1
            && all_samples.len() >= samples_per_chunk * (current_chunk + 1)
        {
            let chunk_rms = compute_chunk_raw_rms(
                &all_samples,
                current_chunk * samples_per_chunk,
                (current_chunk + 1) * samples_per_chunk,
                bars_per_chunk,
            );

            let chunk = WaveformChunk {
                chunk_index: current_chunk,
                total_chunks: NUM_CHUNKS,
                rms_values: chunk_rms,
                done: false,
            };

            // Send chunk (ignore errors if receiver is gone)
            let _ = tx.blocking_send(chunk);
            current_chunk += 1;
        }
    }

    // Process remaining samples and send final chunk(s)
    while current_chunk < NUM_CHUNKS {
        let remaining_bars = if current_chunk == NUM_CHUNKS - 1 {
            resolution - current_chunk * bars_per_chunk
        } else {
            bars_per_chunk
        };

        let start_sample = current_chunk * samples_per_chunk;
        let end_sample = if current_chunk == NUM_CHUNKS - 1 {
            all_samples.len()
        } else {
            (current_chunk + 1) * samples_per_chunk
        };

        let chunk_rms = compute_chunk_raw_rms(
            &all_samples,
            start_sample.min(all_samples.len()),
            end_sample.min(all_samples.len()),
            remaining_bars,
        );

        let chunk = WaveformChunk {
            chunk_index: current_chunk,
            total_chunks: NUM_CHUNKS,
            rms_values: chunk_rms,
            done: current_chunk == NUM_CHUNKS - 1,
        };

        let _ = tx.blocking_send(chunk);
        current_chunk += 1;
    }

    Ok(())
}

/// Compute raw RMS values for a chunk of samples (no normalization).
fn compute_chunk_raw_rms(samples: &[f32], start: usize, end: usize, num_bars: usize) -> Vec<f32> {
    if start >= end || num_bars == 0 || samples.is_empty() {
        return vec![0.0; num_bars];
    }

    let chunk_samples = &samples[start.min(samples.len())..end.min(samples.len())];
    if chunk_samples.is_empty() {
        return vec![0.0; num_bars];
    }

    let samples_per_bar = chunk_samples.len() / num_bars;
    if samples_per_bar == 0 {
        return vec![0.0; num_bars];
    }

    let mut raw_rms: Vec<f32> = Vec::with_capacity(num_bars);

    for i in 0..num_bars {
        let bar_start = i * samples_per_bar;
        let bar_end = ((i + 1) * samples_per_bar).min(chunk_samples.len());

        let mut sum: f64 = 0.0;
        let mut count = 0;

        for &sample in &chunk_samples[bar_start..bar_end] {
            sum += (sample as f64) * (sample as f64);
            count += 1;
        }

        let rms = if count > 0 {
            (sum / count as f64).sqrt() as f32
        } else {
            0.0
        };

        raw_rms.push(rms);
    }

    raw_rms
}
