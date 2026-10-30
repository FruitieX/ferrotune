//! Format-aware tag reading and editing.
//!
//! Tags are read and written through lofty's concrete tag types
//! (`VorbisComments`, `Id3v2Tag`, `Ilst`, `ApeTag`) instead of the generic
//! `Tag`, which only carries standard items: editing through it drops every
//! non-standard key (Vorbis `URL`/`UPC`/`SPOTIFY_*`, ID3 `TXXX`/`PRIV`/`UFID`,
//! MP4 freeform atoms, ...). Here only the keys a request names are touched;
//! everything else in the edited tag block is written back as read, and other
//! tag blocks in the file (ID3v1, APE in MP3, RIFF INFO, ...) are not rewritten.
//!
//! Each format module implements [`FormatTag`]: it lists entries, resolves an
//! API key to a native target, and reads, writes or removes a target. API keys
//! are the canonical names from [`keys`] for standard fields and format-native
//! keys otherwise; every listed key resolves back to the item it came from.
//! Binary or structured items (ID3 `PRIV`, `UFID`, `POPM`, `MCDI`, MP4 atoms
//! with opaque data, APE binary items) are listed read-only.
//!
//! Files are edited on a temporary copy. The copy replaces the original only
//! when the write succeeded and its primary tag reads back exactly as
//! intended, so a failed or lossy write never touches the original.

mod ape;
mod id3v2;
mod keys;
mod mp4;
mod vorbis;

#[cfg(test)]
mod tests;

use crate::api::tags::{AdditionalTagBlock, TagChange, TagEntry};
use lofty::aac::AacFile;
use lofty::ape::{ApeFile, ApeTag};
use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::{AudioFile, FileType};
use lofty::flac::FlacFile;
use lofty::id3::v1::Id3v1Tag;
use lofty::id3::v2::{Id3v2Tag, Id3v2Version};
use lofty::iff::aiff::{AiffFile, AiffTextChunks};
use lofty::iff::wav::{RiffInfoList, WavFile};
use lofty::mp4::{Ilst, Mp4File};
use lofty::mpeg::MpegFile;
use lofty::musepack::MpcFile;
use lofty::ogg::tag::VorbisComments;
use lofty::ogg::{OggPictureStorage, OpusFile, SpeexFile, VorbisFile};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::probe::Probe;
use lofty::tag::TagExt;
use lofty::wavpack::WavPackFile;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};

/// Why a tag operation failed.
#[derive(Debug)]
pub enum TagIoError {
    /// The request cannot be applied to this file (read-only key, invalid
    /// key or value).
    InvalidRequest(String),
    /// Reading or writing the file failed.
    Failed(String),
}

impl std::fmt::Display for TagIoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TagIoError::InvalidRequest(msg) | TagIoError::Failed(msg) => f.write_str(msg),
        }
    }
}

impl From<String> for TagIoError {
    fn from(msg: String) -> Self {
        TagIoError::Failed(msg)
    }
}

/// Picture types removed by [`CoverArtAction::Remove`].
const COVER_TYPES: [PictureType; 3] = [
    PictureType::CoverFront,
    PictureType::CoverBack,
    PictureType::Other,
];

/// Cover art change applied together with a tag update.
pub enum CoverArtAction {
    /// Keep existing cover art (no change)
    Keep,
    /// Remove the front, back and "other" pictures
    Remove,
    /// Replace the front cover (data, mime type)
    Set(Vec<u8>, String),
}

/// One tag format's list/resolve/read/write operations.
trait FormatTag {
    /// A resolved native item (a Vorbis field, an ID3 frame, an MP4 atom, ...).
    type Target: PartialEq + Clone + std::fmt::Debug;

    /// Every entry in the tag; read-only entries have no target.
    fn listing(&self) -> Vec<(Option<Self::Target>, TagEntry)>;
    /// Map an API key to the native item it addresses.
    fn resolve_key(&self, key: &str) -> Result<Self::Target, String>;
    /// The current values of a target.
    fn current_values(&self, target: &Self::Target) -> Vec<String>;
    /// Replace a target's values (never called with an empty list).
    fn write_values(&mut self, target: &Self::Target, values: &[String]) -> Result<(), String>;
    /// Remove a target.
    fn remove_target(&mut self, target: &Self::Target);
}

fn entry(
    key: impl Into<String>,
    value: impl Into<String>,
    native_key: Option<String>,
    read_only: bool,
) -> TagEntry {
    TagEntry {
        key: key.into(),
        value: value.into(),
        native_key,
        read_only,
    }
}

