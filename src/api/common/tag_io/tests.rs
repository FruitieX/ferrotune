//! In-memory tests of key mapping and editing per format. File round trips
//! through the HTTP API are covered by `tests/tag_editing.rs`.

use super::*;
use lofty::ape::ApeItem;
use lofty::id3::v2::{
    BinaryFrame, CommentFrame, ExtendedTextFrame, ExtendedUrlFrame, Frame, FrameId, PrivateFrame,
    TextInformationFrame, UniqueFileIdentifierFrame,
};
use lofty::mp4::{Atom, AtomData, AtomIdent, DataType};
use lofty::tag::Accessor;
use lofty::TextEncoding;
use std::borrow::Cow;

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

fn sample_id3() -> Id3v2Tag {
    let mut tag = Id3v2Tag::new();
    tag.insert(text("TIT2", "Title"));
    tag.insert(text("TPE1", "Artist A\0Artist B"));
    tag.insert(text("TPE2", "Album Artist"));
    tag.insert(text("TRCK", "3/12"));
    tag.insert(text("TMED", "CD"));
    tag.insert(txxx("Source", "Vinyl"));
    tag.insert(txxx("MusicBrainz Album Id", "mb-album"));
    tag.insert(txxx("ALBUMARTIST", "Shadowed"));
    tag.insert(txxx("Catalog #", "CAT-1"));
    tag.insert(Frame::UserUrl(ExtendedUrlFrame::new(
        TextEncoding::UTF8,
        "Tidal".to_string(),
        "https://tidal.com/track/1".to_string(),
    )));
    tag.insert(Frame::Comment(CommentFrame::new(
        TextEncoding::UTF8,
        *b"eng",
        "iTunNORM".to_string(),
        " 0000 0001".to_string(),
    )));
    tag.insert(Frame::Private(PrivateFrame::new(
        "Google/OriginalClientId",
        vec![1u8, 2, 3, 0, 200],
    )));
    tag.insert(Frame::UniqueFileIdentifier(UniqueFileIdentifierFrame::new(
        "http://www.cddb.com/id3/taginfo1.html",
        b"3CD3N".to_vec(),
    )));
    tag.insert(Frame::Binary(BinaryFrame::new(
        FrameId::Valid(Cow::Borrowed("MCDI")),
        vec![0u8, 1, 2, 3],
    )));
    tag
}

fn keys(entries: &[TagEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.key.as_str()).collect()
}

fn values_of<'a>(entries: &'a [TagEntry], key: &str) -> Vec<&'a str> {
    entries
        .iter()
        .filter(|e| e.key == key)
        .map(|e| e.value.as_str())
        .collect()
}

/// Every editable listed key must resolve back to the item it was listed from.
fn assert_keys_round_trip<T: FormatTag>(tag: &T) {
    for (target, entry) in tag.listing() {
        match target {
            Some(target) => assert_eq!(
                tag.resolve_key(&entry.key).as_ref(),
                Ok(&target),
                "key {:?} does not resolve back to its item",
                entry.key
            ),
            None => assert!(entry.read_only, "{:?} has no target", entry.key),
        }
    }
}

fn set(key: &str, value: &str) -> TagEntry {
    TagEntry::new(key, value)
}

#[test]
fn id3v2_lists_every_frame_with_stable_keys() {
    let tag = sample_id3();
    let entries = list_entries(&tag);
    let keys = keys(&entries);
    for key in [
        "TITLE",
        "ARTIST",
        "ALBUMARTIST",
        "TRACKNUMBER",
        "TRACKTOTAL",
        "MEDIA",
        "Source",
        "MUSICBRAINZ_ALBUMID",
        "TXXX:ALBUMARTIST",
        "Catalog #",
        "WXXX:Tidal",
        "COMM:iTunNORM",
        "PRIV:Google/OriginalClientId",
        "UFID:http://www.cddb.com/id3/taginfo1.html",
        "MCDI",
    ] {
        assert!(keys.contains(&key), "missing {key} in {keys:?}");
    }
    assert_eq!(values_of(&entries, "ARTIST"), ["Artist A", "Artist B"]);
    assert_eq!(values_of(&entries, "TRACKTOTAL"), ["12"]);
    let title = entries.iter().find(|e| e.key == "TITLE").unwrap();
    assert_eq!(title.native_key.as_deref(), Some("TIT2"));
    for key in ["PRIV:Google/OriginalClientId", "MCDI"] {
        assert!(entries.iter().find(|e| e.key == key).unwrap().read_only);
    }
    assert_keys_round_trip(&tag);
}

