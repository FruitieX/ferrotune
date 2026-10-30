//! ID3v2 (MP3, AAC, WAV, AIFF).
//!
//! Frames are edited in place and every frame the user does not touch is
//! written back as it was read (lofty re-encodes the tag, but each frame's
//! content, flags and binary payload are kept).
//!
//! Keys:
//! - standard text frames use the canonical name (`TIT2` → `TITLE`), other
//!   text and URL frames their frame ID (`TMED`, `WOAR`);
//! - `TRCK`/`TPOS`/`MVIN` are split into number and total keys;
//! - `TXXX` frames use their description (`Source`, `MP3GAIN_MINMAX`), or the
//!   canonical name for descriptions lofty maps (`MusicBrainz Album Id` →
//!   `MUSICBRAINZ_ALBUMID`). When the bare description would mean another
//!   frame, the key is `TXXX:<description>`;
//! - `WXXX:<description>`, `COMM:<description>` and `USLT:<description>` for
//!   the other described frames (`COMMENT` and `LYRICS` for an empty
//!   description);
//! - binary or structured frames (`PRIV:<owner>`, `UFID:<owner>`,
//!   `POPM:<email>`, `TIPL`, `MCDI`, `GEOB`, ...) are listed read-only.
//!
//! Unknown keys are written as `TXXX` frames.

use super::keys::{
    canonical_item, canonical_name, describe_binary, join_pair, mapped_name, native_candidates,
    pair_names, pair_of, replace_year, split_pair, year_of,
};
use super::{display_key, entry, FormatTag};
use crate::api::tags::TagEntry;
use lofty::id3::v2::{
    BinaryFrame, CommentFrame, ExtendedTextFrame, ExtendedUrlFrame, Frame, FrameId, Id3v2Tag,
    TextInformationFrame, TimestampFrame, UniqueFileIdentifierFrame, UnsynchronizedTextFrame,
    UrlLinkFrame,
};
use lofty::picture::{Picture, PictureType};
use lofty::tag::items::Timestamp;
use lofty::tag::{ItemKey, TagType};
use lofty::TextEncoding;
use std::borrow::Cow;
use std::str::FromStr;

const MUSICBRAINZ_UFID_OWNER: &str = "http://musicbrainz.org";
const DEFAULT_LANGUAGE: [u8; 3] = *b"eng";

/// Text information frames (ID3v2.4, iTunes extensions and the ID3v2.3
/// frames lofty keeps), excluding the key/value frames `TIPL`/`TMCL`.
const TEXT_FRAMES: &[&str] = &[
    "TALB", "TBPM", "TCAT", "TCMP", "TCOM", "TCON", "TCOP", "TDAT", "TDEN", "TDES", "TDLY", "TDOR",
    "TDRC", "TDRL", "TDTG", "TENC", "TEXT", "TFLT", "TGID", "TIME", "TIT1", "TIT2", "TIT3", "TKEY",
    "TKWD", "TLAN", "TLEN", "TMED", "TMOO", "TOAL", "TOFN", "TOLY", "TOPE", "TORY", "TOWN", "TPE1",
    "TPE2", "TPE3", "TPE4", "TPOS", "TPRO", "TPUB", "TRCK", "TRDA", "TRSN", "TRSO", "TSIZ", "TSO2",
    "TSOA", "TSOC", "TSOP", "TSOT", "TSRC", "TSSE", "TSST", "TYER", "GRP1", "MVNM", "MVIN",
];
const TIMESTAMP_FRAMES: &[&str] = &["TDEN", "TDOR", "TDRC", "TDRL", "TDTG"];
const URL_FRAMES: &[&str] = &[
    "WCOM", "WCOP", "WFED", "WOAF", "WOAR", "WOAS", "WORS", "WPAY", "WPUB",
];
const PAIR_FRAMES: &[(&str, ItemKey)] = &[
    ("TRCK", ItemKey::TrackNumber),
    ("TPOS", ItemKey::DiscNumber),
    ("MVIN", ItemKey::MovementNumber),
];

