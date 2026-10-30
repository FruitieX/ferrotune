//! Tag editing round trips on real files.
//!
//! Small audio files are encoded with ffmpeg in a temporary directory and
//! filled with representative non-standard tags through lofty's concrete tag
//! types (Vorbis `URL`/`UPC`/`SPOTIFY_ID`, ID3v2 `TXXX`/`WXXX`/`PRIV`/`UFID`/
//! `MCDI`, MP4 freeform atoms and `©url`, APE items). The tests then edit the
//! files through the HTTP API (single song, batch and tagger session paths)
//! and through the tag layer directly for formats the scanner does not index,
//! and check that every key the edit did not name is still in the file,
//! unchanged.
//!
//! Set `FERROTUNE_TAG_SAMPLES` to a directory of real files and run the
//! ignored `real_world_samples_round_trip` test to round-trip copies of them.

mod common;

use base64::Engine as _;
use common::{TestServer, TestServerConfig};
use ferrotune::api::common::tag_io::{self, CoverArtAction};
use ferrotune::api::tags::TagEntry;
use lofty::ape::{ApeItem, ApeTag};
use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::AudioFile;
use lofty::flac::FlacFile;
use lofty::id3::v1::Id3v1Tag;
use lofty::id3::v2::{
    AttachedPictureFrame, BinaryFrame, CommentFrame, ExtendedTextFrame, ExtendedUrlFrame, Frame,
    FrameId, Id3v2Tag, KeyValueFrame, PopularimeterFrame, PrivateFrame, TextInformationFrame,
    TimestampFrame, UniqueFileIdentifierFrame, UnsynchronizedTextFrame,
};
use lofty::iff::aiff::{AiffFile, AiffTextChunks};
use lofty::iff::wav::{RiffInfoList, WavFile};
use lofty::mp4::{Atom, AtomData, AtomIdent, DataType, Ilst, Mp4File};
use lofty::mpeg::MpegFile;
use lofty::ogg::tag::VorbisComments;
use lofty::ogg::{OggPictureStorage, OpusFile, SpeexFile, VorbisFile};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{Accessor, ItemValue, TagExt};
use lofty::wavpack::WavPackFile;
use lofty::TextEncoding;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::Command;

const COVER_PNG: &[u8] = include_bytes!("fixtures/cover.png");

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "ferrotune_{name}_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
enum Family {
    Vorbis,
    Id3v2,
    Mp4,
    Ape,
}

#[derive(Clone, Copy, Debug)]
enum Kind {
    Flac,
    Mp3,
    Mp3V23,
    M4a,
    Ogg,
    Opus,
    Wav,
    Aiff,
    WavPack,
    Speex,
}

impl Kind {
    const SCANNED: [Kind; 7] = [
        Kind::Flac,
        Kind::Mp3,
        Kind::Mp3V23,
        Kind::M4a,
        Kind::Ogg,
        Kind::Opus,
        Kind::Wav,
    ];
    const NOT_SCANNED: [Kind; 3] = [Kind::Aiff, Kind::WavPack, Kind::Speex];

    fn file_name(self) -> &'static str {
        match self {
            Kind::Flac => "flac.flac",
            Kind::Mp3 => "mp3v24.mp3",
            Kind::Mp3V23 => "mp3v23.mp3",
            Kind::M4a => "aac.m4a",
            Kind::Ogg => "vorbis.ogg",
            Kind::Opus => "opus.opus",
            Kind::Wav => "pcm.wav",
            Kind::Aiff => "pcm.aiff",
            Kind::WavPack => "wavpack.wv",
            Kind::Speex => "speex.spx",
        }
    }

    fn ffmpeg_args(self) -> &'static [&'static str] {
        match self {
            Kind::Flac => &["-c:a", "flac"],
            Kind::Mp3 | Kind::Mp3V23 => &["-c:a", "libmp3lame", "-b:a", "64k"],
            Kind::M4a => &["-c:a", "aac", "-b:a", "64k"],
            Kind::Ogg => &["-c:a", "libvorbis"],
            Kind::Opus => &["-c:a", "libopus", "-ar", "48000"],
            Kind::Wav => &["-c:a", "pcm_s16le"],
            Kind::Aiff => &["-c:a", "pcm_s16be"],
            Kind::WavPack => &["-c:a", "wavpack"],
            Kind::Speex => &["-c:a", "libspeex", "-ar", "16000"],
        }
    }

    fn family(self) -> Family {
        match self {
            Kind::Flac | Kind::Ogg | Kind::Opus | Kind::Speex => Family::Vorbis,
            Kind::Mp3 | Kind::Mp3V23 | Kind::Wav | Kind::Aiff => Family::Id3v2,
            Kind::M4a => Family::Mp4,
            Kind::WavPack => Family::Ape,
        }
    }
}

/// Native identifiers and API keys used by the checks, per tag family.
struct Spec {
    title: &'static [&'static str],
    album: &'static [&'static str],
    genre: &'static [&'static str],
    pictures: &'static [&'static str],
    /// Native ids of the custom key, the edited key and the deleted key.
    custom: &'static [&'static str],
    custom_native: &'static str,
    edit_key: &'static str,
    delete_key: &'static str,
    expected_keys: &'static [&'static str],
    read_only_keys: &'static [&'static str],
}

