//! Database retry utilities for handling transient SQLite errors.
//!
//! SQLite can return "database is locked" errors when there are concurrent writes.
//! This module provides utilities to retry operations with exponential backoff.

use sea_orm::DbErr;
use std::future::Future;
use std::time::Duration;
use tokio::time::sleep;

/// Default maximum number of retry attempts
pub const DEFAULT_MAX_RETRIES: u32 = 5;

/// Default initial backoff duration (50ms)
pub const DEFAULT_INITIAL_BACKOFF_MS: u64 = 50;

/// Maximum backoff duration (5 seconds)
pub const MAX_BACKOFF_MS: u64 = 5000;

fn message_indicates_busy(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("database is locked") || lower.contains("database is busy")
}

/// Check if a SeaORM error is a retryable SQLite "database locked/busy" error.
pub fn is_retryable_error(error: &DbErr) -> bool {
    // SeaORM wraps the underlying sqlx error message in its variants.
    match error {
        DbErr::Exec(e) | DbErr::Query(e) | DbErr::Conn(e) => {
            let msg = e.to_string();
            message_indicates_busy(&msg)
        }
        _ => {
            let msg = error.to_string();
            message_indicates_busy(&msg)
        }
    }
}

/// Execute a database operation with retry logic for transient errors.
///
/// This function will retry the operation with exponential backoff when
/// encountering "database is locked" or similar transient errors.
pub async fn with_retry<F, Fut, T>(operation: F, max_retries: Option<u32>) -> Result<T, DbErr>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, DbErr>>,
{
    let max_attempts = max_retries.unwrap_or(DEFAULT_MAX_RETRIES);
    let mut attempt = 0;
    let mut backoff_ms = DEFAULT_INITIAL_BACKOFF_MS;

    loop {
        attempt += 1;

        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) if is_retryable_error(&e) && attempt < max_attempts => {
                tracing::warn!(
                    attempt = attempt,
                    max_attempts = max_attempts,
                    backoff_ms = backoff_ms,
                    error = %e,
                    "Database locked, retrying after backoff"
                );

                sleep(Duration::from_millis(backoff_ms)).await;

                // Exponential backoff with jitter
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
                // Add some jitter (±25%)
                let jitter = (backoff_ms as f64 * 0.25 * (rand_jitter() - 0.5)) as u64;
                backoff_ms = backoff_ms.saturating_add_signed(jitter as i64);
            }
            Err(e) => {
                if is_retryable_error(&e) {
                    tracing::error!(
                        attempt = attempt,
                        max_attempts = max_attempts,
                        error = %e,
                        "Database locked error persisted after max retries"
                    );
                }
                return Err(e);
            }
        }
    }
}

/// Simple pseudo-random jitter factor between 0.0 and 1.0.
/// Uses system time as a simple source of randomness.
fn rand_jitter() -> f64 {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos % 1000) as f64 / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_retryable_error() {
        // Non-busy errors should not be retryable
        let custom = DbErr::Custom("some random failure".to_string());
        assert!(!is_retryable_error(&custom));

        let busy = DbErr::Exec(sea_orm::RuntimeErr::Internal(
            "database is locked".to_string(),
        ));
        assert!(is_retryable_error(&busy));
    }
}