#[test]
fn id3v2_edits_touch_only_named_frames() {
    let mut tag = sample_id3();
    let before: Vec<String> = tag
        .iter()
        .filter(|f| f.id_str() != "TIT2")
        .map(|f| format!("{f:?}"))
        .collect();

    let mut changes = Vec::new();
    apply_to(&mut tag, &[set("TITLE", "New")], &[], &mut changes).unwrap();
    assert_eq!(changes.len(), 1);
    let after: Vec<String> = tag
        .iter()
        .filter(|f| f.id_str() != "TIT2")
        .map(|f| format!("{f:?}"))
        .collect();
    assert_eq!(before, after);
    assert_eq!(
        tag.get_text(&FrameId::Valid(Cow::Borrowed("TIT2"))),
        Some("New")
    );
}

#[test]
fn id3v2_custom_keys_pairs_and_years() {
    let mut tag = sample_id3();
    let mut changes = Vec::new();
    apply_to(
        &mut tag,
        &[
            set("SPOTIFY_ID", "a"),
            set("SPOTIFY_ID", "b"),
            set("Source", "CD"),
            set("TRACKNUMBER", "4"),
            set("YEAR", "2021"),
            set("TXXX:ALBUMARTIST", "Still shadowed"),
            set("WXXX:Tidal", "https://tidal.com/track/2"),
        ],
        &["Catalog #".to_string()],
        &mut changes,
    )
    .unwrap();

    assert_eq!(tag.get_user_text("SPOTIFY_ID"), Some("a\0b"));
    assert_eq!(tag.get_user_text("Source"), Some("CD"));
    assert_eq!(tag.get_user_text("Catalog #"), None);
    assert_eq!(tag.get_user_text("ALBUMARTIST"), Some("Still shadowed"));
    assert_eq!(
        tag.get_text(&FrameId::Valid(Cow::Borrowed("TPE2"))),
        Some("Album Artist")
    );
    assert_eq!(
        tag.get_text(&FrameId::Valid(Cow::Borrowed("TRCK"))),
        Some("4/12")
    );
    let entries = list_entries(&tag);
    assert_eq!(values_of(&entries, "DATE"), ["2021"]);
    assert_eq!(
        values_of(&entries, "WXXX:Tidal"),
        ["https://tidal.com/track/2"]
    );

    // The year part of an existing date is replaced.
    let _ = tag.remove(&FrameId::Valid(Cow::Borrowed("TDRC")));
    tag.insert(text("TDRC", "2019-05-01"));
    apply_to(&mut tag, &[set("YEAR", "2020")], &[], &mut changes).unwrap();
    assert_eq!(values_of(&list_entries(&tag), "DATE"), ["2020-05-01"]);

    // Removing the total keeps the number.
    apply_to(&mut tag, &[], &["TRACKTOTAL".to_string()], &mut changes).unwrap();
    assert_eq!(
        tag.get_text(&FrameId::Valid(Cow::Borrowed("TRCK"))),
        Some("4")
    );

    // An empty value deletes, like the tagger sends.
    apply_to(&mut tag, &[set("Source", "")], &[], &mut changes).unwrap();
    assert_eq!(tag.get_user_text("Source"), None);
    assert_keys_round_trip(&tag);
}

#[test]
fn id3v2_binary_frames_are_read_only() {
    let mut tag = sample_id3();
    let mut changes = Vec::new();
    for key in [
        "PRIV:Google/OriginalClientId",
        "MCDI",
        "UFID:http://www.cddb.com/id3/taginfo1.html",
    ] {
        let err = apply_to(&mut tag, &[set(key, "x")], &[], &mut changes).unwrap_err();
        assert!(matches!(err, TagIoError::InvalidRequest(_)), "{key}: {err}");
        let err = apply_to(&mut tag, &[], &[key.to_string()], &mut changes).unwrap_err();
        assert!(matches!(err, TagIoError::InvalidRequest(_)), "{key}: {err}");
    }
    assert!(changes.is_empty());
}

fn sample_vorbis() -> VorbisComments {
    let mut tag = VorbisComments::new();
    for (k, v) in [
        ("TITLE", "Title"),
        ("ARTIST", "Artist A"),
        ("ARTIST", "Artist B"),
        ("ALBUM ARTIST", "Various"),
        ("URL", "https://tidal.com/browse/track/1"),
        ("UPC", "00602537"),
        ("SPOTIFY_ID", "abc"),
        ("SPOTIFY_ID", "def"),
        ("DUMPER", "someone"),
        ("DATE", "2019-05-01"),
        ("TRACKNUMBER", "3"),
    ] {
        tag.push(k.to_string(), v.to_string());
    }
    tag
}