impl Family {
    fn spec(self) -> Spec {
        match self {
            Family::Vorbis => Spec {
                title: &["TITLE"],
                album: &["ALBUM"],
                genre: &["GENRE"],
                pictures: &["PICTURE"],
                custom: &["MY_CUSTOM", "URL", "DUMPER"],
                custom_native: "MY_CUSTOM",
                edit_key: "URL",
                delete_key: "DUMPER",
                expected_keys: &[
                    "TITLE",
                    "ARTIST",
                    "ALBUMARTIST",
                    "URL",
                    "UPC",
                    "SPOTIFY_ID",
                    "SPOTIFY_ALBUM_ID",
                    "DUMPER",
                    "WWW",
                    "MUSICBRAINZ_ALBUMID",
                    "DATE",
                    "TRACKNUMBER",
                ],
                read_only_keys: &[],
            },
            Family::Id3v2 => Spec {
                title: &["TIT2"],
                album: &["TALB"],
                genre: &["TCON"],
                pictures: &["APIC"],
                custom: &["TXXX:MY_CUSTOM", "TXXX:Source", "TXXX:Catalog #"],
                custom_native: "TXXX:MY_CUSTOM",
                edit_key: "Source",
                delete_key: "Catalog #",
                expected_keys: &[
                    "TITLE",
                    "ARTIST",
                    "ALBUMARTIST",
                    "TRACKNUMBER",
                    "TRACKTOTAL",
                    "DATE",
                    "Source",
                    "MP3GAIN_MINMAX",
                    "Catalog #",
                    "MUSICBRAINZ_ALBUMID",
                    "MUSICBRAINZ_TRACKID",
                    "TXXX:ALBUMARTIST",
                    "WXXX:Tidal",
                    "COMMENT",
                    "COMM:iTunNORM",
                    "LYRICS",
                ],
                read_only_keys: &[
                    "PRIV:Google/OriginalClientId",
                    "PRIV:WM/MediaClassPrimaryID",
                    "UFID:http://www.cddb.com/id3/taginfo1.html",
                    "MCDI",
                    "POPM:rater@example.com",
                    "TIPL",
                ],
            },
            Family::Mp4 => Spec {
                title: &["©nam"],
                album: &["©alb"],
                genre: &["©gen"],
                pictures: &["covr"],
                custom: &[
                    "----:com.apple.iTunes:MY_CUSTOM",
                    "----:com.apple.iTunes:UPC",
                    "----:org.example:Custom",
                ],
                custom_native: "----:com.apple.iTunes:MY_CUSTOM",
                edit_key: "UPC",
                delete_key: "----:org.example:Custom",
                expected_keys: &[
                    "TITLE",
                    "ARTIST",
                    "©url",
                    "COMPILATION",
                    "BPM",
                    "UPC",
                    "----:com.apple.iTunes:UNSYNCEDLYRICS",
                    "REPLAYGAIN_TRACK_GAIN",
                    "----:org.example:Custom",
                    "TRACKNUMBER",
                    "TRACKTOTAL",
                ],
                read_only_keys: &["plID"],
            },
            Family::Ape => Spec {
                title: &["TITLE"],
                album: &["ALBUM"],
                genre: &["GENRE"],
                pictures: &["COVER ART (FRONT)"],
                custom: &["MY_CUSTOM", "CATALOG", "RIPPER"],
                custom_native: "MY_CUSTOM",
                edit_key: "CATALOG",
                delete_key: "Ripper",
                expected_keys: &[
                    "TITLE",
                    "ARTIST",
                    "ALBUMARTIST",
                    "TRACKNUMBER",
                    "TRACKTOTAL",
                    "CATALOG",
                    "Ripper",
                ],
                read_only_keys: &["Binary Thing"],
            },
        }
    }
}

fn require_ffmpeg() {
    let ok = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    assert!(
        ok,
        "ffmpeg is required for tag editing tests (run inside `nix develop`)"
    );
}

fn encode(dir: &Path, kind: Kind, frequency: u32) -> PathBuf {
    let path = dir.join(kind.file_name());
    let source = format!("sine=frequency={frequency}:sample_rate=44100:duration=0.5");
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
        ])
        .arg(&source)
        .args(kind.ffmpeg_args())
        .args([
            "-map_metadata",
            "-1",
            "-fflags",
            "+bitexact",
            "-flags:a",
            "+bitexact",
        ])
        .arg(&path)
        .output()
        .expect("failed to run ffmpeg");
    assert!(
        output.status.success(),
        "ffmpeg failed for {kind:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    path
}

fn cover() -> Picture {
    Picture::unchecked(COVER_PNG.to_vec())
        .pic_type(PictureType::CoverFront)
        .mime_type(MimeType::Png)
        .build()
}

fn fixture_comments() -> VorbisComments {
    let mut c = VorbisComments::new();
    for (k, v) in [
        ("TITLE", "Original Title"),
        ("ARTIST", "Artist A"),
        ("ARTIST", "Artist B"),
        ("ALBUM", "Original Album"),
        ("ALBUM ARTIST", "Various Artists"),
        ("URL", "https://tidal.com/browse/track/12345"),
        ("UPC", "00602537000000"),
        ("SPOTIFY_ID", "4uLU6hMCjMI75M1A2tKUQC"),
        ("SPOTIFY_ID", "second-value"),
        ("SPOTIFY_ALBUM_ID", "1DFixLWuPkv3KT3TnV35m3"),
        ("DUMPER", "someone"),
        ("TAGGER", "someone else"),
        ("WWW", "https://vgmrips.net"),
        (
            "MUSICBRAINZ_ALBUMID",
            "8b0b8d1d-0000-4000-8000-000000000001",
        ),
        ("DATE", "2019-05-01"),
        ("TRACKNUMBER", "3"),
        ("GENRE", "Original Genre"),
    ] {
        c.push(k.to_string(), v.to_string());
    }
    c
}

fn text(id: &'static str, value: &str) -> Frame<'static> {
    Frame::Text(TextInformationFrame::new(
        FrameId::Valid(Cow::Borrowed(id)),
        TextEncoding::UTF8,
        value.to_string(),
    ))
}

fn txxx(desc: &str, value: &str) -> Frame<'static> {
    Frame::UserText(ExtendedTextFrame::new(
        TextEncoding::UTF8,
        desc.to_string(),
        value.to_string(),
    ))
}

