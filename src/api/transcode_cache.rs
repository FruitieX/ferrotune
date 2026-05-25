use crate::api::transcoding::{transcode_to_opus_writer, ReplayGainInfo, TranscodeConfig};
use crate::config::CacheConfig;
use crate::error::{Error, Result};
use axum::{
    body::Body,
    http::{header, HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex as StdMutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::{watch, Mutex};

const CONTENT_TYPE_OPUS_OGG: &str = "audio/ogg";
const RANGE_CHUNK_BYTES: u64 = 256 * 1024;
const READ_CHUNK_BYTES: usize = 64 * 1024;

static CACHE_REGISTRY: LazyLock<StdMutex<HashMap<CacheRegistryKey, Arc<TranscodeCache>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct CacheRegistryKey {
    path: PathBuf,
    max_bytes: u64,
}

pub async fn transcode_with_cache(
    cache_config: &CacheConfig,
    headers: &HeaderMap,
    source_path: &Path,
    config: &TranscodeConfig,
    time_offset_seconds: f64,
    replaygain_info: ReplayGainInfo,
    accurate_seek: bool,
) -> Result<Response> {
    let cache = cache_for_config(cache_config);
    cache
        .serve(
            headers,
            source_path,
            config,
            time_offset_seconds,
            replaygain_info,
            accurate_seek,
        )
        .await
}

fn cache_for_config(config: &CacheConfig) -> Arc<TranscodeCache> {
    let max_bytes = config.max_transcode_size_mb.saturating_mul(1024 * 1024);
    let key = CacheRegistryKey {
        path: config.transcode_path.clone(),
        max_bytes,
    };

    let mut registry = CACHE_REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    registry
        .entry(key.clone())
        .or_insert_with(|| Arc::new(TranscodeCache::new(key.path, key.max_bytes)))
        .clone()
}

struct TranscodeCache {
    root: PathBuf,
    max_bytes: u64,
    entries: Mutex<HashMap<String, Arc<CacheEntry>>>,
}

impl TranscodeCache {
    fn new(root: PathBuf, max_bytes: u64) -> Self {
        Self {
            root,
            max_bytes,
            entries: Mutex::new(HashMap::new()),
        }
    }

    async fn serve(
        &self,
        headers: &HeaderMap,
        source_path: &Path,
        config: &TranscodeConfig,
        time_offset_seconds: f64,
        replaygain_info: ReplayGainInfo,
        accurate_seek: bool,
    ) -> Result<Response> {
        tokio::fs::create_dir_all(&self.root).await?;

        let key = build_cache_key(
            source_path,
            config,
            time_offset_seconds,
            &replaygain_info,
            accurate_seek,
        )
        .await?;
        let serial = key.ogg_serial;
        let entry = self.get_or_create_entry(key).await?;

        entry.touch_access().await?;
        self.cleanup_if_needed(&entry.key).await?;
        entry.start_generation_if_needed(
            source_path.to_path_buf(),
            config.clone(),
            time_offset_seconds,
            replaygain_info,
            accurate_seek,
            serial,
        );

        let range = headers
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_range_spec);

        match range {
            Some(range) => self.serve_range(entry, range).await,
            None => self.serve_full(entry).await,
        }
    }

    async fn get_or_create_entry(&self, key: TranscodeCacheKey) -> Result<Arc<CacheEntry>> {
        let mut entries = self.entries.lock().await;
        if let Some(entry) = entries.get(&key.cache_key) {
            return Ok(entry.clone());
        }

        let path = self.root.join(format!("{}.ogg", key.cache_key));
        let metadata_path = self.root.join(format!("{}.json", key.cache_key));
        let existing_size = std::fs::metadata(&path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let complete = read_cache_metadata_sync(&metadata_path)
            .map(|metadata| metadata.complete && metadata.size == existing_size)
            .unwrap_or(false);

        let (progress_tx, _) = watch::channel(CacheProgress {
            size: existing_size,
            complete,
            failed: false,
        });

        let entry = Arc::new(CacheEntry {
            key: key.cache_key.clone(),
            path,
            metadata_path,
            progress_tx,
            generation: StdMutex::new(GenerationState { running: false }),
            active_readers: AtomicUsize::new(0),
        });

        entries.insert(key.cache_key, entry.clone());
        Ok(entry)
    }

    async fn serve_full(&self, entry: Arc<CacheEntry>) -> Result<Response> {
        let progress = entry.progress();
        let mut builder = Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, CONTENT_TYPE_OPUS_OGG)
            .header(header::ACCEPT_RANGES, "bytes");

        if progress.complete {
            builder = builder.header(header::CONTENT_LENGTH, progress.size);
        }

        build_response(builder, Body::from_stream(stream_entry(entry, 0, None)))
    }

    async fn serve_range(&self, entry: Arc<CacheEntry>, range: RangeSpec) -> Result<Response> {
        let resolved = resolve_range(entry.clone(), range).await?;
        let Some(resolved) = resolved else {
            let progress = entry.progress();
            let complete_len = if progress.complete {
                progress.size.to_string()
            } else {
                "*".to_string()
            };
            return build_response(
                Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{}", complete_len))
                    .header(header::ACCEPT_RANGES, "bytes"),
                Body::empty(),
            );
        };

        let total = resolved
            .complete_size
            .map(|size| size.to_string())
            .unwrap_or_else(|| "*".to_string());
        let content_range = format!("bytes {}-{}/{}", resolved.start, resolved.end, total);
        let length = resolved.end - resolved.start + 1;

        build_response(
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, CONTENT_TYPE_OPUS_OGG)
                .header(header::CONTENT_LENGTH, length)
                .header(header::CONTENT_RANGE, content_range)
                .header(header::ACCEPT_RANGES, "bytes"),
            Body::from_stream(stream_entry(entry, resolved.start, Some(resolved.end + 1))),
        )
    }

    async fn cleanup_if_needed(&self, skip_key: &str) -> Result<()> {
        if self.max_bytes == 0 {
            return Ok(());
        }

        let mut candidates = Vec::new();
        let mut total_size = 0u64;
        let mut dir = match tokio::fs::read_dir(&self.root).await {
            Ok(dir) => dir,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };

        while let Some(entry) = dir.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }

            let Ok(metadata_bytes) = tokio::fs::read(&path).await else {
                continue;
            };
            let Ok(metadata) = serde_json::from_slice::<CacheMetadata>(&metadata_bytes) else {
                continue;
            };
            let media_path = self.root.join(format!("{}.ogg", metadata.key));
            let Ok(media_metadata) = tokio::fs::metadata(&media_path).await else {
                let _ = tokio::fs::remove_file(&path).await;
                continue;
            };

            let size = media_metadata.len();
            total_size = total_size.saturating_add(size);
            candidates.push(CleanupCandidate {
                key: metadata.key,
                media_path,
                metadata_path: path,
                size,
                last_access_unix_seconds: metadata.last_access_unix_seconds,
            });
        }

        if total_size <= self.max_bytes {
            return Ok(());
        }

        let active_keys = {
            let entries = self.entries.lock().await;
            entries
                .iter()
                .filter(|(_, entry)| entry.is_active())
                .map(|(key, _)| key.clone())
                .collect::<HashSet<_>>()
        };

        candidates.sort_by_key(|candidate| candidate.last_access_unix_seconds);

        for candidate in candidates {
            if total_size <= self.max_bytes {
                break;
            }
            if candidate.key == skip_key || active_keys.contains(&candidate.key) {
                continue;
            }

            match tokio::fs::remove_file(&candidate.media_path).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    tracing::warn!(
                        path = %candidate.media_path.display(),
                        error = %error,
                        "Failed to evict transcoded cache file"
                    );
                    continue;
                }
            }
            let _ = tokio::fs::remove_file(&candidate.metadata_path).await;
            total_size = total_size.saturating_sub(candidate.size);
            self.entries.lock().await.remove(&candidate.key);
        }

        Ok(())
    }
}

