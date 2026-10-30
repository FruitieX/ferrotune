//! MP4 `ilst` atoms (M4A/AAC/ALAC).
//!
//! Keys:
//! - standard atoms use the canonical name (`©nam` → `TITLE`), others their
//!   four-character code (`©url`, `stik`);
//! - `trkn`/`disk` are split into number and total keys;
//! - freeform `----:com.apple.iTunes:<name>` atoms use the canonical name when
//!   lofty maps them (`replaygain_track_gain` → `REPLAYGAIN_TRACK_GAIN`),
//!   otherwise the bare name (`UPC`, `UNSYNCEDLYRICS`) unless that would mean
//!   another atom; other means use the full `----:<mean>:<name>` form;
//! - atoms holding opaque data are listed read-only.
//!
//! Unknown keys are written as `----:com.apple.iTunes:<key>` freeform atoms.
//! Integer and flag atoms keep their data type when edited.

use super::keys::{
    canonical_item, canonical_name, describe_binary, mapped_name, native_candidates, pair_names,
    pair_of, replace_year, year_of,
};
use super::{display_key, entry, FormatTag};
use crate::api::tags::TagEntry;
use lofty::mp4::{Atom, AtomData, AtomIdent, DataType, Ilst};
use lofty::picture::Picture;
use lofty::tag::{Accessor, ItemKey, TagType};

use std::borrow::Cow;

const ITUNES_MEAN: &str = "com.apple.iTunes";
const TRACK: [u8; 4] = *b"trkn";
const DISC: [u8; 4] = *b"disk";
const COVER: [u8; 4] = *b"covr";
const DATE: [u8; 4] = *b"\xa9day";
const FLAG_ATOMS: &[[u8; 4]] = &[*b"cpil", *b"pgap", *b"pcst", *b"shwm"];
const INTEGER_ATOMS: &[[u8; 4]] = &[*b"tmpo", *b"rtng", *b"stik", *b"hdvd"];

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Target {
    Atom(AtomIdent<'static>),
    /// One half of `trkn` (`disc == false`) or `disk`.
    Pair {
        disc: bool,
        total: bool,
    },
    /// The year part of `©day`.
    Year,
}

fn fourcc_string(fourcc: &[u8; 4]) -> String {
    fourcc.iter().map(|&b| b as char).collect()
}

fn ident_string(ident: &AtomIdent<'_>) -> String {
    match ident {
        AtomIdent::Fourcc(fourcc) => fourcc_string(fourcc),
        AtomIdent::Freeform { mean, name } => format!("----:{mean}:{name}"),
    }
}

/// Parse a four-character code written with Latin-1 characters (`©nam`).
fn parse_fourcc(key: &str) -> Option<[u8; 4]> {
    let bytes: Vec<u8> = key
        .chars()
        .map(|c| u8::try_from(u32::from(c)).ok())
        .collect::<Option<_>>()?;
    bytes.try_into().ok()
}

fn freeform(mean: &str, name: &str) -> AtomIdent<'static> {
    AtomIdent::Freeform {
        mean: Cow::Owned(mean.to_string()),
        name: Cow::Owned(name.to_string()),
    }
}

/// Parse a native key from lofty's mapping table or the `----:mean:name` form.
fn parse_native(native: &str) -> Option<AtomIdent<'static>> {
    if let Some(rest) = native.strip_prefix("----:") {
        let (mean, name) = rest.split_once(':')?;
        return Some(freeform(mean, name));
    }
    parse_fourcc(native).map(AtomIdent::Fourcc)
}

fn is_opaque(data: &AtomData) -> bool {
    matches!(data, AtomData::Unknown { .. } | AtomData::Picture(_))
}

fn data_text(data: &AtomData) -> String {
    match data {
        AtomData::UTF8(s) | AtomData::UTF16(s) => s.clone(),
        AtomData::SignedInteger(i) => i.to_string(),
        AtomData::UnsignedInteger(u) => u.to_string(),
        AtomData::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        AtomData::Picture(p) => format!("<picture: {} bytes>", p.data().len()),
        AtomData::Unknown { data, .. } => describe_binary(data),
    }
}

