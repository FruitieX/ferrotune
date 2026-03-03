//! Shared audio analysis module.
//!
//! Provides a single-pass audio decode loop that can simultaneously compute:
//! - ReplayGain (EBU R128 loudness + true peak)
//! - Waveform data (RMS values for visualization)
//!
//! This avoids decoding the same audio file multiple times when both analyses
//! are requested during scanning.

use crate::error::{Error, Result};
use crate::replaygain::{ReplayGainResult, REFERENCE_LOUDNESS};
use std::path::Path;
use std::sync::LazyLock;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{CodecRegistry, DecoderOptions};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia_adapter_libopus::OpusDecoder;

/// Custom codec registry that includes Opus support via libopus adapter.
pub static CODEC_REGISTRY: LazyLock<CodecRegistry> = LazyLock::new(|| {
    let mut registry = CodecRegistry::new();
    registry.register_all::<OpusDecoder>();
    symphonia::default::register_enabled_codecs(&mut registry);
    registry
});

/// Number of waveform bars to compute during scanning.
pub const WAVEFORM_RESOLUTION: usize = 500;

/// Fine-grained window size for accurate RMS computation (~46ms at 44100 Hz).
const FINE_WINDOW_FRAMES: usize = 2048;

/// Result of combined audio analysis.
#[derive(Debug, Clone)]
pub struct AnalysisResult {
    pub replaygain: Option<ReplayGainResult>,
    pub waveform: Option<Vec<u8>>,
}

/// Serialize waveform heights (f32 values) to bytes for BLOB storage.
/// Each f32 is stored as 4 bytes little-endian.
pub fn waveform_to_blob(heights: &[f32]) -> Vec<u8> {
    heights.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Deserialize a waveform BLOB back into f32 height values.
pub fn blob_to_waveform(blob: &[u8]) -> Result<Vec<f32>> {
    if !blob.len().is_multiple_of(4) {
        return Err(Error::Internal(format!(
            "Invalid waveform BLOB size: {} bytes (not a multiple of 4)",
            blob.len()
        )));
    }
    Ok(blob
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

/// Analyze an audio file in a single decode pass.
///
/// Computes ReplayGain and/or waveform data depending on which are requested.
/// When both are requested, the file is decoded only once.
pub fn analyze_track(
    path: &Path,
    compute_replaygain: bool,
    compute_waveform: bool,
) -> Result<AnalysisResult> {
    if !compute_replaygain && !compute_waveform {
        return Ok(AnalysisResult {
            replaygain: None,
            waveform: None,
        });
    }

    let file = std::fs::File::open(path)
        .map_err(|e| Error::Internal(format!("Could not open file for analysis: {}", e)))?;

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
        .map_err(|e| Error::Internal(format!("Could not probe audio format: {}", e)))?;

    let mut format = probed.format;

    let track = format
        .default_track()
        .ok_or_else(|| Error::Internal("No audio track found".to_string()))?;

    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);

    let mut decoder = CODEC_REGISTRY
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| Error::Internal(format!("Could not create decoder: {}", e)))?;

    // ReplayGain state
    let mut ebur128 = if compute_replaygain {
        Some(
            ebur128::EbuR128::new(
                channels as u32,
                sample_rate,
                ebur128::Mode::I | ebur128::Mode::TRUE_PEAK,
            )
            .map_err(|e| Error::Internal(format!("Could not create EBU R128 meter: {:?}", e)))?,
        )
    } else {
        None
    };

    // Waveform state: fine-grained RMS windows
    let mut fine_windows: Vec<f64> = if compute_waveform {
        Vec::with_capacity(1024)
    } else {
        Vec::new()
    };
    let mut fine_sq_sum: f64 = 0.0;
    let mut fine_count: usize = 0;

    // Decode loop
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
                tracing::warn!("Error reading packet during analysis: {}", e);
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

        let actual_channels = spec.channels.count().max(1);
        let samples = sample_buf.samples();

        // Feed to EBU R128 meter (uses interleaved samples directly)
        if let Some(ref mut meter) = ebur128 {
            meter
                .add_frames_f32(samples)
                .map_err(|e| Error::Internal(format!("EBU R128 add_frames error: {:?}", e)))?;
        }

        // Accumulate waveform RMS windows
        if compute_waveform {
            let mut frame_idx = 0;
            while frame_idx * actual_channels < samples.len() {
                let mut frame_sum: f64 = 0.0;
                for ch in 0..actual_channels {
                    let sample_idx = frame_idx * actual_channels + ch;
                    if sample_idx < samples.len() {
                        let sample = samples[sample_idx] as f64;
                        frame_sum += sample * sample;
                    }
                }
                let frame_rms_squared = frame_sum / actual_channels as f64;

                fine_sq_sum += frame_rms_squared;
                fine_count += 1;
                if fine_count >= FINE_WINDOW_FRAMES {
                    fine_windows.push(fine_sq_sum / fine_count as f64);
                    fine_sq_sum = 0.0;
                    fine_count = 0;
                }

                frame_idx += 1;
            }
        }
    }

    // Compute ReplayGain result
    let replaygain = if let Some(meter) = ebur128 {
        let loudness = meter
            .loudness_global()
            .map_err(|e| Error::Internal(format!("Could not get loudness: {:?}", e)))?;

        let track_gain = REFERENCE_LOUDNESS - loudness;

        let mut max_peak = 0.0f64;
        for channel in 0..channels {
            let peak = meter
                .true_peak(channel as u32)
                .map_err(|e| Error::Internal(format!("Could not get true peak: {:?}", e)))?;
            if peak > max_peak {
                max_peak = peak;
            }
        }

        Some(ReplayGainResult {
            track_gain,
            track_peak: max_peak,
        })
    } else {
        None
    };

    // Compute waveform result
    let waveform = if compute_waveform {
        // Flush last partial window
        if fine_count > 0 {
            fine_windows.push(fine_sq_sum / fine_count as f64);
        }

        let rms_values = downsample_fine_windows(&fine_windows, WAVEFORM_RESOLUTION);
        let heights = normalize_rms_to_heights(&rms_values);
        Some(waveform_to_blob(&heights))
    } else {
        None
    };

    Ok(AnalysisResult {
        replaygain,
        waveform,
    })
}