fn fixture_id3() -> Id3v2Tag {
    let mut t = Id3v2Tag::new();
    t.insert(text("TIT2", "Original Title"));
    t.insert(text("TPE1", "Artist A"));
    t.insert(text("TALB", "Original Album"));
    t.insert(text("TPE2", "Various Artists"));
    t.insert(text("TRCK", "3/12"));
    t.insert(text("TCON", "Original Genre"));
    t.insert(Frame::Timestamp(TimestampFrame::new(
        FrameId::Valid(Cow::Borrowed("TDRC")),
        TextEncoding::UTF8,
        "2019-05-01".parse().unwrap(),
    )));
    t.insert(txxx("Source", "Vinyl"));
    t.insert(txxx("MP3GAIN_MINMAX", "120,210"));
    t.insert(txxx("Catalog #", "CAT-001"));
    t.insert(txxx(
        "MusicBrainz Album Id",
        "8b0b8d1d-0000-4000-8000-000000000001",
    ));
    t.insert(txxx("ALBUMARTIST", "Shadowed by TPE2"));
    t.insert(Frame::UserUrl(ExtendedUrlFrame::new(
        TextEncoding::Latin1,
        "Tidal".to_string(),
        "https://tidal.com/browse/track/12345".to_string(),
    )));
    t.insert(Frame::Comment(CommentFrame::new(
        TextEncoding::UTF8,
        *b"eng",
        String::new(),
        "A comment".to_string(),
    )));
    t.insert(Frame::Comment(CommentFrame::new(
        TextEncoding::UTF8,
        *b"eng",
        "iTunNORM".to_string(),
        " 00000A1B 00000C2D".to_string(),
    )));
    t.insert(Frame::UnsynchronizedText(UnsynchronizedTextFrame::new(
        TextEncoding::UTF8,
        *b"eng",
        String::new(),
        "la la la".to_string(),
    )));
    t.insert(Frame::Private(PrivateFrame::new(
        "Google/OriginalClientId",
        b"AQ12345678".to_vec(),
    )));
    t.insert(Frame::Private(PrivateFrame::new(
        "WM/MediaClassPrimaryID",
        vec![
            0xBC, 0x7D, 0x60, 0xD1, 0x23, 0xE3, 0xE2, 0x4B, 0x86, 0xA1, 0x48, 0xA4, 0x2A, 0x28,
            0x44, 0x1E,
        ],
    )));
    t.insert(Frame::UniqueFileIdentifier(UniqueFileIdentifierFrame::new(
        "http://www.cddb.com/id3/taginfo1.html",
        b"3CD3N48Q24".to_vec(),
    )));
    t.insert(Frame::UniqueFileIdentifier(UniqueFileIdentifierFrame::new(
        "http://musicbrainz.org",
        b"0d6b2c8e-0000-4000-8000-000000000002".to_vec(),
    )));
    t.insert(Frame::Binary(BinaryFrame::new(
        FrameId::Valid(Cow::Borrowed("MCDI")),
        vec![0x01, 0x02, 0x03, 0x04, 0x05],
    )));
    t.insert(Frame::Popularimeter(PopularimeterFrame::new(
        "rater@example.com",
        196,
        7,
    )));
    t.insert(Frame::KeyValue(KeyValueFrame::new(
        FrameId::Valid(Cow::Borrowed("TIPL")),
        TextEncoding::UTF8,
        vec![(Cow::Borrowed("producer"), Cow::Borrowed("Someone"))],
    )));
    t.insert(Frame::Picture(AttachedPictureFrame::new(
        TextEncoding::UTF8,
        cover(),
    )));
    t
}

fn fixture_ilst() -> Ilst {
    let mut t = Ilst::new();
    let fourcc = |b: &[u8; 4], v: &str| Atom::new(AtomIdent::Fourcc(*b), AtomData::UTF8(v.into()));
    let free = |mean: &'static str, name: &'static str, v: &str| {
        Atom::new(
            AtomIdent::Freeform {
                mean: Cow::Borrowed(mean),
                name: Cow::Borrowed(name),
            },
            AtomData::UTF8(v.into()),
        )
    };
    t.insert(fourcc(b"\xa9nam", "Original Title"));
    t.insert(
        Atom::from_collection(
            AtomIdent::Fourcc(*b"\xa9ART"),
            vec![
                AtomData::UTF8("Artist A".into()),
                AtomData::UTF8("Artist B".into()),
            ],
        )
        .unwrap(),
    );
    t.insert(fourcc(b"\xa9alb", "Original Album"));
    t.insert(fourcc(b"\xa9gen", "Original Genre"));
    t.insert(fourcc(b"\xa9day", "2019-05-01"));
    t.insert(fourcc(b"\xa9url", "https://example.com/track"));
    t.insert(Atom::new(AtomIdent::Fourcc(*b"cpil"), AtomData::Bool(true)));
    t.insert(Atom::new(
        AtomIdent::Fourcc(*b"tmpo"),
        AtomData::SignedInteger(120),
    ));
    t.insert(free("com.apple.iTunes", "UPC", "00602537000000"));
    t.insert(free("com.apple.iTunes", "UNSYNCEDLYRICS", "la la la"));
    t.insert(free(
        "com.apple.iTunes",
        "replaygain_track_gain",
        "-6.50 dB",
    ));
    t.insert(free("org.example", "Custom", "custom value"));
    t.insert(Atom::new(
        AtomIdent::Fourcc(*b"plID"),
        // iTunes album ID: a 64-bit integer, kept by lofty as opaque data.
        AtomData::Unknown {
            code: DataType::BeSignedInteger,
            data: vec![0, 0, 0, 0, 0x12, 0x34, 0x56, 0x78],
        },
    ));
    t.set_track(3);
    t.set_track_total(12);
    t.insert_picture(cover());
    t
}