#[derive(Debug)]
struct CleanupCandidate {
    key: String,
    media_path: PathBuf,
    metadata_path: PathBuf,
    size: u64,
    last_access_unix_seconds: u64,
}

#[derive(Debug, Clone)]
struct TranscodeCacheKey {
    cache_key: String,
    ogg_serial: u32,
}

#[derive(Debug, Clone, Copy)]
struct CacheProgress {
    size: u64,
    complete: bool,
    failed: bool,
}

struct CacheEntry {
    key: String,
    path: PathBuf,
    metadata_path: PathBuf,
    progress_tx: watch::Sender<CacheProgress>,
    generation: StdMutex<GenerationState>,
    active_readers: AtomicUsize,
}

struct GenerationState {
    running: bool,
}

impl CacheEntry {
    fn progress(&self) -> CacheProgress {
        *self.progress_tx.borrow()
    }

    fn is_active(&self) -> bool {
        let progress = self.progress();
        let generation = self
            .generation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        !progress.complete || generation.running || self.active_readers.load(Ordering::Relaxed) > 0
    }

    fn start_generation_if_needed(
        self: &Arc<Self>,
        source_path: PathBuf,
        config: TranscodeConfig,
        time_offset_seconds: f64,
        replaygain_info: ReplayGainInfo,
        accurate_seek: bool,
        ogg_serial: u32,
    ) {
        if self.progress().complete {
            return;
        }

        {
            let mut generation = self
                .generation
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if generation.running {
                return;
            }
            generation.running = true;
        }

        let entry = self.clone();
        tokio::task::spawn_blocking(move || {
            let result = entry.generate(
                &source_path,
                &config,
                time_offset_seconds,
                replaygain_info,
                accurate_seek,
                ogg_serial,
            );

            if let Err(error) = result {
                entry.mark_failed(error);
            }
        });
    }