/// Downsample fine-grained RMS windows to exactly `target` bars.
///
/// Each input window contains the mean of squared sample values.
/// Output bars are the RMS (sqrt of mean of squared) of combined windows.
fn downsample_fine_windows(windows: &[f64], target: usize) -> Vec<f32> {
    let n = windows.len();
    if n == 0 {
        return vec![0.0; target];
    }
    let mut result = Vec::with_capacity(target);
    for i in 0..target {
        let start = i * n / target;
        let end = ((i + 1) * n / target).min(n);
        if start >= end {
            result.push(result.last().copied().unwrap_or(0.0));
            continue;
        }
        let mean_sq: f64 = windows[start..end].iter().sum::<f64>() / (end - start) as f64;
        result.push(mean_sq.sqrt() as f32);
    }
    result
}

/// Normalize RMS values to visual heights using logarithmic scaling.
///
/// Matches the client-side normalization logic: dB compression with
/// configurable floor, mapping to a height range of [MIN_HEIGHT, 1.0].
fn normalize_rms_to_heights(rms_values: &[f32]) -> Vec<f32> {
    const MIN_HEIGHT: f32 = 0.15;
    const DB_MIN: f32 = -10.0;

    let peak_rms = rms_values.iter().copied().fold(0.0f32, |a, b| a.max(b));

    rms_values
        .iter()
        .map(|&rms| {
            if rms <= 0.0 || peak_rms <= 0.0 {
                return MIN_HEIGHT;
            }

            let normalized = rms / peak_rms;
            let db = 20.0 * normalized.max(1e-6).log10();
            let db_normalized = ((db - DB_MIN) / -DB_MIN).clamp(0.0, 1.0);

            MIN_HEIGHT + db_normalized * (1.0 - MIN_HEIGHT)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_waveform_blob_roundtrip() {
        let heights = vec![0.15, 0.5, 1.0, 0.3, 0.75];
        let blob = waveform_to_blob(&heights);
        let restored = blob_to_waveform(&blob).unwrap();
        assert_eq!(heights, restored);
    }

    #[test]
    fn test_waveform_blob_invalid_size() {
        let blob = vec![1, 2, 3]; // not a multiple of 4
        assert!(blob_to_waveform(&blob).is_err());
    }

    #[test]
    fn test_downsample_fine_windows() {
        let windows = vec![0.01, 0.04, 0.09, 0.16]; // mean-squared values
        let result = downsample_fine_windows(&windows, 2);
        assert_eq!(result.len(), 2);
        // First bar: mean of [0.01, 0.04] = 0.025, sqrt = ~0.158
        assert!((result[0] - 0.158).abs() < 0.01);
        // Second bar: mean of [0.09, 0.16] = 0.125, sqrt = ~0.354
        assert!((result[1] - 0.354).abs() < 0.01);
    }

    #[test]
    fn test_normalize_rms_to_heights() {
        let rms = vec![0.0, 0.5, 1.0];
        let heights = normalize_rms_to_heights(&rms);
        assert_eq!(heights.len(), 3);
        assert_eq!(heights[0], 0.15); // silence → minimum
        assert_eq!(heights[2], 1.0); // peak → maximum
        assert!(heights[1] > 0.15 && heights[1] < 1.0); // mid value
    }

    #[test]
    fn test_downsample_empty() {
        let result = downsample_fine_windows(&[], 5);
        assert_eq!(result, vec![0.0; 5]);
    }
}