fn fixture_ape() -> ApeTag {
    let mut t = ApeTag::new();
    for (k, v) in [
        ("Title", "Original Title"),
        ("Artist", "Artist A\0Artist B"),
        ("Album", "Original Album"),
        ("Album Artist", "Various Artists"),
        ("Genre", "Original Genre"),
        ("Track", "3/12"),
        ("CATALOG", "CAT-001"),
        ("Ripper", "someone"),
    ] {
        t.insert(ApeItem::new(k.to_string(), ItemValue::Text(v.to_string())).unwrap());
    }
    t.insert(
        ApeItem::new(
            "Binary Thing".to_string(),
            ItemValue::Binary(vec![0, 1, 2, 3]),
        )
        .unwrap(),
    );
    t.insert(
        ApeItem::new(
            "Cover Art (Front)".to_string(),
            ItemValue::Binary(cover().as_ape_bytes()),
        )
        .unwrap(),
    );
    t
}

fn read_options() -> ParseOptions {
    ParseOptions::new()
}

fn with_cover(mut comments: VorbisComments) -> VorbisComments {
    comments.insert_picture(cover(), None).unwrap();
    comments
}

/// Write the fixture tags with lofty's own writers.
fn populate(kind: Kind, path: &Path) {
    let mut file = File::open(path).unwrap();
    let opts = WriteOptions::default();
    match kind {
        Kind::Flac => {
            let mut f = FlacFile::read_from(&mut file, read_options()).unwrap();
            f.set_vorbis_comments(fixture_comments());
            f.insert_picture(cover(), None).unwrap();
            f.save_to_path(path, opts).unwrap();
        }
        Kind::Ogg => {
            let mut f = VorbisFile::read_from(&mut file, read_options()).unwrap();
            f.set_vorbis_comments(with_cover(fixture_comments()));
            f.save_to_path(path, opts).unwrap();
        }
        Kind::Opus => {
            let mut f = OpusFile::read_from(&mut file, read_options()).unwrap();
            f.set_vorbis_comments(with_cover(fixture_comments()));
            f.save_to_path(path, opts).unwrap();
        }
        Kind::Speex => {
            let mut f = SpeexFile::read_from(&mut file, read_options()).unwrap();
            f.set_vorbis_comments(with_cover(fixture_comments()));
            f.save_to_path(path, opts).unwrap();
        }
        Kind::Mp3 | Kind::Mp3V23 => {
            let v23 = matches!(kind, Kind::Mp3V23);
            fixture_id3()
                .save_to_path(path, WriteOptions::new().use_id3v23(v23))
                .unwrap();
            let v1 = Id3v1Tag {
                title: Some("ID3v1 title".to_string()),
                artist: Some("ID3v1 artist".to_string()),
                ..Default::default()
            };
            v1.save_to_path(path, opts).unwrap();
        }
        Kind::Wav => {
            fixture_id3().save_to_path(path, opts).unwrap();
            let mut info = RiffInfoList::new();
            info.insert("INAM".to_string(), "RIFF title".to_string());
            info.insert("ISFT".to_string(), "RIFF software".to_string());
            info.save_to_path(path, opts).unwrap();
        }
        Kind::Aiff => {
            fixture_id3().save_to_path(path, opts).unwrap();
            let chunks = AiffTextChunks {
                name: Some("AIFF name".to_string()),
                author: Some("AIFF author".to_string()),
                annotations: Some(vec!["AIFF annotation".to_string()]),
                ..Default::default()
            };
            chunks.save_to_path(path, opts).unwrap();
        }
        Kind::M4a => fixture_ilst().save_to_path(path, opts).unwrap(),
        Kind::WavPack => fixture_ape().save_to_path(path, opts).unwrap(),
    }
}

// ---------------------------------------------------------------------------
// Native snapshots
// ---------------------------------------------------------------------------

/// Every item of every tag block in the file as (id, full debug dump).
type Snapshot = Vec<(String, String)>;

fn id3_snapshot(tag: &Id3v2Tag, out: &mut Snapshot) {
    out.push((
        "ID3V2_VERSION".to_string(),
        format!("{:?}", tag.original_version()),
    ));
    for frame in tag.iter() {
        // Languages that are not three letters are written as "XXX".
        let mut frame = frame.clone();
        match &mut frame {
            Frame::Comment(f) if !f.language.iter().all(u8::is_ascii_alphabetic) => {
                f.language = *b"XXX"
            }
            Frame::UnsynchronizedText(f) if !f.language.iter().all(u8::is_ascii_alphabetic) => {
                f.language = *b"XXX"
            }
            _ => {}
        }
        let frame = &frame;
        let id = match frame {
            Frame::UserText(f) => format!("TXXX:{}", f.description),
            Frame::UserUrl(f) => format!("WXXX:{}", f.description),
            Frame::Comment(f) => format!("COMM:{}", f.description),
            Frame::UnsynchronizedText(f) => format!("USLT:{}", f.description),
            Frame::Private(f) => format!("PRIV:{}", f.owner),
            Frame::UniqueFileIdentifier(f) => format!("UFID:{}", f.owner),
            Frame::Popularimeter(f) => format!("POPM:{}", f.email),
            other => other.id_str().to_string(),
        };
        out.push((id, format!("{frame:?}")));
    }
}

fn vorbis_snapshot(tag: &VorbisComments, out: &mut Snapshot) {
    for (k, v) in tag.items() {
        out.push((k.to_ascii_uppercase(), format!("{k}={v}")));
    }
    for (picture, info) in tag.pictures() {
        out.push(("PICTURE".to_string(), format!("{picture:?} {info:?}")));
    }
}

fn ape_snapshot(tag: &ApeTag, out: &mut Snapshot) {
    for item in tag {
        out.push((item.key().to_ascii_uppercase(), format!("{item:?}")));
    }
}