#[derive(Debug, Clone)]
pub(super) enum Target {
    /// A text (or timestamp) frame by ID.
    Text(String),
    /// One half of a "number/total" frame.
    Pair { id: &'static str, total: bool },
    /// A `TXXX` frame by description.
    UserText(String),
    /// A URL link frame by ID.
    Url(String),
    /// A `WXXX` frame by description.
    UserUrl(String),
    /// A `COMM` frame by description.
    Comment(String),
    /// A `USLT` frame by description.
    Lyrics(String),
    /// The MusicBrainz recording ID `UFID` frame.
    MusicBrainzUfid,
    /// The year part of `TDRC`.
    Year,
}

fn same_text(a: &str, b: &str) -> bool {
    a == b || a.to_lowercase() == b.to_lowercase()
}

impl PartialEq for Target {
    fn eq(&self, other: &Self) -> bool {
        use Target::*;
        match (self, other) {
            (Text(a), Text(b)) | (Url(a), Url(b)) => a == b,
            (UserText(a), UserText(b))
            | (UserUrl(a), UserUrl(b))
            | (Comment(a), Comment(b))
            | (Lyrics(a), Lyrics(b)) => same_text(a, b),
            (Pair { id: a, total: x }, Pair { id: b, total: y }) => a == b && x == y,
            (MusicBrainzUfid, MusicBrainzUfid) | (Year, Year) => true,
            _ => false,
        }
    }
}

fn is_frame_id(s: &str) -> bool {
    s.len() == 4
        && s.bytes().next().is_some_and(|b| b.is_ascii_uppercase())
        && s.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

fn pair_frame(item: ItemKey) -> Option<&'static str> {
    PAIR_FRAMES
        .iter()
        .find(|(_, number)| *number == item)
        .map(|(id, _)| *id)
}

fn frame_matches(frame: &Frame<'_>, target: &Target) -> bool {
    match (frame, target) {
        (Frame::Text(f), Target::Text(id)) => f.id().as_str() == id,
        (Frame::Timestamp(f), Target::Text(id)) => f.id().as_str() == id,
        (Frame::Text(f), Target::Pair { id, .. }) => f.id().as_str() == *id,
        (Frame::Text(f), Target::Year) => f.id().as_str() == "TDRC",
        (Frame::Timestamp(f), Target::Year) => f.id().as_str() == "TDRC",
        (Frame::UserText(f), Target::UserText(d)) => same_text(&f.description, d),
        (Frame::Url(f), Target::Url(id)) => f.id().as_str() == id,
        (Frame::UserUrl(f), Target::UserUrl(d)) => same_text(&f.description, d),
        (Frame::Comment(f), Target::Comment(d)) => same_text(&f.description, d),
        (Frame::UnsynchronizedText(f), Target::Lyrics(d)) => same_text(&f.description, d),
        (Frame::UniqueFileIdentifier(f), Target::MusicBrainzUfid) => {
            f.owner == MUSICBRAINZ_UFID_OWNER
        }
        _ => false,
    }
}

fn frame_id(id: &str) -> Result<FrameId<'static>, String> {
    FrameId::new(Cow::Owned(id.to_string())).map_err(|e| format!("Invalid frame ID {id}: {e}"))
}

/// Replace the first frame matching `target` with `frame` (keeping its
/// position) and drop the other matches; append when nothing matched.
fn replace_frames(tag: &mut Id3v2Tag, target: &Target, frame: Frame<'static>) {
    let mut new = Some(frame);
    tag.retain_mut(|f| {
        if !frame_matches(f, target) {
            return true;
        }
        match new.take() {
            Some(n) => {
                *f = n;
                true
            }
            None => false,
        }
    });
    if let Some(n) = new {
        tag.insert(n);
    }
}

