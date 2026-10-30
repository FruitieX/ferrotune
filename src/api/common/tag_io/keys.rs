//! Canonical tag key names shared by every format.
//!
//! The API names standard fields with the Vorbis comment field names
//! (`TITLE`, `ALBUMARTIST`, `TRACKNUMBER`, ...), whatever the file format.
//! Format modules map these to native identifiers (ID3v2 frame IDs, MP4 atoms,
//! APE item keys) through lofty's `ItemKey` mapping tables. Keys that are not
//! canonical are format-native (`TXXX:Source`, `----:com.apple.iTunes:UPC`,
//! `SPOTIFY_ID`, ...).

use lofty::tag::{ItemKey, TagType};

/// Resolve a canonical key name (case-insensitive, including the Vorbis
/// aliases lofty knows, e.g. `ALBUM ARTIST`, `TOTALTRACKS`, `ORGANIZATION`).
pub(super) fn canonical_item(key: &str) -> Option<ItemKey> {
    ItemKey::from_key(TagType::VorbisComments, key.trim())
}

/// The canonical (API) name of an item.
pub(super) fn canonical_name(item: ItemKey) -> Option<&'static str> {
    match item {
        // ID3v2 TBPM / MP4 tmpo hold an integer BPM; they are still "BPM".
        ItemKey::IntegerBpm => Some("BPM"),
        other => other.map_key(TagType::VorbisComments),
    }
}

/// The canonical name for a native key, when lofty maps the native key to a
/// standard item whose primary native key is this one.
pub(super) fn mapped_name(tag_type: TagType, native: &str) -> Option<&'static str> {
    let item = ItemKey::from_key(tag_type, native)?;
    let back = item.map_key(tag_type)?;
    if !back.eq_ignore_ascii_case(native) {
        return None;
    }
    canonical_name(item)
}

/// Items that are stored in a different native field depending on the format
/// or on what the file already contains. The first entry of each pair is what
/// users type; the second is its sibling.
const SIBLINGS: &[(ItemKey, ItemKey)] = &[
    (ItemKey::Bpm, ItemKey::IntegerBpm),
    (ItemKey::Lyrics, ItemKey::UnsyncLyrics),
];

/// The native keys an item may be stored under in `tag_type`, preferred first.
pub(super) fn native_candidates(item: ItemKey, tag_type: TagType) -> Vec<&'static str> {
    let mut candidates = Vec::new();
    let mut push = |item: ItemKey| {
        if let Some(native) = item.map_key(tag_type) {
            if !candidates.contains(&native) {
                candidates.push(native);
            }
        }
    };
    push(item);
    for (a, b) in SIBLINGS {
        if *a == item {
            push(*b);
        } else if *b == item {
            push(*a);
        }
    }
    candidates
}

/// Whether `item` is the number half of a "number/total" pair, and which
/// item is its partner.
pub(super) fn pair_of(item: ItemKey) -> Option<(ItemKey, bool)> {
    match item {
        ItemKey::TrackNumber => Some((ItemKey::TrackNumber, false)),
        ItemKey::TrackTotal => Some((ItemKey::TrackNumber, true)),
        ItemKey::DiscNumber => Some((ItemKey::DiscNumber, false)),
        ItemKey::DiscTotal => Some((ItemKey::DiscNumber, true)),
        ItemKey::MovementNumber => Some((ItemKey::MovementNumber, false)),
        ItemKey::MovementTotal => Some((ItemKey::MovementNumber, true)),
        _ => None,
    }
}

/// The canonical names of the two halves of a pair whose number item is `number`.
pub(super) fn pair_names(number: ItemKey) -> (&'static str, &'static str) {
    match number {
        ItemKey::DiscNumber => ("DISCNUMBER", "DISCTOTAL"),
        ItemKey::MovementNumber => ("MOVEMENT", "MOVEMENTTOTAL"),
        _ => ("TRACKNUMBER", "TRACKTOTAL"),
    }
}

