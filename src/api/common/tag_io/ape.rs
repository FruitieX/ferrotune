//! APE tags (Monkey's Audio, WavPack, Musepack).
//!
//! Item keys are free-form and case-insensitive. Standard items use the
//! canonical name (`Album Artist` → `ALBUMARTIST`); `Track`/`Disc` are split
//! into number and total keys. An item whose bare key would mean another item
//! is listed as `APE:<key>`. Binary items and items flagged read-only are
//! listed read-only; cover art items are edited with the cover art actions.

use super::keys::{
    canonical_item, describe_binary, join_pair, mapped_name, native_candidates, pair_names,
    pair_of, split_pair,
};
use super::{display_key, entry, FormatTag};
use crate::api::tags::TagEntry;
use lofty::ape::{ApeItem, ApeTag};
use lofty::picture::{Picture, PictureType};
use lofty::tag::{ItemKey, ItemValue, TagType};

const PAIR_ITEMS: &[(&str, ItemKey)] = &[
    ("Track", ItemKey::TrackNumber),
    ("Disc", ItemKey::DiscNumber),
];

#[derive(Debug, Clone)]
pub(super) enum Target {
    Item(String),
    Pair { key: &'static str, total: bool },
}

impl PartialEq for Target {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Target::Item(a), Target::Item(b)) => a.eq_ignore_ascii_case(b),
            (Target::Pair { key: a, total: x }, Target::Pair { key: b, total: y }) => {
                a == b && x == y
            }
            _ => false,
        }
    }
}

fn is_picture_key(key: &str) -> bool {
    key.to_ascii_lowercase().starts_with("cover art")
}

fn item_text(item: &ApeItem) -> Option<&str> {
    match item.value() {
        ItemValue::Text(t) | ItemValue::Locator(t) => Some(t),
        ItemValue::Binary(_) => None,
    }
}

impl FormatTag for ApeTag {
    type Target = Target;