fn text_value(tag: &Id3v2Tag, id: &str) -> Option<String> {
    tag.iter().find_map(|f| match f {
        Frame::Text(t) if t.id().as_str() == id => Some(t.value.to_string()),
        Frame::Timestamp(t) if t.id().as_str() == id => Some(t.timestamp.to_string()),
        _ => None,
    })
}

fn text_frame(id: &str, values: &[String]) -> Result<Frame<'static>, String> {
    if TIMESTAMP_FRAMES.contains(&id) && values.len() == 1 {
        if let Ok(timestamp) = Timestamp::from_str(&values[0]) {
            if timestamp.to_string() == values[0] {
                return Ok(Frame::Timestamp(TimestampFrame::new(
                    frame_id(id)?,
                    TextEncoding::UTF8,
                    timestamp,
                )));
            }
        }
    }
    Ok(Frame::Text(TextInformationFrame::new(
        frame_id(id)?,
        TextEncoding::UTF8,
        values.join("\0"),
    )))
}

impl FormatTag for Id3v2Tag {
    type Target = Target;

    fn listing(&self) -> Vec<(Option<Target>, TagEntry)> {
        let mut out = Vec::new();
        let mut push = |target: Option<Target>, key: String, value: String, native: String| {
            let native = (native != key).then_some(native);
            let read_only = target.is_none();
            out.push((target, entry(key, value, native, read_only)));
        };

        for frame in self.iter() {
            let id = frame.id_str().to_string();
            match frame {
                Frame::Text(f) => {
                    if let Some((pair_id, number_item)) =
                        PAIR_FRAMES.iter().find(|(pid, _)| *pid == id)
                    {
                        let (number_key, total_key) = pair_names(*number_item);
                        let (number, total) = split_pair(&f.value);
                        if let Some(number) = number {
                            let t = Target::Pair {
                                id: pair_id,
                                total: false,
                            };
                            push(Some(t), number_key.to_string(), number, id.clone());
                        }
                        if let Some(total) = total {
                            let t = Target::Pair {
                                id: pair_id,
                                total: true,
                            };
                            push(Some(t), total_key.to_string(), total, id.clone());
                        }
                        continue;
                    }
                    let target = Target::Text(id.clone());
                    let candidates: Vec<&str> =
                        mapped_name(TagType::Id3v2, &id).into_iter().collect();
                    let key = display_key(self, &target, &candidates, id.clone());
                    for value in f.value.split('\0') {
                        push(
                            Some(target.clone()),
                            key.clone(),
                            value.to_string(),
                            id.clone(),
                        );
                    }
                }
                Frame::Timestamp(f) => {
                    let target = Target::Text(id.clone());
                    let candidates: Vec<&str> =
                        mapped_name(TagType::Id3v2, &id).into_iter().collect();
                    let key = display_key(self, &target, &candidates, id.clone());
                    push(Some(target), key, f.timestamp.to_string(), id.clone());
                }
                Frame::UserText(f) => {
                    let desc = f.description.to_string();
                    let target = Target::UserText(desc.clone());
                    let mut candidates: Vec<&str> =
                        mapped_name(TagType::Id3v2, &desc).into_iter().collect();
                    candidates.push(&desc);
                    let native = format!("TXXX:{desc}");
                    let key = display_key(self, &target, &candidates, native.clone());
                    for value in f.content.split('\0') {
                        push(
                            Some(target.clone()),
                            key.clone(),
                            value.to_string(),
                            native.clone(),
                        );
                    }
                }
                Frame::Url(f) => {
                    let target = Target::Url(id.clone());
                    let candidates: Vec<&str> =
                        mapped_name(TagType::Id3v2, &id).into_iter().collect();
                    let key = display_key(self, &target, &candidates, id.clone());
                    push(Some(target), key, f.url().to_string(), id.clone());
                }
                Frame::UserUrl(f) => {
                    let native = format!("WXXX:{}", f.description);
                    let target = Target::UserUrl(f.description.to_string());
                    push(Some(target), native.clone(), f.content.to_string(), native);
                }
                Frame::Comment(f) => {
                    let native = format!("COMM:{}", f.description);
                    let target = Target::Comment(f.description.to_string());
                    let key = display_key(self, &target, &["COMMENT"], native.clone());
                    push(Some(target), key, f.content.to_string(), native);
                }
                Frame::UnsynchronizedText(f) => {
                    let native = format!("USLT:{}", f.description);
                    let target = Target::Lyrics(f.description.to_string());
                    let key = display_key(self, &target, &["LYRICS"], native.clone());
                    push(Some(target), key, f.content.to_string(), native);
                }
                Frame::UniqueFileIdentifier(f) => {
                    let native = format!("UFID:{}", f.owner);
                    let value = describe_binary(&f.identifier);
                    if f.owner == MUSICBRAINZ_UFID_OWNER {
                        push(
                            Some(Target::MusicBrainzUfid),
                            "MUSICBRAINZ_TRACKID".to_string(),
                            value,
                            native,
                        );
                    } else {
                        push(None, native.clone(), value, native);
                    }
                }
                Frame::Private(f) => {
                    let native = format!("PRIV:{}", f.owner);
                    push(
                        None,
                        native.clone(),
                        describe_binary(&f.private_data),
                        native,
                    );
                }
                Frame::Popularimeter(f) => {
                    let native = format!("POPM:{}", f.email);
                    let value = format!("rating {}, play count {}", f.rating, f.counter);
                    push(None, native.clone(), value, native);
                }
                Frame::KeyValue(f) => {
                    let value = f
                        .key_value_pairs
                        .iter()
                        .map(|(k, v)| format!("{k}: {v}"))
                        .collect::<Vec<_>>()
                        .join("; ");
                    push(None, id.clone(), value, id.clone());
                }
                // Cover art is edited through the cover art actions.
                Frame::Picture(_) => {}
                Frame::Binary(f) => {
                    push(None, id.clone(), describe_binary(&f.data), id.clone());
                }
                _ => {
                    push(None, id.clone(), format!("<{id} frame>"), id.clone());
                }
            }
        }
        out
    }

