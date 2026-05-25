//! Password hashing and verification using argon2.
//!
//! This module provides secure password hashing for user authentication.
//! We use Argon2id which is the recommended variant for password hashing.
//!
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

/// Hash a password using Argon2id.
///
/// Returns the PHC-formatted hash string which includes the algorithm,
/// parameters, salt, and hash.
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

/// Verify a password against an Argon2 hash.
///
/// Returns true if the password matches, false otherwise.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify() {
        let password = "test_password_123";
        let hash = hash_password(password).expect("hashing should succeed");

        // Hash should be in PHC format
        assert!(hash.starts_with("$argon2"));

        // Correct password should verify
        assert!(verify_password(password, &hash));

        // Wrong password should not verify
        assert!(!verify_password("wrong_password", &hash));
    }

    #[test]
    fn test_different_passwords_different_hashes() {
        let hash1 = hash_password("password1").unwrap();
        let hash2 = hash_password("password1").unwrap();

        // Same password should produce different hashes (different salts)
        assert_ne!(hash1, hash2);

        // But both should verify
        assert!(verify_password("password1", &hash1));
        assert!(verify_password("password1", &hash2));
    }
}