    fn generate(
        self: &Arc<Self>,
        source_path: &Path,
        config: &TranscodeConfig,
        time_offset_seconds: f64,
        replaygain_info: ReplayGainInfo,
        accurate_seek: bool,
        ogg_serial: u32,
    ) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)?;
        self.publish(CacheProgress {
            size: 0,
            complete: false,
            failed: false,
        });
        self.write_metadata(false, 0)?;

        let writer = CacheFileWriter {
            file,
            entry: self.clone(),
            bytes_written: 0,
        };

        transcode_to_opus_writer(
            source_path,
            config,
            writer,
            time_offset_seconds,
            replaygain_info,
            accurate_seek,
            ogg_serial,
        )?;

        let final_size = self.progress().size;
        self.write_metadata(true, final_size)?;
        self.publish(CacheProgress {
            size: final_size,
            complete: true,
            failed: false,
        });

        let mut generation = self
            .generation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        generation.running = false;
        Ok(())
    }

    fn mark_failed(&self, error: Error) {
        tracing::warn!(key = %self.key, error = %error, "Transcode cache generation failed");
        let progress = self.progress();
        self.publish(CacheProgress {
            size: progress.size,
            complete: false,
            failed: true,
        });
        let mut generation = self
            .generation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        generation.running = false;
    }

    fn publish(&self, progress: CacheProgress) {
        let _ = self.progress_tx.send(progress);
    }

    async fn wait_for_progress(&self) -> Result<CacheProgress> {
        let mut receiver = self.progress_tx.subscribe();
        receiver
            .changed()
            .await
            .map_err(|_| Error::Internal("Transcode cache progress channel closed".to_string()))?;
        let progress = *receiver.borrow();
        if progress.failed {
            return Err(Error::Internal(
                "Transcode cache generation failed".to_string(),
            ));
        }
        Ok(progress)
    }

    async fn wait_until_size_or_complete(&self, target_size: u64) -> Result<CacheProgress> {
        loop {
            let progress = self.progress();
            if progress.failed {
                return Err(Error::Internal(
                    "Transcode cache generation failed".to_string(),
                ));
            }
            if progress.size >= target_size || progress.complete {
                return Ok(progress);
            }
            self.wait_for_progress().await?;
        }
    }

    async fn touch_access(&self) -> Result<()> {
        let progress = self.progress();
        let metadata = serde_json::to_vec(&CacheMetadata {
            key: self.key.clone(),
            complete: progress.complete,
            size: progress.size,
            last_access_unix_seconds: now_unix_seconds(),
        })
        .map_err(|error| Error::Internal(format!("Could not serialize cache metadata: {error}")))?;

        tokio::fs::write(&self.metadata_path, metadata).await?;
        Ok(())
    }

    fn write_metadata(&self, complete: bool, size: u64) -> Result<()> {
        let metadata = CacheMetadata {
            key: self.key.clone(),
            complete,
            size,
            last_access_unix_seconds: now_unix_seconds(),
        };
        let bytes = serde_json::to_vec(&metadata).map_err(|error| {
            Error::Internal(format!("Could not serialize cache metadata: {error}"))
        })?;
        std::fs::write(&self.metadata_path, bytes)?;
        Ok(())
    }

    fn reader_guard(self: &Arc<Self>) -> CacheReaderGuard {
        self.active_readers.fetch_add(1, Ordering::Relaxed);
        CacheReaderGuard {
            entry: self.clone(),
        }
    }
}

struct CacheReaderGuard {
    entry: Arc<CacheEntry>,
}

impl Drop for CacheReaderGuard {
    fn drop(&mut self) {
        self.entry.active_readers.fetch_sub(1, Ordering::Relaxed);
    }
}

