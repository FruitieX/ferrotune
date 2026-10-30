//! Streaming audio transcoding to Opus.
//!
//! Real-time transcoding of audio files to Opus format.
//!
//! Pipeline: [Input File] → [Symphonia Decoder] → [Rubato Resampler] → [Audiopus Encoder] → [Ogg Muxer] → [HTTP Stream]

#![allow(dead_code)]

use crate::error::{Error, Result};
use audiopus::coder::Encoder as OpusEncoder;
use audiopus::{Application, Bitrate, Channels, SampleRate};
use axum::{
    body::Body,
    http::{header, StatusCode},
    response::Response,
};
use ogg::writing::PacketWriter;
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Indexing, Resampler};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::analysis::{open_audio_source, AudioOpenError, AudioSource};

/// Internal transcode parameters (encoded in transcode_params string).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TranscodeConfig {
    /// Song ID (for verification)
    pub song_id: String,
    /// Target bitrate in bps (e.g., 128000)
    pub bitrate: u32,
    /// Target sample rate (always 48000 for Opus)
    pub sample_rate: u32,
    /// Number of channels (1 or 2)
    pub channels: u8,
}

impl TranscodeConfig {
    /// Encode config to base64 string for use as transcode_params.
    pub fn encode(&self) -> String {
        let json = serde_json::to_string(self).unwrap_or_default();
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, json)
    }

    /// Decode from base64 transcode_params string.
    pub fn decode(params: &str) -> Result<Self> {
        let json =
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, params)
                .map_err(|e| Error::InvalidRequest(format!("Invalid transcode_params: {}", e)))?;
        serde_json::from_slice(&json)
            .map_err(|e| Error::InvalidRequest(format!("Invalid transcode_params: {}", e)))
    }
}

// ============================================================================
// Stream Endpoint Transcoding (with time offset support)
// ============================================================================

/// Transcode a file to Opus with an optional time offset for seeking.
/// This is used by the /api/stream endpoint for the transcodeOffset extension.
pub async fn transcode_with_offset(
    path: &std::path::Path,
    config: &TranscodeConfig,
    time_offset_seconds: f64,
    replaygain_info: ReplayGainInfo,
    accurate_seek: bool,
) -> Result<Response> {
    let path = path.to_path_buf();
    let config = config.clone();

    // Keep only a small amount of encoded audio ahead of the response. Offset
    // streams are temporary seek bridges, so prompt backpressure lets the
    // blocking encoder observe a disconnected browser and stop quickly.
    let (tx, rx) = mpsc::channel::<Vec<u8>>(8);

    let ogg_serial = offset_stream_serial(&path, &config, time_offset_seconds, accurate_seek);

    // Spawn blocking task to transcode
    tokio::task::spawn_blocking(move || {
        if let Err(e) = transcode_to_opus_with_offset(
            &path,
            &config,
            tx,
            time_offset_seconds,
            replaygain_info,
            accurate_seek,
            ogg_serial,
        ) {
            tracing::error!("Transcoding error: {}", e);
        }
    });

    // Convert receiver to stream
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let body_stream = futures::stream::StreamExt::map(stream, Ok::<_, std::io::Error>);
    let body = Body::from_stream(body_stream);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "audio/ogg")
        .body(body)
        .unwrap())
}

// ============================================================================
// Transcoding Pipeline
// ============================================================================

/// Opus frame size: 20ms at 48kHz = 960 samples per channel.
const OPUS_FRAME_SIZE: usize = 960;

/// ReplayGain information for embedding in transcoded streams.
#[derive(Debug, Clone, Default)]
pub struct ReplayGainInfo {
    /// Track gain in dB (relative to -23 LUFS for computed, -18 LUFS for most original tags)
    pub track_gain: Option<f64>,
    /// Track peak value (linear scale, 0.0 to 1.0+)
    pub track_peak: Option<f64>,
}

/// Transcode an audio file to Opus, sending chunks via channel.
/// Supports seeking to a specific time offset (in seconds) before starting transcoding.
/// If replaygain_info is provided, it will be embedded in the Opus tags as R128 gain and Vorbis comments.
fn transcode_to_opus_with_offset(
    path: &std::path::Path,
    config: &TranscodeConfig,
    tx: mpsc::Sender<Vec<u8>>,
    time_offset_seconds: f64,
    replaygain_info: ReplayGainInfo,
    accurate_seek: bool,
    ogg_serial: u32,
) -> Result<()> {
    let writer = OggStreamBuffer::new(tx);
    transcode_to_opus_writer(
        path,
        config,
        writer,
        time_offset_seconds,
        replaygain_info,
        accurate_seek,
        ogg_serial,
    )
}