/// The first candidate key that resolves back to `target`, else `raw`.
fn display_key<T: FormatTag>(
    tag: &T,
    target: &T::Target,
    candidates: &[&str],
    raw: String,
) -> String {
    candidates
        .iter()
        .find(|c| tag.resolve_key(c).ok().as_ref() == Some(target))
        .map(|c| c.to_string())
        .unwrap_or(raw)
}

/// The entries of a tag. An entry whose key would address a different item
/// (a naming collision the format modules could not avoid) is listed
/// read-only, so editing it can never touch another item.
fn list_entries<T: FormatTag>(tag: &T) -> Vec<TagEntry> {
    tag.listing()
        .into_iter()
        .map(|(target, mut e)| {
            if let Some(target) = target {
                if tag.resolve_key(&e.key).ok().as_ref() != Some(&target) {
                    tracing::warn!("Tag key {:?} is ambiguous, listing it read-only", e.key);
                    e.read_only = true;
                }
            }
            e
        })
        .collect()
}

fn join_values(values: &[String]) -> Option<String> {
    (!values.is_empty()).then(|| values.join("; "))
}

/// Apply deletions and sets to one tag, recording what changed.
fn apply_to<T: FormatTag>(
    tag: &mut T,
    set: &[TagEntry],
    delete: &[String],
    changes: &mut Vec<TagChange>,
) -> Result<(), TagIoError> {
    let invalid = TagIoError::InvalidRequest;
    for key in delete {
        let target = tag.resolve_key(key).map_err(invalid)?;
        let old = tag.current_values(&target);
        if !old.is_empty() {
            tag.remove_target(&target);
            changes.push(TagChange {
                key: key.clone(),
                action: "deleted".to_string(),
                old_value: join_values(&old),
                new_value: None,
            });
        }
    }

    // Entries with the same key set all values of that key, in order.
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for e in set {
        let key = e.key.trim();
        match groups.iter_mut().find(|(k, _)| k == key) {
            Some((_, values)) => values.push(e.value.clone()),
            None => groups.push((key.to_string(), vec![e.value.clone()])),
        }
    }

    for (key, values) in groups {
        let target = tag.resolve_key(&key).map_err(invalid)?;
        let old = tag.current_values(&target);
        // An empty value clears the key (the tagger sends "" for deletions).
        let values: Vec<String> = values.into_iter().filter(|v| !v.is_empty()).collect();
        if values.is_empty() {
            if !old.is_empty() {
                tag.remove_target(&target);
                changes.push(TagChange {
                    key,
                    action: "deleted".to_string(),
                    old_value: join_values(&old),
                    new_value: None,
                });
            }
            continue;
        }
        if old == values {
            continue;
        }
        tag.write_values(&target, &values).map_err(invalid)?;
        changes.push(TagChange {
            key,
            action: "set".to_string(),
            old_value: join_values(&old),
            new_value: join_values(&values),
        });
    }
    Ok(())
}

/// A file read through its concrete lofty type.
enum NativeFile {
    Aac(AacFile),
    Aiff(AiffFile),
    Ape(ApeFile),
    Flac(FlacFile),
    Mp4(Mp4File),
    Mpc(MpcFile),
    Mpeg(MpegFile),
    Opus(OpusFile),
    Speex(SpeexFile),
    Vorbis(VorbisFile),
    Wav(WavFile),
    WavPack(WavPackFile),
}