struct CacheFileWriter {
    file: std::fs::File,
    entry: Arc<CacheEntry>,
    bytes_written: u64,
}

impl Write for CacheFileWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let written = self.file.write(buf)?;
        self.bytes_written = self.bytes_written.saturating_add(written as u64);
        self.entry.publish(CacheProgress {
            size: self.bytes_written,
            complete: false,
            failed: false,
        });
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct CacheMetadata {
    key: String,
    complete: bool,
    size: u64,
    last_access_unix_seconds: u64,
}

fn read_cache_metadata_sync(path: &Path) -> Option<CacheMetadata> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RangeSpec {
    FromTo { start: u64, end: u64 },
    From { start: u64 },
    Suffix { length: u64 },
}

#[derive(Debug, Clone, Copy)]
struct ResolvedRange {
    start: u64,
    end: u64,
    complete_size: Option<u64>,
}

fn parse_range_spec(range_header: &str) -> Option<RangeSpec> {
    let range = range_header.strip_prefix("bytes=")?.trim();
    if range.contains(',') {
        return None;
    }

    let (start, end) = range.split_once('-')?;
    match (start.trim(), end.trim()) {
        ("", "") => None,
        ("", suffix) => {
            let length = suffix.parse::<u64>().ok()?;
            (length > 0).then_some(RangeSpec::Suffix { length })
        }
        (start, "") => start
            .parse::<u64>()
            .ok()
            .map(|start| RangeSpec::From { start }),
        (start, end) => {
            let start = start.parse::<u64>().ok()?;
            let end = end.parse::<u64>().ok()?;
            (start <= end).then_some(RangeSpec::FromTo { start, end })
        }
    }
}

async fn resolve_range(entry: Arc<CacheEntry>, range: RangeSpec) -> Result<Option<ResolvedRange>> {
    match range {
        RangeSpec::FromTo { start, end } => {
            let target = end.saturating_add(1);
            let progress = entry.wait_until_size_or_complete(target).await?;
            if progress.size == 0 || start >= progress.size {
                return Ok(None);
            }
            let resolved_end = end.min(progress.size - 1);
            Ok(Some(ResolvedRange {
                start,
                end: resolved_end,
                complete_size: progress.complete.then_some(progress.size),
            }))
        }
        RangeSpec::From { start } => {
            let progress = entry
                .wait_until_size_or_complete(start.saturating_add(1))
                .await?;
            if progress.size == 0 || start >= progress.size {
                return Ok(None);
            }
            if progress.complete {
                return Ok(Some(ResolvedRange {
                    start,
                    end: progress.size - 1,
                    complete_size: Some(progress.size),
                }));
            }

            let target = start.saturating_add(RANGE_CHUNK_BYTES);
            let progress = entry.wait_until_size_or_complete(target).await?;
            if progress.size == 0 || start >= progress.size {
                return Ok(None);
            }
            Ok(Some(ResolvedRange {
                start,
                end: progress.size - 1,
                complete_size: progress.complete.then_some(progress.size),
            }))
        }
        RangeSpec::Suffix { length } => {
            let mut progress = entry.progress();
            while !progress.complete {
                progress = entry.wait_for_progress().await?;
            }
            if progress.size == 0 {
                return Ok(None);
            }
            let start = progress.size.saturating_sub(length);
            Ok(Some(ResolvedRange {
                start,
                end: progress.size - 1,
                complete_size: Some(progress.size),
            }))
        }
    }
}

fn stream_entry(
    entry: Arc<CacheEntry>,
    start: u64,
    end_exclusive: Option<u64>,
) -> impl futures::Stream<Item = std::io::Result<Vec<u8>>> + Send + 'static {
    async_stream::stream! {
        let _guard = entry.reader_guard();
        let mut position = start;
        let mut file = loop {
            match File::open(&entry.path).await {
                Ok(file) => break file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    if let Err(error) = entry.wait_for_progress().await {
                        yield Err(std::io::Error::other(error.to_string()));
                        return;
                    }
                }
                Err(error) => {
                    yield Err(error);
                    return;
                }
            }
        };

        if let Err(error) = file.seek(std::io::SeekFrom::Start(position)).await {
            yield Err(error);
            return;
        }

        let mut buffer = vec![0u8; READ_CHUNK_BYTES];
        loop {
            if let Some(end) = end_exclusive {
                if position >= end {
                    return;
                }
            }

            let mut progress = entry.progress();
            while position >= progress.size && !progress.complete {
                match entry.wait_for_progress().await {
                    Ok(new_progress) => progress = new_progress,
                    Err(error) => {
                        yield Err(std::io::Error::other(error.to_string()));
                        return;
                    }
                }
            }

            let available_end = end_exclusive
                .map(|end| end.min(progress.size))
                .unwrap_or(progress.size);
            if position >= available_end {
                if progress.complete {
                    return;
                }
                continue;
            }

            let read_len = (available_end - position).min(READ_CHUNK_BYTES as u64) as usize;
            match file.read(&mut buffer[..read_len]).await {
                Ok(0) if progress.complete => return,
                Ok(0) => continue,
                Ok(read) => {
                    position = position.saturating_add(read as u64);
                    yield Ok(buffer[..read].to_vec());
                }
                Err(error) => {
                    yield Err(error);
                    return;
                }
            }
        }
    }
}