fn snapshot(kind: Kind, path: &Path) -> Snapshot {
    let mut file = File::open(path).unwrap();
    let mut out = Snapshot::new();
    match kind {
        Kind::Flac => {
            let f = FlacFile::read_from(&mut file, read_options()).unwrap();
            if let Some(t) = f.vorbis_comments() {
                vorbis_snapshot(t, &mut out);
            }
            for (picture, info) in f.pictures() {
                out.push(("PICTURE".to_string(), format!("{picture:?} {info:?}")));
            }
        }
        Kind::Ogg => vorbis_snapshot(
            VorbisFile::read_from(&mut file, read_options())
                .unwrap()
                .vorbis_comments(),
            &mut out,
        ),
        Kind::Opus => vorbis_snapshot(
            OpusFile::read_from(&mut file, read_options())
                .unwrap()
                .vorbis_comments(),
            &mut out,
        ),
        Kind::Speex => vorbis_snapshot(
            SpeexFile::read_from(&mut file, read_options())
                .unwrap()
                .vorbis_comments(),
            &mut out,
        ),
        Kind::Mp3 | Kind::Mp3V23 => {
            let f = MpegFile::read_from(&mut file, read_options()).unwrap();
            if let Some(t) = f.id3v2() {
                id3_snapshot(t, &mut out);
            }
            out.push(("ID3V1".to_string(), format!("{:?}", f.id3v1())));
        }
        Kind::Wav => {
            let f = WavFile::read_from(&mut file, read_options()).unwrap();
            if let Some(t) = f.id3v2() {
                id3_snapshot(t, &mut out);
            }
            out.push(("RIFF".to_string(), format!("{:?}", f.riff_info())));
        }
        Kind::Aiff => {
            let f = AiffFile::read_from(&mut file, read_options()).unwrap();
            if let Some(t) = f.id3v2() {
                id3_snapshot(t, &mut out);
            }
            out.push(("AIFF_TEXT".to_string(), format!("{:?}", f.text_chunks())));
        }
        Kind::M4a => {
            let f = Mp4File::read_from(&mut file, read_options()).unwrap();
            for atom in f.ilst().into_iter().flatten() {
                let id = match atom.ident() {
                    AtomIdent::Fourcc(b) => b.iter().map(|&c| c as char).collect(),
                    AtomIdent::Freeform { mean, name } => format!("----:{mean}:{name}"),
                };
                out.push((id, format!("{atom:?}")));
            }
        }
        Kind::WavPack => {
            let f = WavPackFile::read_from(&mut file, read_options()).unwrap();
            if let Some(t) = f.ape() {
                ape_snapshot(t, &mut out);
            }
            out.push(("ID3V1".to_string(), format!("{:?}", f.id3v1())));
        }
    }
    // The audio stream must still parse.
    let properties = lofty::read_from_path(path).unwrap();
    out.push((
        "DURATION".to_string(),
        format!(
            "{:?}",
            lofty::file::AudioFile::properties(&properties).duration()
        ),
    ));
    out
}

/// Assert that every item except those with an id in `changed` is unchanged
/// and in the same order.
fn assert_preserved(kind: Kind, before: &Snapshot, after: &Snapshot, changed: &[&str]) {
    let keep = |s: &Snapshot| -> Vec<(String, String)> {
        s.iter()
            .filter(|(id, _)| !changed.iter().any(|c| c.eq_ignore_ascii_case(id)))
            .cloned()
            .collect()
    };
    let (mut b, mut a) = (keep(before), keep(after));
    let id3v23 = before
        .iter()
        .any(|(id, debug)| id == "ID3V2_VERSION" && debug == "V3");
    if id3v23 {
        // lofty converts TYER/TDAT/TIME to TDRC when reading ID3v2.3 and back
        // when writing it, which moves the date frame. Frame order carries no
        // meaning in ID3v2; compare contents only.
        b.sort();
        a.sort();
    }
    if b != a {
        for (x, y) in b.iter().zip(a.iter()) {
            if x != y {
                eprintln!("{kind:?}: first difference:\n  before {x:?}\n  after  {y:?}");
                break;
            }
        }
        panic!(
            "{kind:?}: items outside {changed:?} changed ({} before, {} after)",
            b.len(),
            a.len()
        );
    }
}

fn ids(s: &Snapshot) -> Vec<&str> {
    s.iter().map(|(id, _)| id.as_str()).collect()
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

struct Api<'a> {
    server: &'a TestServer,
    client: reqwest::blocking::Client,
}