    fn resolve_key(&self, key: &str) -> Result<Target, String> {
        let key = key.trim();
        if key.is_empty() {
            return Err("Tag key must not be empty".to_string());
        }

        if let Some((prefix, rest)) = key.split_once(':') {
            match prefix.to_ascii_uppercase().as_str() {
                "TXXX" => return Ok(Target::UserText(rest.to_string())),
                "WXXX" => return Ok(Target::UserUrl(rest.to_string())),
                "COMM" => return Ok(Target::Comment(rest.to_string())),
                "USLT" => return Ok(Target::Lyrics(rest.to_string())),
                "UFID" if rest == MUSICBRAINZ_UFID_OWNER => return Ok(Target::MusicBrainzUfid),
                p if is_frame_id(p) => {
                    return Err(format!("ID3v2 frame {key} is read-only"));
                }
                _ => {}
            }
        }

        if let Some(item) = canonical_item(key) {
            if let Some((number, total)) = pair_of(item) {
                if let Some(id) = pair_frame(number) {
                    return Ok(Target::Pair { id, total });
                }
            }
            match item {
                ItemKey::Year => return Ok(Target::Year),
                ItemKey::Comment => return Ok(Target::Comment(String::new())),
                ItemKey::Lyrics | ItemKey::UnsyncLyrics => {
                    return Ok(Target::Lyrics(String::new()))
                }
                ItemKey::MusicBrainzRecordingId => return Ok(Target::MusicBrainzUfid),
                _ => {}
            }
            let targets: Vec<Target> = native_candidates(item, TagType::Id3v2)
                .into_iter()
                .filter_map(|native| {
                    if TEXT_FRAMES.contains(&native) {
                        Some(Target::Text(native.to_string()))
                    } else if URL_FRAMES.contains(&native) {
                        Some(Target::Url(native.to_string()))
                    } else if is_frame_id(native) {
                        // Structured frames (TIPL, POPM, ...): store as TXXX below.
                        None
                    } else {
                        Some(Target::UserText(native.to_string()))
                    }
                })
                .collect();
            if let Some(existing) = targets
                .iter()
                .find(|t| self.iter().any(|f| frame_matches(f, t)))
            {
                return Ok(existing.clone());
            }
            if let Some(first) = targets.into_iter().next() {
                return Ok(first);
            }
            let name = canonical_name(item).unwrap_or(key);
            return Ok(Target::UserText(name.to_string()));
        }

        let existing = self.iter().find(|f| f.id_str() == key);
        match existing {
            Some(Frame::Text(_)) | Some(Frame::Timestamp(_)) => {
                return Ok(Target::Text(key.to_string()))
            }
            Some(Frame::Url(_)) => return Ok(Target::Url(key.to_string())),
            Some(_) => return Err(format!("ID3v2 frame {key} is read-only")),
            None => {}
        }
        if TEXT_FRAMES.contains(&key) {
            return Ok(Target::Text(key.to_string()));
        }
        if URL_FRAMES.contains(&key) {
            return Ok(Target::Url(key.to_string()));
        }
        Ok(Target::UserText(key.to_string()))
    }