/// Split a "number/total" value into its halves.
pub(super) fn split_pair(value: &str) -> (Option<String>, Option<String>) {
    let value = value.split('\0').next().unwrap_or_default();
    let (number, total) = match value.split_once('/') {
        Some((n, t)) => (n, Some(t)),
        None => (value, None),
    };
    let clean = |s: &str| {
        let s = s.trim();
        (!s.is_empty()).then(|| s.to_string())
    };
    (clean(number), total.and_then(clean))
}

/// Join pair halves back into a "number/total" value.
pub(super) fn join_pair(number: Option<&str>, total: Option<&str>) -> Option<String> {
    match (number, total) {
        (Some(n), Some(t)) => Some(format!("{n}/{t}")),
        (Some(n), None) => Some(n.to_string()),
        (None, Some(t)) => Some(format!("0/{t}")),
        (None, None) => None,
    }
}

/// Replace the leading four-digit year of a date value, if it has one.
pub(super) fn replace_year(date: &str, year: &str) -> Option<String> {
    let prefix = date.get(..4)?;
    prefix
        .bytes()
        .all(|b| b.is_ascii_digit())
        .then(|| format!("{year}{}", &date[4..]))
}

/// The leading four-digit year of a date value.
pub(super) fn year_of(date: &str) -> Option<String> {
    let prefix = date.trim().get(..4)?;
    prefix
        .bytes()
        .all(|b| b.is_ascii_digit())
        .then(|| prefix.to_string())
}

/// Human-readable summary of opaque binary data. Printable UTF-8 is shown
/// as-is so identifiers stored in binary frames stay readable.
pub(super) fn describe_binary(data: &[u8]) -> String {
    match std::str::from_utf8(data) {
        Ok(text)
            if !text.is_empty()
                && text
                    .trim_end_matches('\0')
                    .chars()
                    .all(|c| !c.is_control() || c == '\n' || c == '\t') =>
        {
            text.trim_end_matches('\0').to_string()
        }
        _ => format!("<binary: {} bytes>", data.len()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_names_follow_vorbis_field_names() {
        assert_eq!(canonical_item("Album Artist"), Some(ItemKey::AlbumArtist));
        assert_eq!(canonical_name(ItemKey::AlbumArtist), Some("ALBUMARTIST"));
        assert_eq!(canonical_item("totaltracks"), Some(ItemKey::TrackTotal));
        assert_eq!(canonical_name(ItemKey::IntegerBpm), Some("BPM"));
        assert_eq!(canonical_item("SPOTIFY_ID"), None);
        assert_eq!(canonical_item("URL"), None);
    }

    #[test]
    fn siblings_prefer_the_named_item() {
        assert_eq!(
            native_candidates(ItemKey::Bpm, TagType::Id3v2),
            vec!["TBPM"]
        );
        assert_eq!(
            native_candidates(ItemKey::Bpm, TagType::Mp4Ilst),
            vec!["----:com.apple.iTunes:BPM", "tmpo"]
        );
        assert_eq!(
            native_candidates(ItemKey::Lyrics, TagType::Id3v2),
            vec!["USLT"]
        );
    }

    #[test]
    fn pairs_split_and_join() {
        assert_eq!(
            split_pair("3/12"),
            (Some("3".to_string()), Some("12".to_string()))
        );
        assert_eq!(split_pair("7"), (Some("7".to_string()), None));
        assert_eq!(join_pair(Some("3"), Some("12")).as_deref(), Some("3/12"));
        assert_eq!(join_pair(None, Some("12")).as_deref(), Some("0/12"));
    }

    #[test]
    fn year_helpers() {
        assert_eq!(
            replace_year("2019-05-01", "2021").as_deref(),
            Some("2021-05-01")
        );
        assert_eq!(replace_year("May 2019", "2021"), None);
        assert_eq!(year_of("2019-05-01").as_deref(), Some("2019"));
    }

    #[test]
    fn binary_descriptions() {
        assert_eq!(describe_binary(b"abc123"), "abc123");
        assert_eq!(describe_binary(&[0, 1, 2, 255]), "<binary: 4 bytes>");
    }
}