impl Api<'_> {
    fn new(server: &TestServer) -> Api<'_> {
        Api {
            server,
            client: reqwest::blocking::Client::new(),
        }
    }

    fn request(
        &self,
        method: reqwest::Method,
        endpoint: &str,
    ) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(method, self.server.api_url(endpoint))
            .basic_auth(&self.server.admin_user, Some(&self.server.admin_password))
    }

    fn get(&self, endpoint: &str) -> Value {
        let response = self.request(reqwest::Method::GET, endpoint).send().unwrap();
        assert!(
            response.status().is_success(),
            "GET {endpoint}: {}",
            response.status()
        );
        response.json().unwrap()
    }

    fn send(&self, method: reqwest::Method, endpoint: &str, body: Value) -> (u16, Value) {
        let response = self.request(method, endpoint).json(&body).send().unwrap();
        let status = response.status().as_u16();
        let text = response.text().unwrap_or_default();
        (status, serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    fn patch_tags(&self, song_id: &str, set: &[(&str, &str)], delete: &[&str]) -> (u16, Value) {
        let set: Vec<Value> = set
            .iter()
            .map(|(k, v)| json!({"key": k, "value": v}))
            .collect();
        self.send(
            reqwest::Method::PATCH,
            &format!("songs/{song_id}/tags"),
            json!({"set": set, "delete": delete}),
        )
    }

    fn tags(&self, song_id: &str) -> Value {
        self.get(&format!("songs/{song_id}/tags"))
    }
}

fn entry_values(tags: &Value, key: &str) -> Vec<String> {
    tags["tags"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["key"] == key)
        .map(|e| e["value"].as_str().unwrap().to_string())
        .collect()
}

fn check_listing(kind: Kind, tags: &Value) {
    let spec = kind.family().spec();
    let entries = tags["tags"].as_array().unwrap();
    let keys: Vec<&str> = entries.iter().map(|e| e["key"].as_str().unwrap()).collect();
    for key in spec.expected_keys {
        assert!(
            keys.contains(key),
            "{kind:?}: missing key {key} in {keys:?}"
        );
    }
    for key in spec.read_only_keys {
        let entry = entries
            .iter()
            .find(|e| e["key"] == *key)
            .unwrap_or_else(|| panic!("{kind:?}: missing read-only key {key} in {keys:?}"));
        assert_eq!(
            entry["readOnly"], true,
            "{kind:?}: {key} should be read-only"
        );
    }
    for entry in entries {
        if !spec
            .read_only_keys
            .contains(&entry["key"].as_str().unwrap())
        {
            assert!(
                entry.get("readOnly").is_none(),
                "{kind:?}: {entry} is read-only"
            );
        }
    }
    if kind.family() == Family::Vorbis {
        assert_eq!(
            entry_values(tags, "SPOTIFY_ID"),
            ["4uLU6hMCjMI75M1A2tKUQC", "second-value"]
        );
        let album_artist = entries.iter().find(|e| e["key"] == "ALBUMARTIST").unwrap();
        assert_eq!(album_artist["nativeKey"], "ALBUM ARTIST");
    }
}

/// Exercise the single-song endpoint on one file.
fn single_song_round_trip(api: &Api<'_>, kind: Kind, song_id: &str, path: &Path) {
    let spec = kind.family().spec();
    let tags = api.tags(song_id);
    check_listing(kind, &tags);

    // Editing a standard field keeps everything else.
    let before = snapshot(kind, path);
    let (status, body) = api.patch_tags(song_id, &[("TITLE", "Edited Title")], &[]);
    assert_eq!(status, 200, "{kind:?}: {body}");
    let after = snapshot(kind, path);
    assert_preserved(kind, &before, &after, spec.title);
    assert_eq!(entry_values(&api.tags(song_id), "TITLE"), ["Edited Title"]);

    // Add a multi-valued custom key, edit one non-standard key, delete another.
    let before = after;
    let (status, body) = api.patch_tags(
        song_id,
        &[
            ("MY_CUSTOM", "first"),
            ("MY_CUSTOM", "second"),
            (spec.edit_key, "edited value"),
        ],
        &[spec.delete_key],
    );
    assert_eq!(status, 200, "{kind:?}: {body}");
    let after = snapshot(kind, path);
    assert_preserved(kind, &before, &after, spec.custom);
    assert!(
        ids(&after).contains(&spec.custom_native),
        "{kind:?}: {:?}",
        ids(&after)
    );
    let tags = api.tags(song_id);
    assert_eq!(entry_values(&tags, "MY_CUSTOM"), ["first", "second"]);
    assert_eq!(entry_values(&tags, spec.edit_key), ["edited value"]);
    assert!(entry_values(&tags, spec.delete_key).is_empty());

    // Read-only keys are rejected without touching the file.
    if let Some(read_only) = spec.read_only_keys.first() {
        let bytes = std::fs::read(path).unwrap();
        let (status, _) = api.patch_tags(song_id, &[(read_only, "x")], &[]);
        assert_eq!(status, 400, "{kind:?}: editing {read_only} should fail");
        let (status, _) = api.patch_tags(song_id, &[], &[read_only]);
        assert_eq!(status, 400, "{kind:?}: deleting {read_only} should fail");
        assert_eq!(
            bytes,
            std::fs::read(path).unwrap(),
            "{kind:?}: file changed"
        );
    }
}

fn song_ids_by_file(api: &Api<'_>) -> HashMap<String, String> {
    let ids = api.get("songs/ids");
    ids["ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| {
            let id = id.as_str().unwrap().to_string();
            let tags = api.tags(&id);
            let file = Path::new(tags["filePath"].as_str().unwrap())
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            (file, id)
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn api_edits_preserve_non_standard_tags() {
    require_ffmpeg();
    let music = TempDir::new("tag_api_music");
    let mut paths = HashMap::new();
    for (i, kind) in Kind::SCANNED.into_iter().enumerate() {
        let path = encode(&music.0, kind, 300 + 50 * i as u32);
        populate(kind, &path);
        paths.insert(kind.file_name().to_string(), (kind, path));
    }

    let server = TestServer::with_config(TestServerConfig {
        music_path: Some(music.0.clone()),
        readonly_tags: Some(false),
        ..Default::default()
    })
    .expect("failed to start server");
    server.scan_library().expect("scan failed");
    let api = Api::new(&server);
    let songs = song_ids_by_file(&api);
    assert_eq!(songs.len(), Kind::SCANNED.len(), "scanned songs: {songs:?}");

    for (file, (kind, path)) in &paths {
        single_song_round_trip(&api, *kind, &songs[file], path);
    }

    // Batch update with cover art: only the album and pictures change.
    let before: HashMap<&String, Snapshot> = paths
        .iter()
        .map(|(file, (kind, path))| (file, snapshot(*kind, path)))
        .collect();
    let cover_b64 = base64::engine::general_purpose::STANDARD.encode(COVER_PNG);
    let updates: Vec<Value> = paths
        .keys()
        .map(|file| {
            json!({
                "songId": songs[file],
                "set": [{"key": "ALBUM", "value": "Batch Album"}],
                "delete": [],
                "coverArtAction": "set",
                "coverArtData": cover_b64,
                "coverArtMimeType": "image/png",
            })
        })
        .collect();
    let (status, body) = api.send(
        reqwest::Method::PATCH,
        "tagger/batch-tags",
        json!({"updates": updates}),
    );
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["success"], true, "{body}");
    for (file, (kind, path)) in &paths {
        let spec = kind.family().spec();
        let changed: Vec<&str> = spec.album.iter().chain(spec.pictures).copied().collect();
        let after = snapshot(*kind, path);
        assert_preserved(*kind, &before[file], &after, &changed);
        assert!(
            ids(&after).iter().any(|id| spec.pictures.contains(id)),
            "{kind:?}: no cover"
        );
        assert_eq!(
            entry_values(&api.tags(&songs[file]), "ALBUM"),
            ["Batch Album"]
        );
    }

    // Tagger session save: GENRE set, MY_CUSTOM cleared with an empty value.
    let tracks: Vec<Value> = paths
        .keys()
        .map(|file| json!({"id": songs[file], "trackType": "library"}))
        .collect();
    let (status, body) = api.send(
        reqwest::Method::PUT,
        "tagger/session/tracks",
        json!({"tracks": tracks}),
    );
    assert!(status < 300, "{status} {body}");
    for file in paths.keys() {
        let (status, body) = api.send(
            reqwest::Method::PUT,
            &format!("tagger/session/edits/{}", songs[file]),
            json!({
                "editedTags": {"GENRE": "Session Genre", "MY_CUSTOM": ""},
                "computedPath": null,
                "coverArtRemoved": false,
            }),
        );
        assert!(status < 300, "{status} {body}");
    }
    let before: HashMap<&String, Snapshot> = paths
        .iter()
        .map(|(file, (kind, path))| (file, snapshot(*kind, path)))
        .collect();
    let track_ids: Vec<&String> = paths.keys().map(|file| &songs[file]).collect();
    let (status, body) = api.send(
        reqwest::Method::POST,
        "tagger/session/save",
        json!({"trackIds": track_ids}),
    );
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["success"], true, "{body}");
    for (file, (kind, path)) in &paths {
        let spec = kind.family().spec();
        let changed: Vec<&str> = spec
            .genre
            .iter()
            .chain([&spec.custom_native])
            .copied()
            .collect();
        let after = snapshot(*kind, path);
        assert_preserved(*kind, &before[file], &after, &changed);
        assert!(
            !ids(&after).contains(&spec.custom_native),
            "{kind:?}: MY_CUSTOM kept"
        );
        let tags = api.tags(&songs[file]);
        assert_eq!(entry_values(&tags, "GENRE"), ["Session Genre"], "{kind:?}");
    }

    // Replacing the audio of an MP3 keeps all of its tags, binary frames included.
    let (kind, path) = &paths[Kind::Mp3.file_name()];
    let song_id = &songs[Kind::Mp3.file_name()];
    let before = snapshot(*kind, path);
    let replacement_dir = TempDir::new("tag_api_replacement");
    let replacement = encode(&replacement_dir.0, Kind::Mp3, 880);
    let form = reqwest::blocking::multipart::Form::new()
        .file("file", &replacement)
        .unwrap();
    let response = api
        .request(
            reqwest::Method::PUT,
            &format!("tagger/session/edits/{song_id}/replacement-audio"),
        )
        .multipart(form)
        .send()
        .unwrap();
    assert!(
        response.status().is_success(),
        "{}",
        response.text().unwrap()
    );
    let (status, body) = api.send(
        reqwest::Method::POST,
        "tagger/session/save",
        json!({"trackIds": [song_id]}),
    );
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["success"], true, "{body}");
    let after = snapshot(*kind, path);
    // The replacement has its own ID3v1 tag and duration.
    assert_preserved(*kind, &before, &after, &["ID3V1", "DURATION"]);
}