    fn current_values(&self, target: &Target) -> Vec<String> {
        match target {
            Target::Year => text_value(self, "TDRC")
                .and_then(|date| year_of(&date))
                .into_iter()
                .collect(),
            other => self
                .listing()
                .into_iter()
                .filter(|(t, _)| t.as_ref() == Some(other))
                .map(|(_, e)| e.value)
                .collect(),
        }
    }

    fn write_values(&mut self, target: &Target, values: &[String]) -> Result<(), String> {
        let first = values.first().cloned().unwrap_or_default();
        let frame = match target {
            Target::Text(id) => text_frame(id, values)?,
            Target::Pair { id, total } => {
                let (number, old_total) = text_value(self, id)
                    .map(|v| split_pair(&v))
                    .unwrap_or((None, None));
                let joined = if *total {
                    join_pair(number.as_deref(), Some(&first))
                } else if first.contains('/') {
                    Some(first.clone())
                } else {
                    join_pair(Some(&first), old_total.as_deref())
                };
                text_frame(id, &[joined.unwrap_or_default()])?
            }
            Target::UserText(desc) => {
                let desc = self
                    .iter()
                    .find_map(|f| match f {
                        Frame::UserText(t) if same_text(&t.description, desc) => {
                            Some(t.description.to_string())
                        }
                        _ => None,
                    })
                    .unwrap_or_else(|| desc.clone());
                Frame::UserText(ExtendedTextFrame::new(
                    TextEncoding::UTF8,
                    desc,
                    values.join("\0"),
                ))
            }
            Target::Url(id) => Frame::Url(UrlLinkFrame::new(frame_id(id)?, first)),
            Target::UserUrl(desc) => Frame::UserUrl(ExtendedUrlFrame::new(
                TextEncoding::UTF8,
                desc.clone(),
                first,
            )),
            Target::Comment(desc) => {
                let language = self
                    .iter()
                    .find_map(|f| match f {
                        Frame::Comment(c) if same_text(&c.description, desc) => Some(c.language),
                        _ => None,
                    })
                    .unwrap_or(DEFAULT_LANGUAGE);
                Frame::Comment(CommentFrame::new(
                    TextEncoding::UTF8,
                    language,
                    desc.clone(),
                    values.join("\n"),
                ))
            }
            Target::Lyrics(desc) => {
                let language = self
                    .iter()
                    .find_map(|f| match f {
                        Frame::UnsynchronizedText(c) if same_text(&c.description, desc) => {
                            Some(c.language)
                        }
                        _ => None,
                    })
                    .unwrap_or(DEFAULT_LANGUAGE);
                Frame::UnsynchronizedText(UnsynchronizedTextFrame::new(
                    TextEncoding::UTF8,
                    language,
                    desc.clone(),
                    values.join("\n"),
                ))
            }
            Target::MusicBrainzUfid => Frame::UniqueFileIdentifier(UniqueFileIdentifierFrame::new(
                MUSICBRAINZ_UFID_OWNER,
                first.into_bytes(),
            )),
            Target::Year => {
                let date = text_value(self, "TDRC")
                    .and_then(|date| replace_year(&date, &first))
                    .unwrap_or(first);
                text_frame("TDRC", &[date])?
            }
        };
        replace_frames(self, target, frame);
        Ok(())
    }