async fn build_cache_key(
    source_path: &Path,
    config: &TranscodeConfig,
    time_offset_seconds: f64,
    replaygain_info: &ReplayGainInfo,
    accurate_seek: bool,
) -> Result<TranscodeCacheKey> {
    let metadata = tokio::fs::metadata(source_path).await?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();

    let mut hasher = blake3::Hasher::new();
    hasher.update(source_path.to_string_lossy().as_bytes());
    hasher.update(&metadata.len().to_le_bytes());
    hasher.update(&modified.to_le_bytes());
    hasher.update(config.song_id.as_bytes());
    hasher.update(&config.bitrate.to_le_bytes());
    hasher.update(&config.sample_rate.to_le_bytes());
    hasher.update(&[config.channels]);
    hasher.update(&time_offset_seconds.to_bits().to_le_bytes());
    hasher.update(&[u8::from(accurate_seek)]);
    hasher.update(
        &replaygain_info
            .track_gain
            .map(f64::to_bits)
            .unwrap_or_default()
            .to_le_bytes(),
    );
    hasher.update(
        &replaygain_info
            .track_peak
            .map(f64::to_bits)
            .unwrap_or_default()
            .to_le_bytes(),
    );
    let hash = hasher.finalize();
    let bytes = hash.as_bytes();
    let ogg_serial = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);

    Ok(TranscodeCacheKey {
        cache_key: hash.to_hex().to_string(),
        ogg_serial,
    })
}

fn build_response(builder: axum::http::response::Builder, body: Body) -> Result<Response> {
    builder
        .body(body)
        .map_err(|error| Error::Internal(format!("Could not build response: {error}")))
}

fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_start_end_ranges() {
        assert_eq!(
            parse_range_spec("bytes=10-19"),
            Some(RangeSpec::FromTo { start: 10, end: 19 })
        );
        assert_eq!(
            parse_range_spec("bytes=10-"),
            Some(RangeSpec::From { start: 10 })
        );
        assert_eq!(
            parse_range_spec("bytes=-512"),
            Some(RangeSpec::Suffix { length: 512 })
        );
    }

    #[test]
    fn rejects_unsupported_ranges() {
        assert_eq!(parse_range_spec("bytes=20-10"), None);
        assert_eq!(parse_range_spec("bytes=0-1,4-5"), None);
        assert_eq!(parse_range_spec("items=0-1"), None);
        assert_eq!(parse_range_spec("bytes=-0"), None);
    }

    #[tokio::test]
    async fn evicts_least_recently_used_complete_entries() {
        let unique = now_unix_seconds().saturating_add(rand::random::<u16>() as u64);
        let root = std::env::temp_dir().join(format!("ferrotune-transcode-cache-test-{unique}"));
        tokio::fs::create_dir_all(&root).await.unwrap();

        write_test_cache_entry(&root, "old", 4, 1).await;
        write_test_cache_entry(&root, "new", 4, 2).await;

        let cache = TranscodeCache::new(root.clone(), 4);
        cache.cleanup_if_needed("new").await.unwrap();

        assert!(!root.join("old.ogg").exists());
        assert!(root.join("new.ogg").exists());

        let _ = tokio::fs::remove_dir_all(root).await;
    }

    async fn write_test_cache_entry(root: &Path, key: &str, size: usize, last_access: u64) {
        tokio::fs::write(root.join(format!("{key}.ogg")), vec![0u8; size])
            .await
            .unwrap();
        tokio::fs::write(
            root.join(format!("{key}.json")),
            serde_json::to_vec(&CacheMetadata {
                key: key.to_string(),
                complete: true,
                size: size as u64,
                last_access_unix_seconds: last_access,
            })
            .unwrap(),
        )
        .await
        .unwrap();
    }
}