#[test]
fn tag_layer_preserves_formats_the_scanner_skips() {
    require_ffmpeg();
    let dir = TempDir::new("tag_layer");
    for (i, kind) in Kind::NOT_SCANNED.into_iter().enumerate() {
        let path = encode(&dir.0, kind, 500 + 50 * i as u32);
        populate(kind, &path);
        let spec = kind.family().spec();

        let listing = tag_io::read_tags(&path).unwrap();
        let keys: Vec<&str> = listing.tags.iter().map(|e| e.key.as_str()).collect();
        for key in spec.expected_keys {
            assert!(keys.contains(key), "{kind:?}: missing {key} in {keys:?}");
        }
        assert!(
            !listing.additional.is_empty() || kind.family() != Family::Id3v2,
            "{kind:?}: secondary tag blocks are listed"
        );

        let before = snapshot(kind, &path);
        tag_io::update_tags(
            &path,
            &[TagEntry::new("TITLE", "Edited Title")],
            &[],
            CoverArtAction::Keep,
        )
        .unwrap();
        let after = snapshot(kind, &path);
        assert_preserved(kind, &before, &after, spec.title);

        let before = after;
        tag_io::update_tags(
            &path,
            &[
                TagEntry::new("MY_CUSTOM", "first"),
                TagEntry::new("MY_CUSTOM", "second"),
                TagEntry::new(spec.edit_key, "edited value"),
            ],
            &[spec.delete_key.to_string()],
            CoverArtAction::Keep,
        )
        .unwrap();
        let after = snapshot(kind, &path);
        assert_preserved(kind, &before, &after, spec.custom);
        let listing = tag_io::read_tags(&path).unwrap();
        let values = |key: &str| -> Vec<String> {
            listing
                .tags
                .iter()
                .filter(|e| e.key == key)
                .map(|e| e.value.clone())
                .collect()
        };
        assert_eq!(values("MY_CUSTOM"), ["first", "second"], "{kind:?}");
        assert_eq!(values(spec.edit_key), ["edited value"], "{kind:?}");
        assert!(values(spec.delete_key).is_empty(), "{kind:?}");

        let before = after;
        tag_io::update_tags(
            &path,
            &[],
            &[],
            CoverArtAction::Set(COVER_PNG.to_vec(), "image/png".to_string()),
        )
        .unwrap();
        let after = snapshot(kind, &path);
        assert_preserved(kind, &before, &after, spec.pictures);
        tag_io::update_tags(&path, &[], &[], CoverArtAction::Remove).unwrap();
        let after = snapshot(kind, &path);
        assert_preserved(kind, &before, &after, spec.pictures);
        assert!(
            !ids(&after).iter().any(|id| spec.pictures.contains(id)),
            "{kind:?}: cover not removed"
        );
    }
}

