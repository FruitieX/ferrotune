//! Custom query string extractor that handles duplicate keys (e.g., `id=a&id=b`)
//! This is needed for Subsonic API compatibility.

use axum::{async_trait, extract::FromRequestParts, http::request::Parts};
use serde::de::DeserializeOwned;
use std::collections::HashMap;

/// A query string extractor that handles duplicate keys by collecting them into vectors.
/// This is compatible with the Subsonic API's style of passing multiple values.
///
/// For example, `id=a&id=b` will be parsed such that a struct field `id: Vec<String>`
/// will contain `["a", "b"]`.
pub struct QsQuery<T>(pub T);

#[async_trait]
impl<S, T> FromRequestParts<S> for QsQuery<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = axum::response::Response;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let query = parts.uri.query().unwrap_or_default();

        // Parse query string manually to handle duplicate keys
        let multi_map = parse_query_string(query);

        // Convert to a format serde_json can deserialize
        let json_value = multi_map_to_json(&multi_map);

        match serde_json::from_value::<T>(json_value) {
            Ok(value) => Ok(QsQuery(value)),
            Err(e) => {
                tracing::warn!("Failed to deserialize query string '{}': {}", query, e);
                Err(axum::response::IntoResponse::into_response(
                    crate::error::Error::InvalidRequest(format!("Invalid query parameters: {}", e)),
                ))
            }
        }
    }
}

/// Parse a query string into a multi-value map, handling duplicate keys.
fn parse_query_string(query: &str) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();

    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }

        let (key, value) = if let Some(pos) = pair.find('=') {
            let key = &pair[..pos];
            let value = &pair[pos + 1..];
            (key, value)
        } else {
            (pair, "")
        };

        // URL decode key and value
        // Replace '+' with space first (form URL encoding), then decode percent-encoding
        let key = urlencoding::decode(&key.replace('+', " "))
            .unwrap_or_else(|_| key.into())
            .into_owned();
        let value = urlencoding::decode(&value.replace('+', " "))
            .unwrap_or_else(|_| value.into())
            .into_owned();

        map.entry(key).or_default().push(value);
    }

    map
}

/// Convert a multi-value map to JSON.
/// All values are wrapped in arrays to support Vec<String> fields.
fn multi_map_to_json(map: &HashMap<String, Vec<String>>) -> serde_json::Value {
    let mut obj = serde_json::Map::new();

    for (key, values) in map {
        // Always create arrays - use string_or_seq deserializer on the struct side
        let json_value = serde_json::Value::Array(
            values
                .iter()
                .map(|v| serde_json::Value::String(v.clone()))
                .collect(),
        );
        obj.insert(key.clone(), json_value);
    }

    serde_json::Value::Object(obj)
}

// Allow destructuring like Query
impl<T> std::ops::Deref for QsQuery<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

/// Custom deserializer that accepts either a single string or a sequence of strings.
/// Use with `#[serde(deserialize_with = "string_or_seq")]` on Vec<String> fields.
pub fn string_or_seq<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct StringOrSeq;

    impl<'de> Visitor<'de> for StringOrSeq {
        type Value = Vec<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or sequence of strings")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(vec![value.to_owned()])
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(vec![value])
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            let mut vec = Vec::new();
            while let Some(value) = seq.next_element()? {
                vec.push(value);
            }
            Ok(vec)
        }
    }

    deserializer.deserialize_any(StringOrSeq)
}

/// Deserializer for Option<String> that extracts the first element from an array.
pub fn first_string_or_none<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct FirstStringOrNone;

    impl<'de> Visitor<'de> for FirstStringOrNone {
        type Value = Option<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string, sequence of strings, or null")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value.to_owned()))
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value))
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            // Return the first element if present
            Ok(seq.next_element()?)
        }
    }

    deserializer.deserialize_any(FirstStringOrNone)
}

