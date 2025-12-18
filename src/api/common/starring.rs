use crate::db::models::ItemType;
use sqlx::SqlitePool;
use std::collections::HashMap;

/// Get starred timestamps for multiple items of a given type for a user
pub async fn get_starred_map(
    pool: &SqlitePool,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> crate::error::Result<HashMap<String, String>> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Build placeholders for the IN clause
    let placeholders: Vec<&str> = item_ids.iter().map(|_| "?").collect();
    let query = format!(
        "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = ? AND item_id IN ({})",
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, (String, chrono::DateTime<chrono::Utc>)>(&query)
        .bind(user_id)
        .bind(item_type.as_str());

    for id in item_ids {
        query_builder = query_builder.bind(id);
    }

    let results: Vec<(String, chrono::DateTime<chrono::Utc>)> =
        query_builder.fetch_all(pool).await?;

    Ok(results
        .into_iter()
        .map(|(id, ts)| (id, ts.format("%Y-%m-%dT%H:%M:%SZ").to_string()))
        .collect())
}

/// Get ratings for multiple items of a given type for a user
pub async fn get_ratings_map(
    pool: &SqlitePool,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> crate::error::Result<HashMap<String, i32>> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Build placeholders for the IN clause
    let placeholders: Vec<&str> = item_ids.iter().map(|_| "?").collect();
    let query = format!(
        "SELECT item_id, rating FROM ratings WHERE user_id = ? AND item_type = ? AND item_id IN ({})",
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, (String, i32)>(&query)
        .bind(user_id)
        .bind(item_type.as_str());

    for id in item_ids {
        query_builder = query_builder.bind(id);
    }

    let results: Vec<(String, i32)> = query_builder.fetch_all(pool).await?;

    Ok(results.into_iter().collect())
}
