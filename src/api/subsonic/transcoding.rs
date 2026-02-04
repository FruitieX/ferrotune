//! Streaming audio transcoding to Opus.
//!
//! Implements the OpenSubsonic transcoding extension with support for
//! real-time transcoding of audio files to Opus format.
//!
//! Pipeline: [Input File] → [Symphonia Decoder] → [Rubato Resampler] → [Audiopus Encoder] → [Ogg Muxer] → [HTTP Stream]

// OpenSubsonic spec defines fields we may not use internally
#![allow(dead_code)]

use crate::api::ferrotune::users::user_has_song_access;
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::SubsonicResponse;
use crate::api::AppState;
use crate::error::{Error, FormatError, Result};
use audiopus::coder::Encoder as OpusEncoder;
use audiopus::{Application, Bitrate, Channels, SampleRate};
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use ogg::writing::PacketWriter;
use rubato::{FftFixedIn, Resampler};
use serde::{Deserialize, Serialize};

use std::path::PathBuf;
use std::sync::Arc;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{CodecRegistry, DecoderOptions};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia_adapter_libopus::OpusDecoder;
use tokio::sync::mpsc;
use ts_rs::TS;

use std::sync::LazyLock;

/// Custom codec registry that includes Opus support via libopus adapter.
static CODEC_REGISTRY: LazyLock<CodecRegistry> = LazyLock::new(|| {
    let mut registry = CodecRegistry::new();
    registry.register_all::<OpusDecoder>();
    symphonia::default::register_enabled_codecs(&mut registry);
    registry
});

// ============================================================================
// OpenSubsonic Types
// ============================================================================

/// Client information for transcode decision (sent in POST body).
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub name: Option<String>,
    pub platform: Option<String>,
    #[serde(default)]
    pub max_audio_bitrate: Option<u32>,
    #[serde(default)]
    pub max_transcoding_audio_bitrate: Option<u32>,
    #[serde(default)]
    pub direct_play_profiles: Vec<DirectPlayProfile>,
    #[serde(default)]
    pub transcoding_profiles: Vec<TranscodingProfile>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirectPlayProfile {
    #[serde(default)]
    pub containers: Vec<String>,
    #[serde(default)]
    pub audio_codecs: Vec<String>,
    #[serde(default)]
    pub protocols: Vec<String>,
    pub max_audio_channels: Option<u32>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscodingProfile {
    pub container: String,
    pub audio_codec: String,
    pub protocol: Option<String>,
    pub max_audio_channels: Option<u32>,
}

/// Parameters for getTranscodeDecision
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeDecisionParams {
    pub media_id: String,
    #[serde(default = "default_media_type")]
    pub media_type: String,
}

fn default_media_type() -> String {
    "song".to_string()
}

/// The transcode decision response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TranscodeDecision {
    pub can_direct_play: bool,
    pub can_transcode: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub transcode_reason: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcode_params: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_stream: Option<StreamInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcode_stream: Option<StreamInfo>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StreamInfo {
    pub protocol: String,
    pub container: String,
    pub codec: String,
    pub audio_channels: u32,
    pub audio_bitrate: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_profile: Option<String>,
    pub audio_samplerate: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_bitdepth: Option<u32>,
}

/// Parameters for getTranscodeStream
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeStreamParams {
    pub media_id: String,
    #[serde(default = "default_media_type")]
    pub media_type: String,
    #[serde(default)]
    pub offset: Option<u64>,
    pub transcode_params: String,
}

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
// Transcode Decision Endpoint
// ============================================================================

/// Wrapper for transcoding decision response (JSON only since this is a new OpenSubsonic extension)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeDecisionResponse {
    pub transcode_decision: TranscodeDecision,
}

/// POST /rest/getTranscodeDecision
///
/// Returns a transcode decision for a given media file based on client capabilities.
pub async fn get_transcode_decision(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<TranscodeDecisionParams>,
    Json(client_info): Json<ClientInfo>,
) -> std::result::Result<impl IntoResponse, FormatError> {
    let format = user.format;
    get_transcode_decision_logic(user, state, params, client_info)
        .await
        .map(|decision| {
            Json(SubsonicResponse::ok(TranscodeDecisionResponse {
                transcode_decision: decision,
            }))
        })
        .map_err(|e| FormatError::new(e, format))
}