/// Ogg serial for an uncached offset stream, derived from the request so that
/// repeating the request yields the same bytes. A player that loses the
/// connection re-requests the stream and skips what it already has, which only
/// lines up when the regenerated stream is byte-identical.
fn offset_stream_serial(
    path: &std::path::Path,
    config: &TranscodeConfig,
    time_offset_seconds: f64,
    accurate_seek: bool,
) -> u32 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(config.song_id.as_bytes());
    hasher.update(&config.bitrate.to_le_bytes());
    hasher.update(&config.sample_rate.to_le_bytes());
    hasher.update(&[config.channels]);
    hasher.update(&time_offset_seconds.to_bits().to_le_bytes());
    hasher.update(&[u8::from(accurate_seek)]);
    let bytes = hasher.finalize();
    let bytes = bytes.as_bytes();
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

pub(crate) fn transcode_to_opus_writer<W: std::io::Write>(
    path: &std::path::Path,
    config: &TranscodeConfig,
    writer: W,
    time_offset_seconds: f64,
    replaygain_info: ReplayGainInfo,
    accurate_seek: bool,
    ogg_serial: u32,
) -> Result<()> {
    let AudioSource {
        mut format,
        mut decoder,
        track_id,
        sample_rate: source_sample_rate,
        channels: source_channels,
        time_base,
    } = open_audio_source(path).map_err(|e| match e {
        AudioOpenError::Open(_) => Error::NotFound(e.to_string()),
        _ => Error::InvalidRequest(e.to_string()),
    })?;

    // Decoded frames to discard before the first encoded sample.
    let mut frames_to_skip: u64 = 0;

    // Seek to the requested time offset if specified
    if time_offset_seconds > 0.0 {
        use symphonia::core::formats::{SeekMode, SeekTo};
        use symphonia::core::units::Time;

        // Choose seek mode: Accurate is sample-precise but slower,
        // Coarse is faster but may not land exactly on the requested time
        let seek_mode = if accurate_seek {
            SeekMode::Accurate
        } else {
            SeekMode::Coarse
        };

        let seek_result = Time::try_from_secs_f64(time_offset_seconds)
            .ok_or_else(|| "offset out of range".to_string())
            .and_then(|time| {
                format
                    .seek(
                        seek_mode,
                        SeekTo::Time {
                            time,
                            track_id: Some(track_id),
                        },
                    )
                    .map_err(|e| e.to_string())
            });

        match seek_result {
            Ok(seeked_to) => {
                tracing::debug!(
                    "Seeked to timestamp {} (requested {}s, mode={:?})",
                    seeked_to.actual_ts,
                    time_offset_seconds,
                    seek_mode
                );
                // An accurate seek lands on the packet holding the requested
                // time; drop the decoded frames before it so the stream starts
                // exactly there (resumes then pick up where playback stopped).
                if accurate_seek {
                    let delta = seeked_to
                        .required_ts
                        .duration_from(seeked_to.actual_ts)
                        .unwrap_or_default();
                    frames_to_skip = match time_base {
                        Some(time_base) => time_base
                            .calc_duration(delta)
                            .map(|time| {
                                (time.as_secs_f64() * f64::from(source_sample_rate)).round() as u64
                            })
                            .unwrap_or(0),
                        None => delta.get(),
                    };
                }
            }
            Err(e) => {
                tracing::warn!(
                    "Could not seek to {}s, starting from beginning: {}",
                    time_offset_seconds,
                    e
                );
            }
        }
    }

    // Set up resampler if needed (Opus requires 48kHz)
    let target_sample_rate = 48000usize;
    let target_channels = config.channels as usize;
    let need_resample = source_sample_rate as usize != target_sample_rate;

    let mut resampler: Option<Fft<f32>> = if need_resample {
        Some(
            Fft::new(
                source_sample_rate as usize,
                target_sample_rate,
                1024, // chunk size (input frames per call)
                source_channels,
                FixedSync::Input,
            )
            .map_err(|e| Error::Internal(format!("Could not create resampler: {}", e)))?,
        )
    } else {
        None
    };

    // Set up Opus encoder
    let opus_sample_rate = match target_sample_rate {
        8000 => SampleRate::Hz8000,
        12000 => SampleRate::Hz12000,
        16000 => SampleRate::Hz16000,
        24000 => SampleRate::Hz24000,
        _ => SampleRate::Hz48000,
    };

    let opus_channels = if target_channels == 1 {
        Channels::Mono
    } else {
        Channels::Stereo
    };

    let mut opus_encoder = OpusEncoder::new(opus_sample_rate, opus_channels, Application::Audio)
        .map_err(|e| Error::Internal(format!("Could not create Opus encoder: {}", e)))?;

    opus_encoder
        .set_bitrate(Bitrate::BitsPerSecond(config.bitrate as i32))
        .map_err(|e| Error::Internal(format!("Could not set bitrate: {}", e)))?;

    // Create Ogg packet writer with the requested output target.
    let mut output = writer;
    let mut ogg_writer = PacketWriter::new(&mut output);

    // Write Opus header packets
    let serial = ogg_serial;
    write_opus_header(
        &mut ogg_writer,
        serial,
        opus_channels,
        opus_sample_rate,
        &replaygain_info,
    )?;

    // Buffers for processing
    // Interleaved source-rate samples waiting for the resampler.
    let mut resample_input: Vec<f32> = Vec::new();
    let mut resample_output: Vec<f32> = resampler
        .as_ref()
        .map(|r| vec![0.0; r.output_frames_max() * source_channels])
        .unwrap_or_default();
    // Interleaved samples of the current packet, reused across packets.
    let mut decoded_samples: Vec<f32> = Vec::new();
    let mut pcm_buffer: Vec<i16> = Vec::new();
    let mut opus_output = vec![0u8; 4000]; // Max Opus packet size
    let mut granule_pos: u64 = 0;

    // Bound runaway decode-error loops: if the decoder keeps failing while the
    // demuxer keeps yielding packets, the loop would spin CPU-bound emitting no
    // audio and no progress, which the client perceives as a silent stall.
    let mut consecutive_decode_errors: usize = 0;
    const MAX_CONSECUTIVE_DECODE_ERRORS: usize = 512;

    // Decode and encode loop
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(symphonia::core::errors::Error::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => {
                tracing::warn!("Error reading packet: {}", e);
                break;
            }
        };

        if packet.track_id != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => {
                consecutive_decode_errors = 0;
                decoded
            }
            Err(_) => {
                consecutive_decode_errors += 1;
                if consecutive_decode_errors >= MAX_CONSECUTIVE_DECODE_ERRORS {
                    tracing::warn!(
                        "Aborting transcode after {} consecutive decode errors",
                        consecutive_decode_errors
                    );
                    break;
                }
                continue;
            }
        };

        let num_channels = decoded.spec().channels().count().max(1);
        decoded.copy_to_vec_interleaved(&mut decoded_samples);
        let mut samples = decoded_samples.as_slice();
        if frames_to_skip > 0 {
            let frames = (samples.len() / num_channels.max(1)) as u64;
            let skipped = frames_to_skip.min(frames);
            samples = &samples[(skipped as usize) * num_channels..];
            frames_to_skip -= skipped;
        }

        if let Some(ref mut resampler) = resampler {
            push_frames(&mut resample_input, samples, num_channels, source_channels);

            // Process when we have enough samples
            let chunk_len = resampler.input_frames_next() * source_channels;
            while resample_input.len() >= chunk_len {
                match resample_chunk(
                    resampler,
                    &resample_input[..chunk_len],
                    source_channels,
                    &mut resample_output,
                    None,
                ) {
                    Ok(output) => {
                        pcm_buffer.extend(convert_samples_direct(
                            output,
                            source_channels,
                            target_channels,
                        ));
                    }
                    Err(e) => {
                        tracing::warn!("Resampler error: {}", e);
                    }
                }
                resample_input.drain(..chunk_len);
            }
        } else {
            // No resampling needed - convert directly
            let interleaved = convert_samples_direct(samples, num_channels, target_channels);
            pcm_buffer.extend(interleaved);
        }

        // Encode complete Opus frames
        let frame_samples = OPUS_FRAME_SIZE * target_channels;
        while pcm_buffer.len() >= frame_samples {
            let frame: Vec<i16> = pcm_buffer.drain(..frame_samples).collect();

            match opus_encoder.encode(&frame, &mut opus_output) {
                Ok(len) => {
                    granule_pos += OPUS_FRAME_SIZE as u64;
                    let ogg_packet = ogg::writing::PacketWriteEndInfo::EndPage;
                    if let Err(e) = ogg_writer.write_packet(
                        opus_output[..len].to_vec(),
                        serial,
                        ogg_packet,
                        granule_pos,
                    ) {
                        if e.kind() == std::io::ErrorKind::BrokenPipe {
                            return Ok(());
                        }
                        return Err(Error::Internal(format!("Could not write Ogg packet: {e}")));
                    }
                }
                Err(e) => {
                    tracing::warn!("Opus encoding error: {:?}", e);
                }
            }
        }
    }

    // Process remaining samples in resampler
    if let Some(ref mut resampler) = resampler {
        if !resample_input.is_empty() {
            // The resampler pads the partial chunk with silence.
            let frames = resample_input.len() / source_channels;
            if let Ok(output) = resample_chunk(
                resampler,
                &resample_input,
                source_channels,
                &mut resample_output,
                Some(frames),
            ) {
                pcm_buffer.extend(convert_samples_direct(
                    output,
                    source_channels,
                    target_channels,
                ));
            }
        }
    }

    // Encode remaining PCM samples (pad with silence if needed)
    let frame_samples = OPUS_FRAME_SIZE * target_channels;
    if !pcm_buffer.is_empty() {
        // Pad to complete frame
        while pcm_buffer.len() < frame_samples {
            pcm_buffer.push(0);
        }

        let frame: Vec<i16> = pcm_buffer.drain(..frame_samples).collect();
        if let Ok(len) = opus_encoder.encode(&frame, &mut opus_output) {
            granule_pos += OPUS_FRAME_SIZE as u64;
            write_ogg_packet(
                &mut ogg_writer,
                opus_output[..len].to_vec(),
                serial,
                ogg::writing::PacketWriteEndInfo::EndStream,
                granule_pos,
            )?;
        }
    } else {
        // No remaining samples, but we still need to write an EndStream marker
        // so Firefox (and other strict parsers) don't treat the stream as truncated.
        let silent_frame = vec![0i16; frame_samples];
        if let Ok(len) = opus_encoder.encode(&silent_frame, &mut opus_output) {
            granule_pos += OPUS_FRAME_SIZE as u64;
            write_ogg_packet(
                &mut ogg_writer,
                opus_output[..len].to_vec(),
                serial,
                ogg::writing::PacketWriteEndInfo::EndStream,
                granule_pos,
            )?;
        }
    }

    // Flush the ogg writer
    drop(ogg_writer);
    if let Err(e) = output.flush() {
        if e.kind() == std::io::ErrorKind::BrokenPipe {
            return Ok(());
        }
        return Err(Error::Internal(format!("Could not flush Ogg output: {e}")));
    }

    Ok(())
}