/// The primary (editable) tag of a file.
enum Primary<'a> {
    Vorbis(&'a VorbisComments),
    Id3v2(&'a Id3v2Tag),
    Mp4(&'a Ilst),
    Ape(&'a ApeTag),
}

enum PrimaryMut<'a> {
    Vorbis(&'a mut VorbisComments),
    Id3v2(&'a mut Id3v2Tag),
    Mp4(&'a mut Ilst),
    Ape(&'a mut ApeTag),
}

impl Primary<'_> {
    fn type_name(&self) -> &'static str {
        match self {
            Primary::Vorbis(_) => VORBIS_NAME,
            Primary::Id3v2(_) => ID3V2_NAME,
            Primary::Mp4(_) => MP4_NAME,
            Primary::Ape(_) => APE_NAME,
        }
    }

    fn entries(&self) -> Vec<TagEntry> {
        match self {
            Primary::Vorbis(t) => list_entries(*t),
            Primary::Id3v2(t) => list_entries(*t),
            Primary::Mp4(t) => list_entries(*t),
            Primary::Ape(t) => list_entries(*t),
        }
    }
}

const VORBIS_NAME: &str = "Vorbis Comments";
const ID3V2_NAME: &str = "ID3v2";
const ID3V1_NAME: &str = "ID3v1";
const MP4_NAME: &str = "MP4 (iTunes)";
const APE_NAME: &str = "APE";
const RIFF_NAME: &str = "RIFF INFO";
const AIFF_NAME: &str = "AIFF Text";

/// Parse options for listing: no audio properties, no picture data.
fn list_options() -> ParseOptions {
    ParseOptions::new()
        .read_properties(false)
        .read_cover_art(false)
}

/// Parse options for editing: everything that gets written back must be read.
fn edit_options() -> ParseOptions {
    ParseOptions::new().read_properties(false)
}

impl NativeFile {
    fn open(path: &Path, options: ParseOptions) -> Result<Self, String> {
        // Like `Probe::read`: trust a known extension, sniff the content otherwise.
        let probe = Probe::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
        let file_type = match probe.file_type() {
            Some(file_type) => file_type,
            None => probe
                .guess_file_type()
                .map_err(|e| format!("Failed to read file: {e}"))?
                .file_type()
                .ok_or_else(|| "Unsupported or unrecognized audio format".to_string())?,
        };
        Self::open_as(path, file_type, options)
    }

    fn open_as(path: &Path, file_type: FileType, options: ParseOptions) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
        let read_err =
            |e: lofty::error::FileParseError| format!("Failed to read tags: {}", error_chain(&e));
        Ok(match file_type {
            FileType::Aac => {
                NativeFile::Aac(AacFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Aiff => {
                NativeFile::Aiff(AiffFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Ape => {
                NativeFile::Ape(ApeFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Flac => {
                NativeFile::Flac(FlacFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Mp4 => {
                NativeFile::Mp4(Mp4File::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Mpc => {
                NativeFile::Mpc(MpcFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Mpeg => {
                NativeFile::Mpeg(MpegFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Opus => {
                NativeFile::Opus(OpusFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Speex => {
                NativeFile::Speex(SpeexFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Vorbis => {
                NativeFile::Vorbis(VorbisFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::Wav => {
                NativeFile::Wav(WavFile::read_from(&mut file, options).map_err(read_err)?)
            }
            FileType::WavPack => {
                NativeFile::WavPack(WavPackFile::read_from(&mut file, options).map_err(read_err)?)
            }
            other => return Err(format!("Unsupported audio format: {other:?}")),
        })
    }

    fn primary(&self) -> Option<Primary<'_>> {
        match self {
            NativeFile::Flac(f) => f.vorbis_comments().map(Primary::Vorbis),
            NativeFile::Opus(f) => Some(Primary::Vorbis(f.vorbis_comments())),
            NativeFile::Speex(f) => Some(Primary::Vorbis(f.vorbis_comments())),
            NativeFile::Vorbis(f) => Some(Primary::Vorbis(f.vorbis_comments())),
            NativeFile::Aac(f) => f.id3v2().map(Primary::Id3v2),
            NativeFile::Aiff(f) => f.id3v2().map(Primary::Id3v2),
            NativeFile::Mpeg(f) => f.id3v2().map(Primary::Id3v2),
            NativeFile::Wav(f) => f.id3v2().map(Primary::Id3v2),
            NativeFile::Mp4(f) => f.ilst().map(Primary::Mp4),
            NativeFile::Ape(f) => f.ape().map(Primary::Ape),
            NativeFile::Mpc(f) => f.ape().map(Primary::Ape),
            NativeFile::WavPack(f) => f.ape().map(Primary::Ape),
        }
    }

    /// The primary tag's entries in a canonical order, to compare what was
    /// meant to be written with what a re-read finds.
    fn primary_fingerprint(&self) -> Vec<(String, String, bool)> {
        let mut entries: Vec<(String, String, bool)> = self
            .primary()
            .map(|p| p.entries())
            .unwrap_or_default()
            .into_iter()
            .map(|e| (e.key, e.value, e.read_only))
            .collect();
        entries.sort();
        entries
    }

    fn file_type(&self) -> FileType {
        match self {
            NativeFile::Aac(_) => FileType::Aac,
            NativeFile::Aiff(_) => FileType::Aiff,
            NativeFile::Ape(_) => FileType::Ape,
            NativeFile::Flac(_) => FileType::Flac,
            NativeFile::Mp4(_) => FileType::Mp4,
            NativeFile::Mpc(_) => FileType::Mpc,
            NativeFile::Mpeg(_) => FileType::Mpeg,
            NativeFile::Opus(_) => FileType::Opus,
            NativeFile::Speex(_) => FileType::Speex,
            NativeFile::Vorbis(_) => FileType::Vorbis,
            NativeFile::Wav(_) => FileType::Wav,
            NativeFile::WavPack(_) => FileType::WavPack,
        }
    }

    fn primary_type_name(&self) -> &'static str {
        match self {
            NativeFile::Flac(_)
            | NativeFile::Opus(_)
            | NativeFile::Speex(_)
            | NativeFile::Vorbis(_) => VORBIS_NAME,
            NativeFile::Aac(_) | NativeFile::Aiff(_) | NativeFile::Mpeg(_) | NativeFile::Wav(_) => {
                ID3V2_NAME
            }
            NativeFile::Mp4(_) => MP4_NAME,
            NativeFile::Ape(_) | NativeFile::Mpc(_) | NativeFile::WavPack(_) => APE_NAME,
        }
    }

    /// The primary tag, created empty when the file has none.
    fn primary_mut(&mut self) -> PrimaryMut<'_> {
        match self {
            NativeFile::Flac(f) => {
                if f.vorbis_comments().is_none() {
                    f.set_vorbis_comments(VorbisComments::new());
                }
                PrimaryMut::Vorbis(f.vorbis_comments_mut().expect("just inserted"))
            }
            NativeFile::Opus(f) => PrimaryMut::Vorbis(f.vorbis_comments_mut()),
            NativeFile::Speex(f) => PrimaryMut::Vorbis(f.vorbis_comments_mut()),
            NativeFile::Vorbis(f) => PrimaryMut::Vorbis(f.vorbis_comments_mut()),
            NativeFile::Aac(f) => {
                if f.id3v2().is_none() {
                    let _ = f.set_id3v2(Id3v2Tag::new());
                }
                PrimaryMut::Id3v2(f.id3v2_mut().expect("just inserted"))
            }
            NativeFile::Aiff(f) => {
                if f.id3v2().is_none() {
                    let _ = f.set_id3v2(Id3v2Tag::new());
                }
                PrimaryMut::Id3v2(f.id3v2_mut().expect("just inserted"))
            }
            NativeFile::Mpeg(f) => {
                if f.id3v2().is_none() {
                    let _ = f.set_id3v2(Id3v2Tag::new());
                }
                PrimaryMut::Id3v2(f.id3v2_mut().expect("just inserted"))
            }
            NativeFile::Wav(f) => {
                if f.id3v2().is_none() {
                    let _ = f.set_id3v2(Id3v2Tag::new());
                }
                PrimaryMut::Id3v2(f.id3v2_mut().expect("just inserted"))
            }
            NativeFile::Mp4(f) => {
                if f.ilst().is_none() {
                    let _ = f.set_ilst(Ilst::new());
                }
                PrimaryMut::Mp4(f.ilst_mut().expect("just inserted"))
            }
            NativeFile::Ape(f) => {
                if f.ape().is_none() {
                    let _ = f.set_ape(ApeTag::new());
                }
                PrimaryMut::Ape(f.ape_mut().expect("just inserted"))
            }
            NativeFile::Mpc(f) => {
                if f.ape().is_none() {
                    let _ = f.set_ape(ApeTag::new());
                }
                PrimaryMut::Ape(f.ape_mut().expect("just inserted"))
            }
            NativeFile::WavPack(f) => {
                if f.ape().is_none() {
                    let _ = f.set_ape(ApeTag::new());
                }
                PrimaryMut::Ape(f.ape_mut().expect("just inserted"))
            }
        }
    }

    /// Read-only listings of the other tag blocks in the file.
    fn additional_blocks(&self) -> Vec<AdditionalTagBlock> {
        let mut blocks = Vec::new();
        let mut add = |name: &str, tags: Vec<TagEntry>| {
            if !tags.is_empty() {
                blocks.push(AdditionalTagBlock {
                    tag_type: name.to_string(),
                    tags: tags
                        .into_iter()
                        .map(|mut e| {
                            e.read_only = true;
                            e
                        })
                        .collect(),
                });
            }
        };
        match self {
            NativeFile::Flac(f) => {
                if let Some(t) = f.id3v2() {
                    add(ID3V2_NAME, list_entries(t));
                }
            }
            NativeFile::Aac(f) => {
                if let Some(t) = f.id3v1() {
                    add(ID3V1_NAME, id3v1_entries(t));
                }
            }
            NativeFile::Mpeg(f) => {
                if let Some(t) = f.id3v1() {
                    add(ID3V1_NAME, id3v1_entries(t));
                }
                if let Some(t) = f.ape() {
                    add(APE_NAME, list_entries(t));
                }
            }
            NativeFile::Wav(f) => {
                if let Some(t) = f.riff_info() {
                    add(RIFF_NAME, riff_entries(t));
                }
            }
            NativeFile::Aiff(f) => {
                if let Some(t) = f.text_chunks() {
                    add(AIFF_NAME, aiff_entries(t));
                }
            }
            NativeFile::Ape(f) => {
                if let Some(t) = f.id3v2() {
                    add(ID3V2_NAME, list_entries(t));
                }
                if let Some(t) = f.id3v1() {
                    add(ID3V1_NAME, id3v1_entries(t));
                }
            }
            NativeFile::Mpc(f) => {
                if let Some(t) = f.id3v2() {
                    add(ID3V2_NAME, list_entries(t));
                }
                if let Some(t) = f.id3v1() {
                    add(ID3V1_NAME, id3v1_entries(t));
                }
            }
            NativeFile::WavPack(f) => {
                if let Some(t) = f.id3v1() {
                    add(ID3V1_NAME, id3v1_entries(t));
                }
            }
            NativeFile::Mp4(_)
            | NativeFile::Opus(_)
            | NativeFile::Speex(_)
            | NativeFile::Vorbis(_) => {}
        }
        blocks
    }

    fn apply_cover(&mut self, action: CoverArtAction) -> Result<Option<TagChange>, String> {
        let picture = match &action {
            CoverArtAction::Keep => return Ok(None),
            CoverArtAction::Remove => None,
            CoverArtAction::Set(data, mime) => {
                let mime = match mime.as_str() {
                    "image/png" => MimeType::Png,
                    "image/gif" => MimeType::Gif,
                    "image/bmp" => MimeType::Bmp,
                    "image/tiff" => MimeType::Tiff,
                    _ => MimeType::Jpeg,
                };
                Some(
                    Picture::unchecked(data.clone())
                        .pic_type(PictureType::CoverFront)
                        .mime_type(mime)
                        .build(),
                )
            }
        };

        // FLAC keeps pictures in PICTURE blocks next to the comments.
        if let NativeFile::Flac(f) = self {
            if let Some(comments) = f.vorbis_comments_mut() {
                set_ogg_cover(comments, None)?;
            }
            set_ogg_cover(f, picture.clone())?;
        } else {
            match self.primary_mut() {
                PrimaryMut::Vorbis(t) => set_ogg_cover(t, picture.clone())?,
                PrimaryMut::Id3v2(t) => match picture.clone() {
                    Some(p) => id3v2::set_cover(t, p),
                    None => id3v2::remove_covers(t),
                },
                PrimaryMut::Mp4(t) => match picture.clone() {
                    Some(p) => mp4::set_cover(t, p),
                    None => mp4::remove_covers(t),
                },
                PrimaryMut::Ape(t) => match picture.clone() {
                    Some(p) => ape::set_cover(t, p)?,
                    None => ape::remove_covers(t),
                },
            }
        }

        Ok(Some(TagChange {
            key: "COVER_ART".to_string(),
            action: if picture.is_some() { "set" } else { "deleted" }.to_string(),
            old_value: picture.is_none().then(|| "<picture>".to_string()),
            new_value: picture.is_some().then(|| "<picture>".to_string()),
        }))
    }

    /// Whether the ID3v2 tag is written back as ID3v2.3.
    ///
    /// ID3v2.3 tags stay ID3v2.3 so players that only read v2.3 keep working,
    /// unless the tag holds ID3v2.4-only frames that lofty would drop when
    /// writing v2.3 (iTunes puts TSOP/TSOA in v2.3 tags).
    fn writes_id3v23(&self) -> bool {
        const V24_ONLY: &[&str] = &[
            "ASPI", "EQU2", "RVA2", "SEEK", "SIGN", "TDEN", "TDRL", "TDTG", "TMOO", "TPRO", "TSOA",
            "TSOP", "TSOT", "TSST",
        ];
        let id3v2 = match self {
            NativeFile::Aac(f) => f.id3v2(),
            NativeFile::Aiff(f) => f.id3v2(),
            NativeFile::Mpeg(f) => f.id3v2(),
            NativeFile::Wav(f) => f.id3v2(),
            _ => None,
        };
        id3v2.is_some_and(|t| {
            t.original_version() == Id3v2Version::V3
                && !t.iter().any(|f| V24_ONLY.contains(&f.id_str()))
        })
    }

    /// Write the primary tag to `file`; other tag blocks are left as they are.
    fn save_primary(&mut self, file: &mut File) -> Result<(), String> {
        let v23 = self.writes_id3v23();
        let options = WriteOptions::new()
            .use_id3v23(v23)
            .parse_options(edit_options());
        let save_err = |e: lofty::error::FileEncodingError| {
            format!("Failed to save file: {}", error_chain(&e))
        };
        match self {
            NativeFile::Flac(f) => {
                // FlacFile writes the comments and PICTURE blocks together. An
                // ID3v2 tag in a FLAC file can only be stripped by lofty, so it
                // is detached here and stays untouched on disk.
                let _ = f.remove_id3v2();
                f.save_to(file, options).map_err(save_err)
            }
            other => match other.primary_mut() {
                PrimaryMut::Vorbis(t) => t.save_to(file, options).map_err(save_err),
                PrimaryMut::Id3v2(t) => {
                    id3v2::prepare_for_write(t, v23);
                    t.save_to(file, options).map_err(save_err)
                }
                PrimaryMut::Mp4(t) => t.save_to(file, options).map_err(save_err),
                PrimaryMut::Ape(t) => t.save_to(file, options).map_err(save_err),
            },
        }
    }

    /// Save to `path` through a temporary copy next to it. The copy is read
    /// back and only replaces the original when its primary tag holds exactly
    /// what was meant to be written.
    fn save(&mut self, path: &Path) -> Result<(), String> {
        let expected = self.primary_fingerprint();
        let temp = temp_path(path);
        std::fs::copy(path, &temp).map_err(|e| format!("Failed to copy file for writing: {e}"))?;
        let result = (|| {
            let mut file = OpenOptions::new()
                .read(true)
                .write(true)
                .open(&temp)
                .map_err(|e| format!("Failed to open file for writing: {e}"))?;
            if matches!(self, NativeFile::Wav(_)) {
                use std::io::{Seek, SeekFrom};
                repair_riff_size(&mut file)
                    .and_then(|()| file.seek(SeekFrom::Start(0)).map(|_| ()))
                    .map_err(|e| format!("Failed to read WAV structure: {e}"))?;
            }
            self.save_primary(&mut file)?;
            file.sync_all()
                .map_err(|e| format!("Failed to flush file: {e}"))?;
            drop(file);

            let written =
                NativeFile::open_as(&temp, self.file_type(), edit_options())?.primary_fingerprint();
            if written != expected {
                tracing::warn!(
                    path = %path.display(),
                    ?expected,
                    ?written,
                    "Tag write did not read back as expected"
                );
                return Err(
                    "The tags did not read back as written; the file was left unchanged"
                        .to_string(),
                );
            }
            std::fs::rename(&temp, path).map_err(|e| format!("Failed to replace file: {e}"))
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result
    }
}

/// Some taggers append an `id3 ` chunk after the RIFF chunk without growing
/// the RIFF size. lofty then writes a second tag inside the RIFF chunk while
/// readers keep finding the stale one. When everything after the RIFF chunk
/// parses as whole chunks, grow the RIFF size to cover them.
fn repair_riff_size(file: &mut File) -> std::io::Result<()> {
    use std::io::{Read, Seek, SeekFrom, Write};

    let len = file.metadata()?.len();
    let mut header = [0u8; 12];
    file.seek(SeekFrom::Start(0))?;
    if file.read_exact(&mut header).is_err() || &header[..4] != b"RIFF" || &header[8..] != b"WAVE" {
        return Ok(());
    }
    let riff_end = 8 + u64::from(u32::from_le_bytes(header[4..8].try_into().unwrap()));
    if riff_end >= len {
        return Ok(());
    }

    let mut pos = riff_end + (riff_end & 1);
    while pos + 8 <= len {
        let mut chunk = [0u8; 8];
        file.seek(SeekFrom::Start(pos))?;
        file.read_exact(&mut chunk)?;
        if !chunk[..4]
            .iter()
            .all(|b| b.is_ascii_graphic() || *b == b' ')
        {
            return Ok(());
        }
        let size = u64::from(u32::from_le_bytes(chunk[4..].try_into().unwrap()));
        pos += 8 + size + (size & 1);
    }
    // Allow a missing pad byte at the very end.
    if pos != len && pos != len + 1 {
        return Ok(());
    }
    let Ok(new_size) = u32::try_from(len - 8) else {
        return Ok(());
    };
    file.seek(SeekFrom::Start(4))?;
    file.write_all(&new_size.to_le_bytes())
}

/// An error and its sources, joined with ": ".
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(e) = source {
        message.push_str(": ");
        message.push_str(&e.to_string());
        source = e.source();
    }
    message
}

fn set_ogg_cover<S: OggPictureStorage>(
    storage: &mut S,
    picture: Option<Picture>,
) -> Result<(), String> {
    match picture {
        Some(p) => {
            storage.remove_picture_type(PictureType::CoverFront);
            storage
                .insert_picture(p, None)
                .map_err(|e| format!("Invalid cover art: {e}"))?;
        }
        None => {
            for picture_type in COVER_TYPES {
                storage.remove_picture_type(picture_type);
            }
        }
    }
    Ok(())
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.{}.ferrotune-tags", uuid::Uuid::new_v4()))
}

fn id3v1_entries(tag: &Id3v1Tag) -> Vec<TagEntry> {
    let mut out = Vec::new();
    let mut add = |key: &str, value: Option<String>| {
        if let Some(value) = value.filter(|v| !v.is_empty()) {
            out.push(entry(key, value, None, true));
        }
    };
    add("TITLE", tag.title.clone());
    add("ARTIST", tag.artist.clone());
    add("ALBUM", tag.album.clone());
    add("YEAR", tag.year.map(|y| y.to_string()));
    add("COMMENT", tag.comment.clone());
    add("TRACKNUMBER", tag.track_number.map(|n| n.to_string()));
    add(
        "GENRE",
        tag.genre.map(|g| {
            lofty::id3::v1::GENRES
                .get(g as usize)
                .map_or_else(|| g.to_string(), |name| name.to_string())
        }),
    );
    out
}

fn riff_entries(tag: &RiffInfoList) -> Vec<TagEntry> {
    tag.into_iter()
        .map(|(k, v)| entry(k.clone(), v.clone(), None, true))
        .collect()
}

fn aiff_entries(tag: &AiffTextChunks) -> Vec<TagEntry> {
    let mut out = Vec::new();
    if let Some(name) = &tag.name {
        out.push(entry("NAME", name.clone(), None, true));
    }
    if let Some(author) = &tag.author {
        out.push(entry("AUTH", author.clone(), None, true));
    }
    if let Some(copyright) = &tag.copyright {
        out.push(entry("(c) ", copyright.clone(), None, true));
    }
    for annotation in tag.annotations.iter().flatten() {
        out.push(entry("ANNO", annotation.clone(), None, true));
    }
    for comment in tag.comments.iter().flatten() {
        out.push(entry("COMT", comment.text.clone(), None, true));
    }
    out
}

/// All tags of a file: the editable primary block and read-only other blocks.
pub struct TagListing {
    /// Name of the primary tag type ("ID3v2", "Vorbis Comments", ...), if the
    /// file has a primary tag.
    pub tag_type: Option<String>,
    /// Entries of the primary tag block.
    pub tags: Vec<TagEntry>,
    /// The other tag blocks, read-only.
    pub additional: Vec<AdditionalTagBlock>,
}

/// List every tag of a file. Blocking.
pub fn read_tags(path: &Path) -> Result<TagListing, String> {
    let file = NativeFile::open(path, list_options())?;
    let primary = file.primary();
    Ok(TagListing {
        tag_type: primary.as_ref().map(|p| p.type_name().to_string()),
        tags: primary.map(|p| p.entries()).unwrap_or_default(),
        additional: file.additional_blocks(),
    })
}

/// Apply a tag update to a file and save it. Blocking.
///
/// `set` entries with the same key replace all values of that key; an empty
/// value deletes the key. `delete` removes keys. Keys not named are kept as
/// they are. Returns the changes; the file is only written when something
/// changed.
pub fn update_tags(
    path: &Path,
    set: &[TagEntry],
    delete: &[String],
    cover_art: CoverArtAction,
) -> Result<Vec<TagChange>, TagIoError> {
    let mut file = NativeFile::open(path, edit_options())?;
    let mut changes = Vec::new();

    if let Some(change) = file
        .apply_cover(cover_art)
        .map_err(TagIoError::InvalidRequest)?
    {
        changes.push(change);
    }

    if !set.is_empty() || !delete.is_empty() {
        match file.primary_mut() {
            PrimaryMut::Vorbis(t) => apply_to(t, set, delete, &mut changes)?,
            PrimaryMut::Id3v2(t) => apply_to(t, set, delete, &mut changes)?,
            PrimaryMut::Mp4(t) => apply_to(t, set, delete, &mut changes)?,
            PrimaryMut::Ape(t) => apply_to(t, set, delete, &mut changes)?,
        }
    }

    if !changes.is_empty() {
        file.save(path)?;
    }
    Ok(changes)
}

/// Strip format-specific prefixes from a key so it can be written to another
/// format (`TXXX:Source` → `Source`, `----:com.apple.iTunes:UPC` → `UPC`).
/// Returns `None` for keys that only make sense in their own format.
fn portable_key(key: &str) -> Option<&str> {
    if let Some(rest) = key
        .strip_prefix("TXXX:")
        .or_else(|| key.strip_prefix("APE:"))
    {
        return Some(rest);
    }
    if let Some(rest) = key.strip_prefix("----:") {
        return rest.split_once(':').map(|(_, name)| name);
    }
    if key.contains(':') {
        // COMM:/USLT:/WXXX: with a description.
        return None;
    }
    Some(key)
}

/// Copy the tags of `from` onto `to` (used when a file's audio is replaced).
///
/// When both files use the same primary tag format, the whole tag block is
/// copied, binary frames and pictures included. Otherwise the editable text
/// entries are written through the target format's key mapping. Returns
/// whether the pictures were copied too; when not, the caller carries the
/// cover over. Blocking.
pub fn transfer_tags(from: &Path, to: &Path) -> Result<bool, TagIoError> {
    let source = NativeFile::open(from, edit_options())?;
    let mut target = NativeFile::open(to, edit_options())?;

    let same_format = source.primary_type_name() == target.primary_type_name();
    // FLAC keeps pictures beside the comments; Ogg inside them.
    let source_flac = matches!(source, NativeFile::Flac(_));
    let target_flac = matches!(target, NativeFile::Flac(_));
    let mut pictures_copied = same_format;
    match (source.primary(), target.primary_mut()) {
        (None, _) => return Ok(false),
        (Some(Primary::Vorbis(s)), PrimaryMut::Vorbis(t)) if same_format => {
            *t = s.clone();
            pictures_copied = source_flac == target_flac;
        }
        (Some(Primary::Id3v2(s)), PrimaryMut::Id3v2(t)) if same_format => *t = s.clone(),
        (Some(Primary::Mp4(s)), PrimaryMut::Mp4(t)) if same_format => *t = s.clone(),
        (Some(Primary::Ape(s)), PrimaryMut::Ape(t)) if same_format => *t = s.clone(),
        (Some(primary), mut t) => {
            let entries: Vec<TagEntry> = primary
                .entries()
                .into_iter()
                .filter(|e| !e.read_only)
                .collect();
            // A prefixed key that would land on another listed key (TXXX
            // "ALBUMARTIST" next to TPE2) stays behind.
            let set: Vec<TagEntry> = entries
                .iter()
                .filter_map(|e| {
                    let key = portable_key(&e.key)?;
                    let shadowed =
                        key != e.key && entries.iter().any(|o| o.key.eq_ignore_ascii_case(key));
                    (!shadowed).then(|| TagEntry::new(key.to_string(), e.value.clone()))
                })
                .collect();
            // Each key on its own: one the target format cannot hold (an
            // invalid field name, an integer atom given text) is skipped
            // instead of failing the whole transfer.
            let mut keys: Vec<&str> = Vec::new();
            for e in &set {
                if !keys.contains(&e.key.as_str()) {
                    keys.push(&e.key);
                }
            }
            pictures_copied = false;
            for key in keys {
                let group: Vec<TagEntry> = set.iter().filter(|e| e.key == key).cloned().collect();
                let mut changes = Vec::new();
                let result = match &mut t {
                    PrimaryMut::Vorbis(t) => apply_to(*t, &group, &[], &mut changes),
                    PrimaryMut::Id3v2(t) => apply_to(*t, &group, &[], &mut changes),
                    PrimaryMut::Mp4(t) => apply_to(*t, &group, &[], &mut changes),
                    PrimaryMut::Ape(t) => apply_to(*t, &group, &[], &mut changes),
                };
                if let Err(e) = result {
                    tracing::warn!("Not transferring tag {key:?}: {e}");
                }
            }
        }
    }
    if let (NativeFile::Flac(s), NativeFile::Flac(t)) = (&source, &mut target) {
        let _ = t.remove_pictures();
        for (picture, info) in s.pictures() {
            t.insert_picture(picture.clone(), Some(*info))
                .map_err(|e| TagIoError::Failed(format!("Failed to copy picture: {e}")))?;
        }
    }
    target.save(to)?;
    Ok(pictures_copied)
}