async fn get_transcode_decision_logic(
    user: AuthenticatedUser,
    state: Arc<AppState>,
    params: TranscodeDecisionParams,
    client_info: ClientInfo,
) -> Result<TranscodeDecision> {
    // Get song from database
    let song = crate::db::queries::get_song_by_id(&state.pool, &params.media_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Song {} not found", params.media_id)))?;

    // Check access
    if !user_has_song_access(&state.pool, user.user_id, &params.media_id).await? {
        return Err(Error::Forbidden(format!(
            "You do not have access to song {}",
            params.media_id
        )));
    }

    let source_codec = song.file_format.to_lowercase();
    // Note: Song model doesn't store channels/sample_rate/bit_depth, so we use defaults
    // The actual values will be determined when transcoding via Symphonia
    let source_channels = 2u32; // Assume stereo
    let source_sample_rate = 44100u32; // Common default
    let source_bitrate = song.bitrate.unwrap_or(320) as u32 * 1000; // convert kbps to bps
    let source_bitdepth: Option<u32> = None;

    // Build source stream info
    let source_stream = StreamInfo {
        protocol: "http".to_string(),
        container: source_codec.clone(),
        codec: source_codec.clone(),
        audio_channels: source_channels,
        audio_bitrate: source_bitrate,
        audio_profile: None,
        audio_samplerate: source_sample_rate,
        audio_bitdepth: source_bitdepth,
    };

    // Check if client can direct play
    let can_direct_play = client_info.direct_play_profiles.iter().any(|profile| {
        let codec_match = profile.audio_codecs.is_empty()
            || profile
                .audio_codecs
                .iter()
                .any(|c| c.to_lowercase() == source_codec);
        let container_match = profile.containers.is_empty()
            || profile
                .containers
                .iter()
                .any(|c| c.to_lowercase() == source_codec);
        let channel_ok = profile
            .max_audio_channels
            .map(|max| source_channels <= max)
            .unwrap_or(true);
        codec_match && container_match && channel_ok
    });

    if can_direct_play {
        return Ok(TranscodeDecision {
            can_direct_play: true,
            can_transcode: true,
            transcode_reason: vec![],
            error_reason: None,
            transcode_params: None,
            source_stream: Some(source_stream),
            transcode_stream: None,
        });
    }

    // Check if client supports Opus transcoding
    let opus_profile = client_info
        .transcoding_profiles
        .iter()
        .find(|p| p.audio_codec.to_lowercase() == "opus" || p.container.to_lowercase() == "opus");

    let can_transcode = opus_profile.is_some();

    if !can_transcode {
        // Check if we should transcode anyway (client didn't specify but we support it)
        // Default to offering Opus transcoding
        let target_bitrate = client_info
            .max_transcoding_audio_bitrate
            .unwrap_or(128000)
            .min(256000);
        let target_channels = source_channels.min(2) as u8;

        let config = TranscodeConfig {
            song_id: params.media_id.clone(),
            bitrate: target_bitrate,
            sample_rate: 48000, // Opus always uses 48kHz internally
            channels: target_channels,
        };

        let transcode_stream = StreamInfo {
            protocol: "http".to_string(),
            container: "ogg".to_string(),
            codec: "opus".to_string(),
            audio_channels: target_channels as u32,
            audio_bitrate: target_bitrate,
            audio_profile: None,
            audio_samplerate: 48000,
            audio_bitdepth: None, // Opus doesn't have a fixed bit depth
        };

        return Ok(TranscodeDecision {
            can_direct_play: false,
            can_transcode: true,
            transcode_reason: vec!["AudioCodecNotSupported".to_string()],
            error_reason: None,
            transcode_params: Some(config.encode()),
            source_stream: Some(source_stream),
            transcode_stream: Some(transcode_stream),
        });
    }

    // Build transcode config based on client preferences
    let target_bitrate = client_info
        .max_transcoding_audio_bitrate
        .unwrap_or(128000)
        .min(256000);
    let target_channels = opus_profile
        .and_then(|p| p.max_audio_channels)
        .map(|c| c.min(2) as u8)
        .unwrap_or(source_channels.min(2) as u8);

    let config = TranscodeConfig {
        song_id: params.media_id.clone(),
        bitrate: target_bitrate,
        sample_rate: 48000,
        channels: target_channels,
    };

    let transcode_stream = StreamInfo {
        protocol: "http".to_string(),
        container: "ogg".to_string(),
        codec: "opus".to_string(),
        audio_channels: target_channels as u32,
        audio_bitrate: target_bitrate,
        audio_profile: None,
        audio_samplerate: 48000,
        audio_bitdepth: None,
    };

    let mut reasons = vec![];
    if !can_direct_play {
        reasons.push("AudioCodecNotSupported".to_string());
    }

    Ok(TranscodeDecision {
        can_direct_play: false,
        can_transcode: true,
        transcode_reason: reasons,
        error_reason: None,
        transcode_params: Some(config.encode()),
        source_stream: Some(source_stream),
        transcode_stream: Some(transcode_stream),
    })
}

// ============================================================================
// Transcode Stream Endpoint
// ============================================================================

/// GET /rest/getTranscodeStream
///
/// Returns a transcoded media stream (Opus in Ogg container).
pub async fn get_transcode_stream(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<TranscodeStreamParams>,
) -> std::result::Result<Response, impl IntoResponse> {
    let format = user.format;
    get_transcode_stream_logic(user, state, params)
        .await
        .map_err(|e| FormatError::new(e, format))
}

async fn get_transcode_stream_logic(
    user: AuthenticatedUser,
    state: Arc<AppState>,
    params: TranscodeStreamParams,
) -> Result<Response> {
    // Decode transcode parameters
    let config = TranscodeConfig::decode(&params.transcode_params)?;

    // Verify song ID matches
    if config.song_id != params.media_id {
        return Err(Error::InvalidRequest(
            "transcode_params does not match media_id".to_string(),
        ));
    }

    // Get song from database
    let song = crate::db::queries::get_song_by_id(&state.pool, &params.media_id)
        .await?
        .ok_or_else(|| Error::NotFound(format!("Song {} not found", params.media_id)))?;

    // Check access
    if !user_has_song_access(&state.pool, user.user_id, &params.media_id).await? {
        return Err(Error::Forbidden(format!(
            "You do not have access to song {}",
            params.media_id
        )));
    }

    // Find the file path
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

    // Security check
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
        return Err(Error::NotFound("File not found".to_string()));
    }

    // Create channel for streaming transcoded data
    let (tx, rx) = mpsc::channel::<Vec<u8>>(32);

    // Build ReplayGain info from song data
    // Prefer computed values over original tags (computed uses EBU R128 with -23 LUFS reference)
    let replaygain_info = ReplayGainInfo {
        track_gain: song
            .computed_replaygain_track_gain
            .or(song.original_replaygain_track_gain),
        track_peak: song
            .computed_replaygain_track_peak
            .or(song.original_replaygain_track_peak),
    };

    // Spawn blocking task to transcode
    let config_clone = config.clone();
    let offset_seconds = params.offset.unwrap_or(0) as f64;
    tokio::task::spawn_blocking(move || {
        if let Err(e) = transcode_to_opus_with_offset(
            &canonical_path,
            &config_clone,
            tx,
            offset_seconds,
            replaygain_info,
            false, // Use coarse seek by default for OpenSubsonic endpoint
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
        .header(header::TRANSFER_ENCODING, "chunked")
        .body(body)
        .unwrap())
}

// ============================================================================
// Stream Endpoint Transcoding (with time offset support)
// ============================================================================

/// Transcode a file to Opus with an optional time offset for seeking.
/// This is used by the /rest/stream endpoint for the transcodeOffset extension.
pub async fn transcode_with_offset(
    path: &std::path::Path,
    config: &TranscodeConfig,
    time_offset_seconds: f64,
    replaygain_info: ReplayGainInfo,
    accurate_seek: bool,
) -> Result<Response> {
    let path = path.to_path_buf();
    let config = config.clone();

    // Create channel for streaming transcoded data
    let (tx, rx) = mpsc::channel::<Vec<u8>>(32);

    // Spawn blocking task to transcode
    tokio::task::spawn_blocking(move || {
        if let Err(e) = transcode_to_opus_with_offset(
            &path,
            &config,
            tx,
            time_offset_seconds,
            replaygain_info,
            accurate_seek,
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
        .header(header::TRANSFER_ENCODING, "chunked")
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
) -> Result<()> {
    // Open source file
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
    let source_sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let source_channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);

    let mut decoder = CODEC_REGISTRY
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| Error::InvalidRequest(format!("Could not create decoder: {}", e)))?;

    // Seek to the requested time offset if specified
    if time_offset_seconds > 0.0 {
        use symphonia::core::formats::SeekMode;
        use symphonia::core::units::Time;

        // Convert seconds to TimeStamp
        let ts = Time::from(time_offset_seconds);

        // Choose seek mode: Accurate is sample-precise but slower,
        // Coarse is faster but may not land exactly on the requested time
        let seek_mode = if accurate_seek {
            SeekMode::Accurate
        } else {
            SeekMode::Coarse
        };

        match format.seek(
            seek_mode,
            symphonia::core::formats::SeekTo::Time {
                time: ts,
                track_id: Some(track_id),
            },
        ) {
            Ok(seeked_to) => {
                tracing::debug!(
                    "Seeked to timestamp {} (requested {}s, mode={:?})",
                    seeked_to.actual_ts,
                    time_offset_seconds,
                    seek_mode
                );
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

    let mut resampler: Option<FftFixedIn<f32>> = if need_resample {
        Some(
            FftFixedIn::new(
                source_sample_rate as usize,
                target_sample_rate,
                1024, // chunk size
                2,    // sub chunks
                source_channels,
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

    // Create Ogg packet writer with a streaming buffer
    let mut ogg_buffer = OggStreamBuffer::new(tx.clone());
    let mut ogg_writer = PacketWriter::new(&mut ogg_buffer);

    // Write Opus header packets
    let serial = rand::random::<u32>();
    write_opus_header(
        &mut ogg_writer,
        serial,
        opus_channels,
        opus_sample_rate,
        &replaygain_info,
    )?;

    // Buffers for processing
    let mut resample_input: Vec<Vec<f32>> = vec![Vec::new(); source_channels];
    let mut pcm_buffer: Vec<i16> = Vec::new();
    let mut opus_output = vec![0u8; 4000]; // Max Opus packet size
    let mut granule_pos: u64 = 0;
    let chunk_size = 1024usize;

    // Decode and encode loop
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

        let samples = sample_buf.samples();
        let num_channels = spec.channels.count();

        // De-interleave samples for resampler
        if need_resample {
            for (i, sample) in samples.iter().enumerate() {
                let channel = i % num_channels;
                if channel < source_channels {
                    resample_input[channel].push(*sample);
                }
            }

            // Process when we have enough samples
            while resample_input[0].len() >= chunk_size {
                let input_chunk: Vec<Vec<f32>> = resample_input
                    .iter()
                    .map(|ch| ch[..chunk_size].to_vec())
                    .collect();

                for ch in &mut resample_input {
                    ch.drain(..chunk_size);
                }

                if let Some(ref mut resampler) = resampler {
                    match resampler.process(&input_chunk, None) {
                        Ok(output) => {
                            let interleaved = interleave_and_convert(&output, target_channels);
                            pcm_buffer.extend(interleaved);
                        }
                        Err(e) => {
                            tracing::warn!("Resampler error: {}", e);
                        }
                    }
                }
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
                    if ogg_writer
                        .write_packet(opus_output[..len].to_vec(), serial, ogg_packet, granule_pos)
                        .is_err()
                    {
                        // Client disconnected
                        return Ok(());
                    }
                }
                Err(e) => {
                    tracing::warn!("Opus encoding error: {:?}", e);
                }
            }
        }
    }

    // Process remaining samples in resampler
    if need_resample && !resample_input[0].is_empty() {
        if let Some(ref mut resampler) = resampler {
            let pad_len = chunk_size.saturating_sub(resample_input[0].len());
            for ch in &mut resample_input {
                ch.extend(std::iter::repeat_n(0.0f32, pad_len));
            }

            if let Ok(output) = resampler.process(&resample_input, None) {
                let interleaved = interleave_and_convert(&output, target_channels);
                pcm_buffer.extend(interleaved);
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
            let _ = ogg_writer.write_packet(
                opus_output[..len].to_vec(),
                serial,
                ogg::writing::PacketWriteEndInfo::EndStream,
                granule_pos,
            );
        }
    }

    // Flush the ogg writer
    drop(ogg_writer);

    // Send any remaining buffered data
    ogg_buffer.flush();

    Ok(())
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
            buffer: Vec::with_capacity(8192),
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

        // Send chunks when buffer is large enough
        if self.buffer.len() >= 8192 {
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

/// Interleave resampled channels and convert to i16 for Opus encoder.
fn interleave_and_convert(channels: &[Vec<f32>], target_channels: usize) -> Vec<i16> {
    if channels.is_empty() || channels[0].is_empty() {
        return vec![];
    }

    let num_frames = channels[0].len();
    let mut output = Vec::with_capacity(num_frames * target_channels);

    for frame in 0..num_frames {
        for ch in 0..target_channels {
            let sample = if ch < channels.len() {
                channels[ch].get(frame).copied().unwrap_or(0.0)
            } else if !channels.is_empty() {
                // Duplicate first channel for missing channels
                channels[0].get(frame).copied().unwrap_or(0.0)
            } else {
                0.0
            };
            // Convert f32 (-1.0 to 1.0) to i16
            output.push((sample.clamp(-1.0, 1.0) * 32767.0) as i16);
        }
    }

    output
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