fn write_ogg_packet<W: std::io::Write>(
    writer: &mut PacketWriter<W>,
    packet: Vec<u8>,
    serial: u32,
    end_info: ogg::writing::PacketWriteEndInfo,
    granule_pos: u64,
) -> Result<()> {
    match writer.write_packet(packet, serial, end_info, granule_pos) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => Ok(()),
        Err(e) => Err(Error::Internal(format!("Could not write Ogg packet: {e}"))),
    }
}

/// Write Opus ID and Comment headers to the Ogg stream.
/// If replaygain_info contains values, they are embedded as Vorbis Comments:
/// - REPLAYGAIN_TRACK_GAIN: "-6.50 dB" format
/// - REPLAYGAIN_TRACK_PEAK: "0.988831" format
/// - R128_TRACK_GAIN: For EBU R128 compliant players (in Q7.8 format)
fn write_opus_header<W: std::io::Write>(
    writer: &mut PacketWriter<W>,
    serial: u32,
    channels: Channels,
    sample_rate: SampleRate,
    replaygain_info: &ReplayGainInfo,
) -> Result<()> {
    // OpusHead packet (RFC 7845)
    let channel_count = match channels {
        Channels::Mono => 1u8,
        Channels::Stereo | Channels::Auto => 2u8, // Default to stereo for Auto
    };
    let input_sample_rate: u32 = match sample_rate {
        SampleRate::Hz8000 => 8000,
        SampleRate::Hz12000 => 12000,
        SampleRate::Hz16000 => 16000,
        SampleRate::Hz24000 => 24000,
        SampleRate::Hz48000 => 48000,
    };

    // Calculate R128 output gain for OpusHead (in Q7.8 format: gain_dB * 256)
    // This is the native Opus way to apply gain. We set it to 0 and use tags instead
    // for better compatibility with clients that read Vorbis Comments.
    let output_gain: i16 = 0;

    let mut opus_head = Vec::new();
    opus_head.extend_from_slice(b"OpusHead");
    opus_head.push(1); // Version
    opus_head.push(channel_count);
    opus_head.extend_from_slice(&0u16.to_le_bytes()); // Pre-skip
    opus_head.extend_from_slice(&input_sample_rate.to_le_bytes()); // Input sample rate
    opus_head.extend_from_slice(&output_gain.to_le_bytes()); // Output gain (Q7.8)
    opus_head.push(0); // Channel mapping family

    writer
        .write_packet(
            opus_head,
            serial,
            ogg::writing::PacketWriteEndInfo::EndPage,
            0,
        )
        .map_err(|e| Error::Internal(format!("Could not write Opus header: {}", e)))?;

    // OpusTags packet - Vorbis Comments format
    let mut opus_tags = Vec::new();
    opus_tags.extend_from_slice(b"OpusTags");
    let vendor = b"Ferrotune";
    opus_tags.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
    opus_tags.extend_from_slice(vendor);

    // Build user comments list
    let mut comments: Vec<String> = Vec::new();

    // Add ReplayGain comments if available
    if let Some(gain) = replaygain_info.track_gain {
        // Standard ReplayGain format: "-6.50 dB"
        comments.push(format!("REPLAYGAIN_TRACK_GAIN={:.2} dB", gain));

        // R128_TRACK_GAIN for EBU R128 compliant players
        // This is in Q7.8 fixed-point format: value * 256
        // Note: R128 gain should be relative to -23 LUFS, but players
        // may interpret it differently. We use the same value as REPLAYGAIN.
        let r128_gain = (gain * 256.0).round() as i16;
        comments.push(format!("R128_TRACK_GAIN={}", r128_gain));
    }

    if let Some(peak) = replaygain_info.track_peak {
        // Peak is stored as linear value (not dB)
        comments.push(format!("REPLAYGAIN_TRACK_PEAK={:.6}", peak));
    }

    // Write number of comments
    opus_tags.extend_from_slice(&(comments.len() as u32).to_le_bytes());

    // Write each comment as length-prefixed UTF-8 string
    for comment in &comments {
        let bytes = comment.as_bytes();
        opus_tags.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        opus_tags.extend_from_slice(bytes);
    }

    writer
        .write_packet(
            opus_tags,
            serial,
            ogg::writing::PacketWriteEndInfo::EndPage,
            0,
        )
        .map_err(|e| Error::Internal(format!("Could not write Opus tags: {}", e)))?;

    Ok(())
}