#[test]
fn vorbis_lists_and_edits_free_form_fields() {
    let mut tag = sample_vorbis();
    let entries = list_entries(&tag);
    assert_eq!(values_of(&entries, "SPOTIFY_ID"), ["abc", "def"]);
    let album_artist = entries.iter().find(|e| e.key == "ALBUMARTIST").unwrap();
    assert_eq!(album_artist.native_key.as_deref(), Some("ALBUM ARTIST"));
    assert_keys_round_trip(&tag);

    let mut changes = Vec::new();
    apply_to(
        &mut tag,
        &[
            set("TITLE", "New"),
            set("ALBUMARTIST", "Someone"),
            set("YEAR", "2021"),
            set("NEW_KEY", "1"),
            set("NEW_KEY", "2"),
        ],
        &["DUMPER".to_string()],
        &mut changes,
    )
    .unwrap();
    let items: Vec<(String, String)> = tag
        .items()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let expected = [
        ("TITLE", "New"),
        ("ARTIST", "Artist A"),
        ("ARTIST", "Artist B"),
        // The file's spelling of the field is kept.
        ("ALBUM ARTIST", "Someone"),
        ("URL", "https://tidal.com/browse/track/1"),
        ("UPC", "00602537"),
        ("SPOTIFY_ID", "abc"),
        ("SPOTIFY_ID", "def"),
        // YEAR rewrites the year of DATE instead of adding a field.
        ("DATE", "2021-05-01"),
        ("TRACKNUMBER", "3"),
        ("NEW_KEY", "1"),
        ("NEW_KEY", "2"),
    ];
    assert_eq!(
        items,
        expected
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect::<Vec<_>>()
    );
}

fn sample_ilst() -> Ilst {
    let mut tag = Ilst::new();
    tag.insert(Atom::new(
        AtomIdent::Fourcc(*b"\xa9nam"),
        AtomData::UTF8("Title".into()),
    ));
    tag.insert(
        Atom::from_collection(
            AtomIdent::Fourcc(*b"\xa9ART"),
            vec![AtomData::UTF8("A".into()), AtomData::UTF8("B".into())],
        )
        .unwrap(),
    );
    tag.insert(Atom::new(
        AtomIdent::Fourcc(*b"\xa9url"),
        AtomData::UTF8("https://example.com".into()),
    ));
    tag.insert(Atom::new(AtomIdent::Fourcc(*b"cpil"), AtomData::Bool(true)));
    // Tidal writes the ISRC as a plain `isrc` atom.
    tag.insert(Atom::new(
        AtomIdent::Fourcc(*b"isrc"),
        AtomData::UTF8("USLS51123213".into()),
    ));
    tag.insert(Atom::new(
        AtomIdent::Fourcc(*b"tmpo"),
        AtomData::SignedInteger(120),
    ));
    for (name, value) in [
        ("UPC", "00602537"),
        ("UNSYNCEDLYRICS", "la la"),
        ("replaygain_track_gain", "-6.5 dB"),
    ] {
        tag.insert(Atom::new(
            AtomIdent::Freeform {
                mean: Cow::Borrowed("com.apple.iTunes"),
                name: Cow::Owned(name.to_string()),
            },
            AtomData::UTF8(value.into()),
        ));
    }
    tag.insert(Atom::new(
        AtomIdent::Freeform {
            mean: Cow::Borrowed("org.example"),
            name: Cow::Borrowed("Custom"),
        },
        AtomData::UTF8("x".into()),
    ));
    tag.insert(Atom::new(
        AtomIdent::Fourcc(*b"plID"),
        AtomData::Unknown {
            code: DataType::BeFloat32,
            data: vec![1, 2, 3, 4],
        },
    ));
    tag.set_track(3);
    tag.set_track_total(12);
    tag
}