    fn remove_target(&mut self, target: &Target) {
        if let Target::Pair { id, total: true } = target {
            let number = text_value(self, id).and_then(|v| split_pair(&v).0);
            if let Some(number) = number {
                if let Ok(frame) = text_frame(id, &[number]) {
                    replace_frames(self, target, frame);
                }
                return;
            }
        }
        self.retain(|f| !frame_matches(f, target));
    }
}

/// Work around what lofty cannot write back faithfully:
/// - `COMM`/`USLT` frames with a language that is not three ASCII letters
///   (some taggers write NUL bytes) make lofty refuse the whole write; they
///   get the "unknown" language `XXX`.
/// - lofty encodes a `WXXX` URL with the frame's text encoding, but the URL is
///   always Latin-1 (only the description uses the encoding), so a UTF-16
///   `WXXX` frame would come back garbled. Such frames are written as raw
///   bytes with the original encoding (UTF-16 when writing ID3v2.3, which has
///   no UTF-8).
///
/// Everything else is left as read.
pub(super) fn prepare_for_write(tag: &mut Id3v2Tag, v23: bool) {
    const UNKNOWN_LANGUAGE: [u8; 3] = *b"XXX";
    let valid = |language: &[u8; 3]| language.iter().all(u8::is_ascii_alphabetic);
    tag.retain_mut(|frame| {
        match frame {
            Frame::Comment(f) if !valid(&f.language) => f.language = UNKNOWN_LANGUAGE,
            Frame::UnsynchronizedText(f) if !valid(&f.language) => f.language = UNKNOWN_LANGUAGE,
            Frame::UserUrl(f) if f.encoding != TextEncoding::Latin1 => {
                let encoding = match f.encoding {
                    TextEncoding::UTF8 | TextEncoding::UTF16BE if v23 => TextEncoding::UTF16,
                    other => other,
                };
                let mut data = vec![encoding as u8];
                match encoding {
                    TextEncoding::UTF8 => {
                        data.extend_from_slice(f.description.as_bytes());
                        data.push(0);
                    }
                    TextEncoding::UTF16BE => {
                        for unit in f.description.encode_utf16() {
                            data.extend_from_slice(&unit.to_be_bytes());
                        }
                        data.extend_from_slice(&[0, 0]);
                    }
                    _ => {
                        data.extend_from_slice(&[0xFF, 0xFE]);
                        for unit in f.description.encode_utf16() {
                            data.extend_from_slice(&unit.to_le_bytes());
                        }
                        data.extend_from_slice(&[0, 0]);
                    }
                }
                data.extend(f.content.chars().map(|c| u8::try_from(c).unwrap_or(b'?')));
                let mut raw = Frame::Binary(BinaryFrame::new(
                    FrameId::Valid(Cow::Borrowed("WXXX")),
                    data,
                ));
                raw.set_flags(f.flags());
                *frame = raw;
            }
            _ => {}
        }
        true
    });
}

pub(super) fn set_cover(tag: &mut Id3v2Tag, picture: Picture) {
    tag.remove_picture_type(PictureType::CoverFront);
    tag.insert_picture(picture);
}

pub(super) fn remove_covers(tag: &mut Id3v2Tag) {
    for picture_type in super::COVER_TYPES {
        tag.remove_picture_type(picture_type);
    }
}