/// A buffer that wraps an mpsc channel for streaming Ogg data.
struct OggStreamBuffer {
    tx: mpsc::Sender<Vec<u8>>,
    buffer: Vec<u8>,
}

impl OggStreamBuffer {
    fn new(tx: mpsc::Sender<Vec<u8>>) -> Self {
        Self {
            tx,
            buffer: Vec::with_capacity(32768),
        }
    }

    fn flush(&mut self) {
        if !self.buffer.is_empty() {
            let chunk = std::mem::take(&mut self.buffer);
            let _ = self.tx.blocking_send(chunk);
        }
    }
}

impl std::io::Write for OggStreamBuffer {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.buffer.extend_from_slice(buf);

        // Send chunks when buffer is large enough (32KB = ~2s of 128kbps audio)
        if self.buffer.len() >= 32768 {
            let chunk = std::mem::take(&mut self.buffer);
            if self.tx.blocking_send(chunk).is_err() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "Client disconnected",
                ));
            }
        }

        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        if !self.buffer.is_empty() {
            let chunk = std::mem::take(&mut self.buffer);
            if self.tx.blocking_send(chunk).is_err() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "Client disconnected",
                ));
            }
        }
        Ok(())
    }
}

/// Append interleaved `samples` with `channels` channels to `buffer`, which
/// holds `buffer_channels` channels: extra channels are dropped and missing
/// ones repeat the first channel.
fn push_frames(buffer: &mut Vec<f32>, samples: &[f32], channels: usize, buffer_channels: usize) {
    if channels == buffer_channels {
        buffer.extend_from_slice(samples);
        return;
    }
    for frame in samples.chunks_exact(channels) {
        buffer.extend((0..buffer_channels).map(|ch| frame.get(ch).copied().unwrap_or(frame[0])));
    }
}

