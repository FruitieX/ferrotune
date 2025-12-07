//! Password hashing and verification using argon2.
//!
//! This module provides secure password hashing for user authentication.
//! We use Argon2id which is the recommended variant for password hashing.
//!
//! For OpenSubsonic token authentication compatibility, we also store a
//! separate MD5-based token. This is less secure but required for legacy
//! clients that use the token+salt authentication method. Users should
//! prefer API key authentication when possible.

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

/// Generate the MD5-based subsonic token for legacy token+salt authentication.
///
/// This is stored separately and used for OpenSubsonic's token authentication
/// where the client sends md5(password + salt). To verify, the server computes
/// md5(stored_subsonic_token + client_salt) which should match the client's token
/// when stored_subsonic_token is the original password.
///
/// Note: For better security, clients should use API key authentication instead.
///
/// We store the plaintext password in this field because the token auth
/// requires computing md5(password + salt) with an arbitrary salt from the client.
/// This is a limitation of the Subsonic protocol design.
pub fn create_subsonic_token(password: &str) -> String {
    // For token auth, we need to store the plaintext password because
    // the client sends md5(password + salt) with an arbitrary salt.
    // We can't pre-compute this without knowing all possible salts.
    //
    // While this is not ideal from a security perspective, it's required
    // for Subsonic protocol compatibility. Users who want better security
    // should use API key authentication.
    password.to_string()
}

/// Verify a subsonic token against the stored token.
///
/// The client sends: t = md5(password + salt)
/// We compute: md5(stored_subsonic_token + salt) and compare
pub fn verify_subsonic_token(client_token: &str, salt: &str, stored_subsonic_token: &str) -> bool {
    let expected = format!(
        "{:x}",
        md5::compute(format!("{}{}", stored_subsonic_token, salt))
    );
    client_token == expected
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

    #[test]
    fn test_subsonic_token_verification() {
        let password = "secretpassword";
        let salt = "randomsalt123";

        let stored_token = create_subsonic_token(password);

        // Client computes: md5(password + salt)
        let client_token = format!("{:x}", md5::compute(format!("{}{}", password, salt)));

        // Should verify correctly
        assert!(verify_subsonic_token(&client_token, salt, &stored_token));

        // Wrong salt should fail
        assert!(!verify_subsonic_token(&client_token, "different_salt", &stored_token));

        // Wrong token should fail
        assert!(!verify_subsonic_token("wrong_token", salt, &stored_token));
    }
}