#[test]
fn transfer_tags_across_formats() {
    require_ffmpeg();
    let dir = TempDir::new("tag_transfer");
    let source_dir = dir.0.join("source");
    let target_dir = dir.0.join("target");
    std::fs::create_dir_all(&source_dir).unwrap();
    std::fs::create_dir_all(&target_dir).unwrap();
    let source = encode(&source_dir, Kind::Aiff, 440);
    populate(Kind::Aiff, &source);
    let target = encode(&target_dir, Kind::Flac, 440);

    let pictures_copied = tag_io::transfer_tags(&source, &target).unwrap();
    assert!(!pictures_copied);
    let listing = tag_io::read_tags(&target).unwrap();
    let values = |key: &str| -> Vec<String> {
        listing
            .tags
            .iter()
            .filter(|e| e.key == key)
            .map(|e| e.value.clone())
            .collect()
    };
    // Standard fields map to Vorbis names, TXXX descriptions become fields,
    // and binary frames (PRIV, UFID, MCDI) cannot be carried over.
    assert_eq!(values("TITLE"), ["Original Title"]);
    assert_eq!(values("ALBUMARTIST"), ["Various Artists"]);
    assert_eq!(values("TRACKNUMBER"), ["3"]);
    assert_eq!(values("TRACKTOTAL"), ["12"]);
    assert_eq!(values("SOURCE"), ["Vinyl"]);
    assert_eq!(values("MP3GAIN_MINMAX"), ["120,210"]);
    assert_eq!(
        values("MUSICBRAINZ_ALBUMID"),
        ["8b0b8d1d-0000-4000-8000-000000000001"]
    );
    assert!(listing.tags.iter().all(|e| !e.key.starts_with("PRIV")));
}

/// Round-trip copies of real files: `FERROTUNE_TAG_SAMPLES=/path cargo test
/// --test tag_editing -- --ignored`. The sample directory is only read.
#[test]
#[ignore]
fn real_world_samples_round_trip() {
    let Some(samples) = std::env::var_os("FERROTUNE_TAG_SAMPLES") else {
        eprintln!("FERROTUNE_TAG_SAMPLES is not set");
        return;
    };
    let dir = TempDir::new("tag_samples");
    let mut checked = 0;
    for entry in std::fs::read_dir(samples).unwrap() {
        let source = entry.unwrap().path();
        let ext = source
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let kind = match ext.as_str() {
            "flac" => Kind::Flac,
            "mp3" => Kind::Mp3,
            "m4a" | "mp4" => Kind::M4a,
            "ogg" => Kind::Ogg,
            "opus" => Kind::Opus,
            "wav" => Kind::Wav,
            _ => continue,
        };
        let path = dir.0.join(format!("sample{checked}.{ext}"));
        std::fs::copy(&source, &path).unwrap();
        let spec = kind.family().spec();

        let listing = tag_io::read_tags(&path).unwrap();
        let before = snapshot(kind, &path);
        let original = std::fs::read(&path).unwrap();
        if let Err(e) = tag_io::update_tags(
            &path,
            &[TagEntry::new("TITLE", "Round Trip Title")],
            &[],
            CoverArtAction::Keep,
        ) {
            // lofty refuses some malformed files; they must stay untouched.
            assert_eq!(
                original,
                std::fs::read(&path).unwrap(),
                "{}",
                source.display()
            );
            println!("refused {}: {e}", source.display());
            continue;
        }
        let after = snapshot(kind, &path);
        // A file without a primary tag gets one.
        let changed: Vec<&str> = spec
            .title
            .iter()
            .copied()
            .chain(["ID3V2_VERSION"])
            .collect();
        assert_preserved(kind, &before, &after, &changed);

        // Every editable key can be written back with its current values.
        let mut groups: Vec<(String, Vec<String>)> = Vec::new();
        // (Empty values are skipped: an empty value means "delete".)
        for e in listing
            .tags
            .iter()
            .filter(|e| !e.read_only && !e.value.is_empty())
        {
            match groups.iter_mut().find(|(k, _)| *k == e.key) {
                Some((_, v)) => v.push(e.value.clone()),
                None => groups.push((e.key.clone(), vec![e.value.clone()])),
            }
        }
        let has_empty = |key: &str| {
            listing
                .tags
                .iter()
                .any(|e| e.key == key && e.value.is_empty())
        };
        let set: Vec<TagEntry> = groups
            .iter()
            .filter(|(k, _)| k != "TITLE" && !has_empty(k))
            .flat_map(|(k, vs)| vs.iter().map(|v| TagEntry::new(k.clone(), v.clone())))
            .collect();
        let changes = tag_io::update_tags(&path, &set, &[], CoverArtAction::Keep)
            .unwrap_or_else(|e| panic!("{}: {e}", source.display()));
        assert!(
            changes.is_empty(),
            "{}: rewriting current values changed {changes:?}",
            source.display()
        );
        println!(
            "ok {} ({} entries, {} other blocks)",
            source.display(),
            listing.tags.len(),
            listing.additional.len()
        );
        checked += 1;
    }
    assert!(checked > 0, "no supported samples found");
}