/// Resample one chunk of interleaved `input` into `output`, returning the
/// written interleaved samples. `partial_len` marks a final chunk shorter
/// than the resampler's input size.
fn resample_chunk<'a>(
    resampler: &mut Fft<f32>,
    input: &[f32],
    channels: usize,
    output: &'a mut [f32],
    partial_len: Option<usize>,
) -> std::result::Result<&'a [f32], String> {
    let input_frames = input.len() / channels;
    let output_frames = output.len() / channels;
    let input = InterleavedSlice::new(input, channels, input_frames).map_err(|e| e.to_string())?;
    let mut output_adapter = InterleavedSlice::new_mut(&mut *output, channels, output_frames)
        .map_err(|e| e.to_string())?;
    let indexing = partial_len.map(|frames| Indexing {
        partial_len: Some(frames),
        ..Default::default()
    });
    let (_, written) = resampler
        .process_into_buffer(&input, &mut output_adapter, indexing.as_ref())
        .map_err(|e| e.to_string())?;
    Ok(&output[..written * channels])
}

/// Convert samples directly (no resampling), handling channel mixing.
fn convert_samples_direct(
    samples: &[f32],
    source_channels: usize,
    target_channels: usize,
) -> Vec<i16> {
    let num_frames = samples.len() / source_channels;
    let mut output = Vec::with_capacity(num_frames * target_channels);

    for frame in 0..num_frames {
        for target_ch in 0..target_channels {
            let sample = if target_ch < source_channels {
                samples[frame * source_channels + target_ch]
            } else {
                // Duplicate first channel
                samples[frame * source_channels]
            };
            output.push((sample.clamp(-1.0, 1.0) * 32767.0) as i16);
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(path: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/music")
            .join(path)
    }

    fn test_config() -> TranscodeConfig {
        TranscodeConfig {
            song_id: "song".to_string(),
            bitrate: 128_000,
            sample_rate: 48_000,
            channels: 2,
        }
    }

    fn transcode(path: &std::path::Path, offset: f64) -> Vec<u8> {
        let config = test_config();
        let mut bytes = Vec::new();
        transcode_to_opus_writer(
            path,
            &config,
            &mut bytes,
            offset,
            ReplayGainInfo::default(),
            true,
            offset_stream_serial(path, &config, offset, true),
        )
        .unwrap();
        bytes
    }

    fn final_granule_position(ogg: &[u8]) -> u64 {
        let page = ogg
            .windows(4)
            .rposition(|window| window == b"OggS")
            .expect("ogg page");
        u64::from_le_bytes(ogg[page + 6..page + 14].try_into().unwrap())
    }

    #[test]
    fn accurate_offset_stream_starts_at_the_requested_time() {
        let path = fixture("Test Artist/Test Album/01 - First Song.mp3");

        let full = final_granule_position(&transcode(&path, 0.0));
        let offset = final_granule_position(&transcode(&path, 1.37));

        // 1.37s at 48kHz, within a couple of Opus frames of encoder padding.
        // Without trimming, the stream starts at the MP3 frame holding 1.37s.
        let skipped = full as i64 - offset as i64;
        assert!(
            (skipped - 65_760).abs() <= 2 * OPUS_FRAME_SIZE as i64,
            "skipped {skipped} samples"
        );
    }

    #[test]
    fn repeated_offset_stream_is_byte_identical() {
        let path = fixture("Another Artist/Another Album/01 - FLAC Track One.flac");

        let first = transcode(&path, 1.5);
        let second = transcode(&path, 1.5);

        // A resumed request skips the bytes the player already has, so the
        // regenerated stream must match the first one exactly.
        assert!(!first.is_empty());
        assert_eq!(first, second);
    }
}