/// Deserializer for String that extracts the first element from an array.
pub fn first_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct FirstString;

    impl<'de> Visitor<'de> for FirstString {
        type Value = String;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or sequence with at least one string")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value.to_owned())
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value)
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            seq.next_element()?
                .ok_or_else(|| de::Error::custom("expected at least one element"))
        }
    }

    deserializer.deserialize_any(FirstString)
}

/// Custom deserializer that accepts either a single u32 (as string) or a sequence of u32s.
/// Use with `#[serde(deserialize_with = "u32_or_seq")]` on Vec<u32> fields.
pub fn u32_or_seq<'de, D>(deserializer: D) -> Result<Vec<u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct U32OrSeq;

    impl<'de> Visitor<'de> for U32OrSeq {
        type Value = Vec<u32>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a u32 or sequence of u32s")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            value
                .parse::<u32>()
                .map(|v| vec![v])
                .map_err(de::Error::custom)
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(vec![value as u32])
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            let mut vec = Vec::new();
            while let Some(value) = seq.next_element::<String>()? {
                let parsed = value.parse::<u32>().map_err(de::Error::custom)?;
                vec.push(parsed);
            }
            Ok(vec)
        }
    }

    deserializer.deserialize_any(U32OrSeq)
}

/// Deserializer for Option<bool> that extracts the first element from an array and parses it.
pub fn first_bool_or_none<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct FirstBoolOrNone;

    impl<'de> Visitor<'de> for FirstBoolOrNone {
        type Value = Option<bool>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a bool, string 'true'/'false', sequence, or null")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            match value.to_lowercase().as_str() {
                "true" | "1" => Ok(Some(true)),
                "false" | "0" => Ok(Some(false)),
                "" => Ok(None),
                _ => Err(de::Error::custom(format!("invalid bool value: {}", value))),
            }
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            // Return the first element parsed as bool if present
            if let Some(value) = seq.next_element::<String>()? {
                match value.to_lowercase().as_str() {
                    "true" | "1" => Ok(Some(true)),
                    "false" | "0" => Ok(Some(false)),
                    "" => Ok(None),
                    _ => Err(de::Error::custom(format!("invalid bool value: {}", value))),
                }
            } else {
                Ok(None)
            }
        }
    }

    deserializer.deserialize_any(FirstBoolOrNone)
}

/// Deserializer for Option<i64> that extracts the first element from an array and parses it.
pub fn first_i64_or_none<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct FirstI64OrNone;

    impl<'de> Visitor<'de> for FirstI64OrNone {
        type Value = Option<i64>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an i64, string number, sequence, or null")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(None)
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value))
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(Some(value as i64))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            if value.is_empty() {
                Ok(None)
            } else {
                value.parse::<i64>().map(Some).map_err(de::Error::custom)
            }
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            // Return the first element parsed as i64 if present
            if let Some(value) = seq.next_element::<String>()? {
                if value.is_empty() {
                    Ok(None)
                } else {
                    value.parse::<i64>().map(Some).map_err(de::Error::custom)
                }
            } else {
                Ok(None)
            }
        }
    }

    deserializer.deserialize_any(FirstI64OrNone)
}

/// Deserialize an i32 from either a single value or the first element of a sequence.
pub fn first_i32<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};

    struct FirstI32;

    impl<'de> Visitor<'de> for FirstI32 {
        type Value = i32;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an i32, string number, or sequence")
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            i32::try_from(value).map_err(|_| de::Error::custom("value out of range for i32"))
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            i32::try_from(value).map_err(|_| de::Error::custom("value out of range for i32"))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            value.parse::<i32>().map_err(de::Error::custom)
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            // Return the first element parsed as i32
            if let Some(value) = seq.next_element::<String>()? {
                value.parse::<i32>().map_err(de::Error::custom)
            } else {
                Err(de::Error::custom("expected at least one element"))
            }
        }
    }

    deserializer.deserialize_any(FirstI32)
}
