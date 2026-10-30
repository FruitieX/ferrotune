//! Vorbis comments (FLAC, Ogg Vorbis, Opus, Speex).
//!
//! Field names are free-form and may repeat. Every field is listed; fields
//! whose name is a known alias of a standard item are listed under the
//! canonical name (`ALBUM ARTIST` → `ALBUMARTIST`) with the stored name in
//! `nativeKey`. Setting a key replaces all fields of that item in place and
//! keeps the file's spelling of the field name.

use super::keys::{canonical_item, canonical_name, replace_year, year_of};
use super::{entry, FormatTag};
use crate::api::tags::TagEntry;
use lofty::ogg::tag::VorbisComments;
use lofty::tag::ItemKey;

/// Fields that hold encoded pictures rather than text.
const PICTURE_FIELDS: &[&str] = &["METADATA_BLOCK_PICTURE", "COVERART", "COVERARTMIME"];

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Target {
    /// A standard item, matched by any of its aliases.
    Item(ItemKey),
    /// A free-form field, matched case-insensitively.
    Field(String),
    /// The year: rewrites the year part of DATE when there is no YEAR field.
    Year,
}

fn field_target(name: &str) -> Target {
    match canonical_item(name) {
        Some(item) if canonical_name(item).is_some() => Target::Item(item),
        _ => Target::Field(name.to_string()),
    }
}

fn matches(field: &str, target: &Target) -> bool {
    match (field_target(field), target) {
        (Target::Item(a), Target::Item(b)) => a == *b,
        (Target::Field(a), Target::Field(b)) => a.eq_ignore_ascii_case(b),
        _ => false,
    }
}

fn valid_field_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| (0x20..=0x7D).contains(&b) && b != b'=')
}

impl FormatTag for VorbisComments {
    type Target = Target;

    fn listing(&self) -> Vec<(Option<Target>, TagEntry)> {
        self.items()
            .map(|(name, value)| {
                if PICTURE_FIELDS.iter().any(|p| p.eq_ignore_ascii_case(name)) {
                    let summary = format!("<picture data: {} bytes>", value.len());
                    return (None, entry(name, summary, None, true));
                }
                let target = field_target(name);
                let key = match &target {
                    Target::Item(item) => canonical_name(*item).unwrap_or(name),
                    _ => name,
                };
                let native = (key != name).then(|| name.to_string());
                let target = match target {
                    Target::Item(ItemKey::Year) => Target::Year,
                    other => other,
                };
                (Some(target), entry(key, value, native, false))
            })
            .collect()
    }

    fn resolve_key(&self, key: &str) -> Result<Target, String> {
        let key = key.trim();
        if PICTURE_FIELDS.iter().any(|p| p.eq_ignore_ascii_case(key)) {
            return Err(format!("{key} holds picture data and is read-only here"));
        }
        if !valid_field_name(key) {
            return Err(format!("Invalid Vorbis comment field name: {key:?}"));
        }
        Ok(match field_target(key) {
            Target::Item(ItemKey::Year) => Target::Year,
            other => other,
        })
    }

    fn current_values(&self, target: &Target) -> Vec<String> {
        let collect = |t: &Target| -> Vec<String> {
            self.items()
                .filter(|(name, _)| matches(name, t))
                .map(|(_, value)| value.to_string())
                .collect()
        };
        match target {
            Target::Year => {
                let years = collect(&Target::Item(ItemKey::Year));
                if !years.is_empty() {
                    return years;
                }
                collect(&Target::Item(ItemKey::RecordingDate))
                    .first()
                    .and_then(|date| year_of(date))
                    .into_iter()
                    .collect()
            }
            other => collect(other),
        }
    }

    fn write_values(&mut self, target: &Target, values: &[String]) -> Result<(), String> {
        match target {
            Target::Year => {
                let year = values.first().cloned().unwrap_or_default();
                let has_year_field = !self.current_values(&Target::Item(ItemKey::Year)).is_empty();
                let mut rewrote_date = false;
                let items: Vec<(String, String)> = self
                    .take_items()
                    .map(|(name, value)| {
                        if !rewrote_date && matches(&name, &Target::Item(ItemKey::RecordingDate)) {
                            if let Some(date) = replace_year(&value, &year) {
                                rewrote_date = true;
                                return (name, date);
                            }
                        }
                        (name, value)
                    })
                    .collect();
                for (name, value) in items {
                    self.push(name, value);
                }
                if has_year_field || !rewrote_date {
                    replace_fields(self, &Target::Item(ItemKey::Year), "YEAR", values);
                }
                Ok(())
            }
            Target::Item(item) => {
                let name = canonical_name(*item).unwrap_or("UNKNOWN");
                replace_fields(self, target, name, values);
                Ok(())
            }
            Target::Field(name) => {
                replace_fields(self, target, &name.to_ascii_uppercase(), values);
                Ok(())
            }
        }
    }

    fn remove_target(&mut self, target: &Target) {
        let target = match target {
            Target::Year if !self.current_values(&Target::Item(ItemKey::Year)).is_empty() => {
                Target::Item(ItemKey::Year)
            }
            Target::Year => Target::Item(ItemKey::RecordingDate),
            other => other.clone(),
        };
        let items: Vec<(String, String)> = self.take_items().collect();
        for (name, value) in items {
            if !matches(&name, &target) {
                self.push(name, value);
            }
        }
    }
}

/// Replace every field matching `target` with `values`, at the position of the
/// first match and under its stored name (or `new_name` when nothing matched).
fn replace_fields(tag: &mut VorbisComments, target: &Target, new_name: &str, values: &[String]) {
    let items: Vec<(String, String)> = tag.take_items().collect();
    let existing_name = items
        .iter()
        .find(|(name, _)| matches(name, target))
        .map(|(name, _)| name.clone());
    let name = existing_name
        .clone()
        .unwrap_or_else(|| new_name.to_string());
    let mut inserted = false;
    for (field, value) in items {
        if matches(&field, target) {
            if !inserted {
                for v in values {
                    tag.push(name.clone(), v.clone());
                }
                inserted = true;
            }
            continue;
        }
        tag.push(field, value);
    }
    if !inserted {
        for v in values {
            tag.push(name.clone(), v.clone());
        }
    }
}