#[test]
fn mp4_lists_and_edits_atoms() {
    let mut tag = sample_ilst();
    let entries = list_entries(&tag);
    for key in [
        "TITLE",
        "ARTIST",
        "©url",
        "COMPILATION",
        "isrc",
        "BPM",
        "UPC",
        // A bare UNSYNCEDLYRICS would mean ©lyr in MP4.
        "----:com.apple.iTunes:UNSYNCEDLYRICS",
        "REPLAYGAIN_TRACK_GAIN",
        "----:org.example:Custom",
        "plID",
        "TRACKNUMBER",
        "TRACKTOTAL",
    ] {
        assert!(
            entries.iter().any(|e| e.key == key),
            "missing {key} in {:?}",
            keys(&entries)
        );
    }
    assert!(entries.iter().find(|e| e.key == "plID").unwrap().read_only);
    assert_eq!(values_of(&entries, "ARTIST"), ["A", "B"]);
    assert_keys_round_trip(&tag);

    let before: Vec<String> = (&tag)
        .into_iter()
        .filter(|a| a.ident() != &AtomIdent::Fourcc(*b"\xa9nam"))
        .map(|a| format!("{a:?}"))
        .collect();
    let mut changes = Vec::new();
    apply_to(&mut tag, &[set("TITLE", "New")], &[], &mut changes).unwrap();
    let after: Vec<String> = (&tag)
        .into_iter()
        .filter(|a| a.ident() != &AtomIdent::Fourcc(*b"\xa9nam"))
        .map(|a| format!("{a:?}"))
        .collect();
    assert_eq!(before, after);

    apply_to(
        &mut tag,
        &[
            set("SPOTIFY_ID", "abc"),
            set("upc", "123"),
            set("BPM", "128"),
            set("TRACKNUMBER", "5"),
            set("isrc", "USLS00000001"),
        ],
        &["©url".to_string()],
        &mut changes,
    )
    .unwrap();
    let entries = list_entries(&tag);
    assert_eq!(values_of(&entries, "SPOTIFY_ID"), ["abc"]);
    // Existing freeform names keep their spelling; integer atoms stay integers.
    assert_eq!(values_of(&entries, "UPC"), ["123"]);
    assert!(matches!(
        tag.get(&AtomIdent::Fourcc(*b"tmpo")).unwrap().data().next(),
        Some(AtomData::SignedInteger(128))
    ));
    assert_eq!((tag.track(), tag.track_total()), (Some(5), Some(12)));
    assert_eq!(values_of(&entries, "isrc"), ["USLS00000001"]);
    assert!(tag.get(&AtomIdent::Fourcc(*b"\xa9url")).is_none());
    assert!(apply_to(&mut tag, &[set("plID", "1")], &[], &mut changes).is_err());
    assert!(apply_to(&mut tag, &[set("BPM", "fast")], &[], &mut changes).is_err());
}

#[test]
fn ape_lists_and_edits_items() {
    let mut tag = ApeTag::new();
    for (k, v) in [
        ("Title", "Title"),
        ("Album Artist", "Various"),
        ("Track", "3/12"),
        ("CATALOG", "CAT-1"),
    ] {
        tag.insert(
            ApeItem::new(k.to_string(), lofty::tag::ItemValue::Text(v.to_string())).unwrap(),
        );
    }
    tag.insert(
        ApeItem::new(
            "Binary Thing".to_string(),
            lofty::tag::ItemValue::Binary(vec![0, 1, 2]),
        )
        .unwrap(),
    );
    let entries = list_entries(&tag);
    assert_eq!(values_of(&entries, "ALBUMARTIST"), ["Various"]);
    assert_eq!(values_of(&entries, "TRACKTOTAL"), ["12"]);
    assert!(
        entries
            .iter()
            .find(|e| e.key == "Binary Thing")
            .unwrap()
            .read_only
    );
    assert_keys_round_trip(&tag);

    let mut changes = Vec::new();
    apply_to(
        &mut tag,
        &[
            set("ALBUMARTIST", "Someone"),
            set("TRACKNUMBER", "4"),
            set("catalog", "CAT-2"),
        ],
        &[],
        &mut changes,
    )
    .unwrap();
    assert_eq!(
        tag.get("Album Artist").unwrap().value().text(),
        Some("Someone")
    );
    assert_eq!(tag.get("Track").unwrap().value().text(), Some("4/12"));
    assert_eq!(tag.get("CATALOG").unwrap().key(), "CATALOG");
    assert_eq!(tag.get("CATALOG").unwrap().value().text(), Some("CAT-2"));
    assert!(tag.get("Binary Thing").is_some());
}

#[test]
fn portable_keys_drop_format_prefixes() {
    assert_eq!(portable_key("TXXX:Source"), Some("Source"));
    assert_eq!(portable_key("----:com.apple.iTunes:UPC"), Some("UPC"));
    assert_eq!(portable_key("COMM:iTunNORM"), None);
    assert_eq!(portable_key("URL"), Some("URL"));
}

#[test]
fn id3v2_frames_lofty_cannot_write_are_prepared() {
    let mut tag = Id3v2Tag::new();
    tag.insert(Frame::UserUrl(ExtendedUrlFrame::new(
        TextEncoding::UTF16,
        "Site".to_string(),
        "http://example.com/".to_string(),
    )));
    tag.insert(Frame::Comment(CommentFrame::new(
        TextEncoding::Latin1,
        [0, 0, 0],
        String::new(),
        "comment".to_string(),
    )));
    id3v2::prepare_for_write(&mut tag, false);

    // The URL stays Latin-1 after the UTF-16 description.
    let wxxx = tag.iter().find(|f| f.id_str() == "WXXX").unwrap();
    let Frame::Binary(raw) = wxxx else {
        panic!("WXXX should be written raw: {wxxx:?}");
    };
    let mut expected = vec![1u8, 0xFF, 0xFE, b'S', 0, b'i', 0, b't', 0, b'e', 0, 0, 0];
    expected.extend_from_slice(b"http://example.com/");
    assert_eq!(raw.data.as_ref(), expected.as_slice());

    let comment = tag.comments().next().unwrap();
    assert_eq!(&comment.language, b"XXX");
}