fn parse_flag(value: &str) -> Result<bool, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" => Ok(true),
        "0" | "false" | "no" | "" => Ok(false),
        other => Err(format!("Expected a flag value (1/0), got {other:?}")),
    }
}

fn parse_number(key: &str, value: &str) -> Result<u32, String> {
    value
        .trim()
        .parse::<u32>()
        .map_err(|_| format!("{key} must be a number, got {value:?}"))
}

/// Normalize a freeform identifier to the spelling an existing atom uses.
fn existing_ident(tag: &Ilst, ident: AtomIdent<'static>) -> AtomIdent<'static> {
    if let AtomIdent::Freeform { mean, name } = &ident {
        for atom in tag {
            if let AtomIdent::Freeform { mean: m, name: n } = atom.ident() {
                if m == mean && n.eq_ignore_ascii_case(name) {
                    return atom.ident().clone().into_owned();
                }
            }
        }
    }
    ident
}

/// Replace the atom with the same identifier, keeping its position (lofty's
/// own `replace_atom` reorders the remaining atoms).
fn replace_in_place(tag: &mut Ilst, atom: Atom<'static>) {
    let ident = atom.ident().clone().into_owned();
    let mut new = Some(atom);
    for existing in std::mem::take(tag) {
        if existing.ident() == &ident {
            if let Some(atom) = new.take() {
                tag.insert(atom);
            }
        } else {
            tag.insert(existing);
        }
    }
    if let Some(atom) = new {
        tag.insert(atom);
    }
}

fn remove_in_place(tag: &mut Ilst, ident: &AtomIdent<'_>) {
    tag.retain(|atom| atom.ident() != ident);
}

/// Write a `trkn`/`disk` number pair.
fn set_pair(tag: &mut Ilst, fourcc: [u8; 4], number: u32, total: u32) {
    // Keep the existing layout (iTunes writes 8 bytes for trkn, lofty 6).
    let mut data = tag
        .get(&AtomIdent::Fourcc(fourcc))
        .and_then(|atom| match atom.data().next() {
            Some(AtomData::Unknown { data, .. }) if data.len() >= 6 => Some(data.clone()),
            _ => None,
        })
        .unwrap_or_else(|| vec![0; 6]);
    data[2..4].copy_from_slice(&(number as u16).to_be_bytes());
    data[4..6].copy_from_slice(&(total as u16).to_be_bytes());
    replace_in_place(
        tag,
        Atom::new(
            AtomIdent::Fourcc(fourcc),
            AtomData::Unknown {
                code: DataType::Reserved,
                data,
            },
        ),
    );
}

fn date_text(tag: &Ilst) -> Option<String> {
    tag.get(&AtomIdent::Fourcc(DATE))
        .and_then(|atom| atom.data().next().map(data_text))
}

impl FormatTag for Ilst {
    type Target = Target;

    fn listing(&self) -> Vec<(Option<Target>, TagEntry)> {
        let mut out = Vec::new();
        for atom in self {
            let ident = atom.ident();
            let raw = ident_string(ident);
            match ident {
                AtomIdent::Fourcc(fourcc) if *fourcc == TRACK || *fourcc == DISC => {
                    let disc = *fourcc == DISC;
                    let (number, total) = if disc {
                        (self.disk(), self.disk_total())
                    } else {
                        (self.track(), self.track_total())
                    };
                    let number_item = if disc {
                        ItemKey::DiscNumber
                    } else {
                        ItemKey::TrackNumber
                    };
                    let (number_key, total_key) = pair_names(number_item);
                    if let Some(n) = number.filter(|n| *n > 0) {
                        let target = Target::Pair { disc, total: false };
                        out.push((
                            Some(target),
                            entry(number_key, n.to_string(), Some(raw.clone()), false),
                        ));
                    }
                    if let Some(t) = total.filter(|t| *t > 0) {
                        let target = Target::Pair { disc, total: true };
                        out.push((
                            Some(target),
                            entry(total_key, t.to_string(), Some(raw.clone()), false),
                        ));
                    }
                    continue;
                }
                // Cover art is edited through the cover art actions.
                AtomIdent::Fourcc(fourcc) if *fourcc == COVER => continue,
                _ => {}
            }

            if atom.data().any(is_opaque) {
                for data in atom.data() {
                    out.push((None, entry(raw.clone(), data_text(data), None, true)));
                }
                continue;
            }

            let target = Target::Atom(ident.clone().into_owned());
            let mut candidates: Vec<&str> =
                mapped_name(TagType::Mp4Ilst, &raw).into_iter().collect();
            if let AtomIdent::Freeform { mean, name } = ident {
                if mean == ITUNES_MEAN {
                    candidates.push(name);
                }
            }
            let key = display_key(self, &target, &candidates, raw.clone());
            let native = (key != raw).then(|| raw.clone());
            for data in atom.data() {
                out.push((
                    Some(target.clone()),
                    entry(key.clone(), data_text(data), native.clone(), false),
                ));
            }
        }
        out
    }

    fn resolve_key(&self, key: &str) -> Result<Target, String> {
        let key = key.trim();
        if key.is_empty() {
            return Err("Tag key must not be empty".to_string());
        }

        // An existing atom whose code is exactly the key (e.g. Tidal's `isrc`)
        // wins over the canonical name that matches it case-insensitively.
        let exact = parse_fourcc(key)
            .map(AtomIdent::Fourcc)
            .filter(|ident| self.get(ident).is_some());

        let target = if let Some(ident) = exact {
            match ident {
                AtomIdent::Fourcc(TRACK) => {
                    return Ok(Target::Pair {
                        disc: false,
                        total: false,
                    })
                }
                AtomIdent::Fourcc(DISC) => {
                    return Ok(Target::Pair {
                        disc: true,
                        total: false,
                    })
                }
                AtomIdent::Fourcc(COVER) => {
                    return Err("Cover art is edited with the cover art actions".to_string())
                }
                ident => Target::Atom(ident),
            }
        } else if key.starts_with("----:") {
            let ident = parse_native(key)
                .ok_or_else(|| format!("Invalid freeform atom {key:?}, expected ----:mean:name"))?;
            Target::Atom(existing_ident(self, ident))
        } else if let Some(item) = canonical_item(key) {
            if let Some((number, total)) = pair_of(item) {
                match number {
                    ItemKey::TrackNumber => return Ok(Target::Pair { disc: false, total }),
                    ItemKey::DiscNumber => return Ok(Target::Pair { disc: true, total }),
                    _ => {}
                }
            }
            if item == ItemKey::Year {
                return Ok(Target::Year);
            }
            let idents: Vec<AtomIdent<'static>> = native_candidates(item, TagType::Mp4Ilst)
                .into_iter()
                .filter_map(parse_native)
                .map(|ident| existing_ident(self, ident))
                .collect();
            let ident = idents
                .iter()
                .find(|ident| self.get(ident).is_some())
                .or(idents.first())
                .cloned()
                .unwrap_or_else(|| freeform(ITUNES_MEAN, canonical_name(item).unwrap_or(key)));
            Target::Atom(existing_ident(self, ident))
        } else if let Some(fourcc) = parse_fourcc(key).filter(|f| {
            self.get(&AtomIdent::Fourcc(*f)).is_some()
                || f[0] == 0xA9
                || f.iter()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        }) {
            match fourcc {
                TRACK => {
                    return Ok(Target::Pair {
                        disc: false,
                        total: false,
                    })
                }
                DISC => {
                    return Ok(Target::Pair {
                        disc: true,
                        total: false,
                    })
                }
                COVER => return Err("Cover art is edited with the cover art actions".to_string()),
                _ => Target::Atom(AtomIdent::Fourcc(fourcc)),
            }
        } else {
            Target::Atom(existing_ident(self, freeform(ITUNES_MEAN, key)))
        };

        if let Target::Atom(ident) = &target {
            if self
                .get(ident)
                .is_some_and(|atom| atom.data().any(is_opaque))
            {
                return Err(format!("MP4 atom {key} holds binary data and is read-only"));
            }
        }
        Ok(target)
    }

    fn current_values(&self, target: &Target) -> Vec<String> {
        match target {
            Target::Year => date_text(self)
                .and_then(|d| year_of(&d))
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
        match target {
            Target::Pair { disc, total } => {
                let (number, total_value) = match (first.split_once('/'), total) {
                    (Some((n, t)), false) => (Some(n.to_string()), Some(t.to_string())),
                    (_, false) => (Some(first.clone()), None),
                    (_, true) => (None, Some(first.clone())),
                };
                let (number_key, total_key) = pair_names(if *disc {
                    ItemKey::DiscNumber
                } else {
                    ItemKey::TrackNumber
                });
                let (old_number, old_total) = if *disc {
                    (self.disk(), self.disk_total())
                } else {
                    (self.track(), self.track_total())
                };
                let number = match number {
                    Some(n) => parse_number(number_key, &n)?,
                    None => old_number.unwrap_or(0),
                };
                let total = match total_value {
                    Some(t) => parse_number(total_key, &t)?,
                    None => old_total.unwrap_or(0),
                };
                set_pair(self, if *disc { DISC } else { TRACK }, number, total);
                Ok(())
            }
            Target::Year => {
                let date = date_text(self)
                    .and_then(|d| replace_year(&d, &first))
                    .unwrap_or(first);
                replace_in_place(
                    self,
                    Atom::new(AtomIdent::Fourcc(DATE), AtomData::UTF8(date)),
                );
                Ok(())
            }
            Target::Atom(ident) => {
                let existing = self.get(ident).and_then(|atom| atom.data().next().cloned());
                let fourcc = match ident {
                    AtomIdent::Fourcc(f) => Some(*f),
                    _ => None,
                };
                let data =
                    values
                        .iter()
                        .map(|value| -> Result<AtomData, String> {
                            Ok(match (&existing, fourcc) {
                                (Some(AtomData::Bool(_)), _) => AtomData::Bool(parse_flag(value)?),
                                (None, Some(f)) if FLAG_ATOMS.contains(&f) => {
                                    AtomData::Bool(parse_flag(value)?)
                                }
                                (Some(AtomData::SignedInteger(_)), _) => {
                                    AtomData::SignedInteger(value.trim().parse().map_err(|_| {
                                        format!("Expected an integer, got {value:?}")
                                    })?)
                                }
                                (None, Some(f)) if INTEGER_ATOMS.contains(&f) => {
                                    AtomData::SignedInteger(value.trim().parse().map_err(|_| {
                                        format!("Expected an integer, got {value:?}")
                                    })?)
                                }
                                (Some(AtomData::UnsignedInteger(_)), _) => {
                                    AtomData::UnsignedInteger(value.trim().parse().map_err(
                                        |_| format!("Expected an integer, got {value:?}"),
                                    )?)
                                }
                                (Some(AtomData::UTF16(_)), _) => AtomData::UTF16(value.clone()),
                                _ => AtomData::UTF8(value.clone()),
                            })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                let atom = Atom::from_collection(ident.clone(), data)
                    .ok_or_else(|| "No values to write".to_string())?;
                replace_in_place(self, atom);
                Ok(())
            }
        }
    }

    fn remove_target(&mut self, target: &Target) {
        match target {
            Target::Pair { disc, total } => {
                let fourcc = if *disc { DISC } else { TRACK };
                let number = if *disc { self.disk() } else { self.track() };
                match (total, number) {
                    (true, Some(number)) if number > 0 => set_pair(self, fourcc, number, 0),
                    _ => remove_in_place(self, &AtomIdent::Fourcc(fourcc)),
                }
            }
            Target::Year => remove_in_place(self, &AtomIdent::Fourcc(DATE)),
            Target::Atom(ident) => remove_in_place(self, ident),
        }
    }
}

pub(super) fn set_cover(tag: &mut Ilst, picture: Picture) {
    tag.remove_pictures();
    tag.insert_picture(picture);
}

pub(super) fn remove_covers(tag: &mut Ilst) {
    tag.remove_pictures();
}