    fn listing(&self) -> Vec<(Option<Target>, TagEntry)> {
        let mut out = Vec::new();
        for item in self {
            let key = item.key();
            if is_picture_key(key) {
                continue;
            }
            if let Some((pair_key, number_item)) =
                PAIR_ITEMS.iter().find(|(k, _)| k.eq_ignore_ascii_case(key))
            {
                if let Some(text) = item_text(item) {
                    let (number_key, total_key) = pair_names(*number_item);
                    let (number, total) = split_pair(text);
                    let native = Some(key.to_string());
                    if let Some(n) = number {
                        let target = Target::Pair {
                            key: pair_key,
                            total: false,
                        };
                        out.push((Some(target), entry(number_key, n, native.clone(), false)));
                    }
                    if let Some(t) = total {
                        let target = Target::Pair {
                            key: pair_key,
                            total: true,
                        };
                        out.push((Some(target), entry(total_key, t, native, false)));
                    }
                    continue;
                }
            }
            match item_text(item) {
                Some(text) if !item.read_only => {
                    let target = Target::Item(key.to_string());
                    let candidates: Vec<&str> = mapped_name(TagType::Ape, key)
                        .into_iter()
                        .chain(std::iter::once(key))
                        .collect();
                    let display = display_key(self, &target, &candidates, format!("APE:{key}"));
                    let native = (display != key).then(|| key.to_string());
                    for value in text.split('\0') {
                        out.push((
                            Some(target.clone()),
                            entry(display.clone(), value, native.clone(), false),
                        ));
                    }
                }
                Some(text) => out.push((None, entry(key, text, None, true))),
                None => {
                    let summary = match item.value() {
                        ItemValue::Binary(data) => describe_binary(data),
                        _ => String::new(),
                    };
                    out.push((None, entry(key, summary, None, true)));
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
        let target = if let Some(raw) = key
            .get(..4)
            .filter(|p| p.eq_ignore_ascii_case("APE:"))
            .map(|_| &key[4..])
        {
            Target::Item(raw.to_string())
        } else if let Some(item) = canonical_item(key) {
            if let Some((number, total)) = pair_of(item) {
                if let Some((pair_key, _)) = PAIR_ITEMS.iter().find(|(_, n)| *n == number) {
                    return Ok(Target::Pair {
                        key: pair_key,
                        total,
                    });
                }
            }
            let candidates = native_candidates(item, TagType::Ape);
            let native = candidates
                .iter()
                .find(|c| self.get(c).is_some())
                .or(candidates.first())
                .copied()
                .unwrap_or(key);
            Target::Item(native.to_string())
        } else {
            Target::Item(key.to_string())
        };

        if let Target::Item(name) = &target {
            if is_picture_key(name) {
                return Err("Cover art is edited with the cover art actions".to_string());
            }
            if let Some(existing) = self.get(name) {
                if existing.read_only || item_text(existing).is_none() {
                    return Err(format!("APE item {name} is read-only"));
                }
            }
        }
        Ok(target)
    }

    fn current_values(&self, target: &Target) -> Vec<String> {
        self.listing()
            .into_iter()
            .filter(|(t, _)| t.as_ref() == Some(target))
            .map(|(_, e)| e.value)
            .collect()
    }

    fn write_values(&mut self, target: &Target, values: &[String]) -> Result<(), String> {
        let (name, value) = match target {
            Target::Item(name) => {
                let name = self
                    .get(name)
                    .map(|i| i.key().to_string())
                    .unwrap_or_else(|| name.clone());
                (name, values.join("\0"))
            }
            Target::Pair { key, total } => {
                let first = values.first().cloned().unwrap_or_default();
                let (number, old_total) = self
                    .get(key)
                    .and_then(item_text)
                    .map(split_pair)
                    .unwrap_or((None, None));
                let joined = if *total {
                    join_pair(number.as_deref(), Some(&first))
                } else if first.contains('/') {
                    Some(first)
                } else {
                    join_pair(Some(&first), old_total.as_deref())
                };
                let name = self
                    .get(key)
                    .map(|i| i.key().to_string())
                    .unwrap_or_else(|| key.to_string());
                (name, joined.unwrap_or_default())
            }
        };
        let is_locator = matches!(
            self.get(&name).map(|i| i.value()),
            Some(ItemValue::Locator(_))
        );
        let value = if is_locator {
            ItemValue::Locator(value)
        } else {
            ItemValue::Text(value)
        };
        let item = ApeItem::new(name.clone(), value)
            .map_err(|e| format!("Invalid APE item {name:?}: {e}"))?;
        self.insert(item);
        Ok(())
    }

    fn remove_target(&mut self, target: &Target) {
        match target {
            Target::Item(name) => self.remove(name),
            Target::Pair { key, total: false } => self.remove(key),
            Target::Pair { key, total: true } => {
                let Some(item) = self.get(key) else {
                    return;
                };
                let name = item.key().to_string();
                match item_text(item).and_then(|t| split_pair(t).0) {
                    Some(number) => {
                        if let Ok(item) = ApeItem::new(name, ItemValue::Text(number)) {
                            self.insert(item);
                        }
                    }
                    None => self.remove(key),
                }
            }
        }
    }
}

pub(super) fn set_cover(tag: &mut ApeTag, picture: Picture) -> Result<(), String> {
    let key = PictureType::CoverFront
        .as_ape_key()
        .unwrap_or("Cover Art (Front)")
        .to_string();
    let item = ApeItem::new(key, ItemValue::Binary(picture.as_ape_bytes()))
        .map_err(|e| format!("Invalid APE cover art item: {e}"))?;
    tag.insert(item);
    Ok(())
}

pub(super) fn remove_covers(tag: &mut ApeTag) {
    for picture_type in super::COVER_TYPES {
        if let Some(key) = picture_type.as_ape_key() {
            tag.remove(key);
        }
    }
}
