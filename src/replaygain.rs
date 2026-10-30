//! ReplayGain analysis using EBU R128 loudness measurement.
//!
//! This module provides functionality to analyze audio files and compute
//! ReplayGain track gain and peak values. Uses the ebur128 crate for
//! ITU-R BS.1770 / EBU R128 compliant loudness measurement.
//!
//! Reference level: -14 LUFS
//! Note: Traditional ReplayGain uses -18 LUFS (RG 1.0) or -14 LUFS (RG 2.0).
//!
//! The decode loop lives in [`crate::analysis::analyze_track`], which computes
//! ReplayGain and waveform data in a single pass.

/// EBU R128 reference loudness level in LUFS
pub const REFERENCE_LOUDNESS: f64 = -14.0;

/// Result of ReplayGain analysis
#[derive(Debug, Clone)]
pub struct ReplayGainResult {
    /// Track gain in dB (relative to -23 LUFS reference)
    pub track_gain: f64,
    /// True peak in linear scale (0.0 to 1.0+, can exceed 1.0 for clipped audio)
    pub track_peak: f64,
}
