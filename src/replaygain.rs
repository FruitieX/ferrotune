//! ReplayGain analysis using EBU R128 loudness measurement.
//!
//! This module provides functionality to analyze audio files and compute
//! ReplayGain track gain and peak values. Uses the ebur128 crate for
//! ITU-R BS.1770 / EBU R128 compliant loudness measurement.
//!
//! Reference level: -14 LUFS
//! Note: Traditional ReplayGain uses -18 LUFS (RG 1.0) or -14 LUFS (RG 2.0),

use crate::error::{Error, Result};
use ebur128::{EbuR128, Mode};
use std::path::Path;
use std::sync::LazyLock;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{CodecRegistry, DecoderOptions};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia_adapter_libopus::OpusDecoder;

/// EBU R128 reference loudness level in LUFS
const REFERENCE_LOUDNESS: f64 = -14.0;

/// Custom codec registry that includes Opus support via libopus adapter.
/// Shared with waveform.rs and transcoding.rs.
static CODEC_REGISTRY: LazyLock<CodecRegistry> = LazyLock::new(|| {
    let mut registry = CodecRegistry::new();
    // Register the libopus decoder for Opus support
    registry.register_all::<OpusDecoder>();
    // Register all default symphonia codecs
    symphonia::default::register_enabled_codecs(&mut registry);
    registry
});

/// Result of ReplayGain analysis
#[derive(Debug, Clone)]
pub struct ReplayGainResult {
    /// Track gain in dB (relative to -23 LUFS reference)
    pub track_gain: f64,
    /// True peak in linear scale (0.0 to 1.0+, can exceed 1.0 for clipped audio)
    pub track_peak: f64,
}

/// Analyze an audio file and compute ReplayGain track gain and peak values.
///
/// This function decodes the entire audio file and uses EBU R128 loudness
/// measurement to compute the track gain. The gain is calculated as the
/// difference between the reference loudness (-23 LUFS) and the measured
/// integrated loudness of the track.
///
/// # Arguments
/// * `path` - Path to the audio file to analyze
///
/// # Returns
/// * `Ok(ReplayGainResult)` - Contains track_gain (in dB) and track_peak (linear)
/// * `Err` - If the file cannot be opened, decoded, or analyzed
pub fn analyze_track(path: &Path) -> Result<ReplayGainResult> {
    // Open source file
    let file = std::fs::File::open(path).map_err(|e| {
        Error::Internal(format!(
            "Could not open file for ReplayGain analysis: {}",
            e
        ))
    })?;

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
        .map_err(|e| {
            Error::Internal(format!(
                "Could not probe audio format for ReplayGain: {}",
                e
            ))
        })?;

    let mut format = probed.format;

    let track = format.default_track().ok_or_else(|| {
        Error::Internal("No audio track found for ReplayGain analysis".to_string())
    })?;

    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);

    let mut decoder = CODEC_REGISTRY
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| Error::Internal(format!("Could not create decoder for ReplayGain: {}", e)))?;

    // Create EBU R128 loudness meter
    // Use Mode::I for integrated loudness and Mode::TruePeak for true peak measurement
    let mut ebur128 = EbuR128::new(channels as u32, sample_rate, Mode::I | Mode::TRUE_PEAK)
        .map_err(|e| Error::Internal(format!("Could not create EBU R128 meter: {:?}", e)))?;

    // Decode loop - feed all samples to the loudness meter
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
                tracing::warn!("Error reading packet during ReplayGain analysis: {}", e);
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

        let samples = sample_buf.samples();

        // Feed interleaved samples to the EBU R128 meter
        // ebur128 expects interleaved f32 samples
        ebur128
            .add_frames_f32(samples)
            .map_err(|e| Error::Internal(format!("EBU R128 add_frames error: {:?}", e)))?;
    }

    // Get the integrated loudness (LUFS)
    let loudness = ebur128
        .loudness_global()
        .map_err(|e| Error::Internal(format!("Could not get loudness: {:?}", e)))?;

    // Calculate track gain: reference level - measured loudness
    // A negative loudness means the track is louder than reference, so gain should be negative
    let track_gain = REFERENCE_LOUDNESS - loudness;

    // Get the true peak (maximum of all channels)
    let mut max_peak = 0.0f64;
    for channel in 0..channels {
        let peak = ebur128
            .true_peak(channel as u32)
            .map_err(|e| Error::Internal(format!("Could not get true peak: {:?}", e)))?;
        if peak > max_peak {
            max_peak = peak;
        }
    }

    Ok(ReplayGainResult {
        track_gain,
        track_peak: max_peak,
    })
}
