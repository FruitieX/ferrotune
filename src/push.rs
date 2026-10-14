//! Firebase Cloud Messaging sender for waking native apps.
//!
//! An idle phone closes its session event stream (its keep-alives would wake
//! the radio all day), so a remote "play here" reaches it as a push instead:
//! FCM rides the connection Google Play services keeps open anyway.
//!
//! Configured with `FERROTUNE_FCM_SERVICE_ACCOUNT`: a Firebase service account
//! key, either the JSON itself or a path to the JSON file. Unset disables push.

use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ring::rand::SystemRandom;
use ring::signature::{RsaKeyPair, RSA_PKCS1_SHA256};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tokio::sync::Mutex;

use crate::error::{Error, Result};

const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
/// Refresh the OAuth token this long before Google says it expires.
const ACCESS_TOKEN_MARGIN: Duration = Duration::from_secs(120);

#[derive(Deserialize)]
struct ServiceAccount {
    project_id: String,
    client_email: String,
    private_key: String,
    #[serde(default)]
    token_uri: Option<String>,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: String,
    expires_in: u64,
}

/// What became of a push message.
#[derive(Debug, PartialEq, Eq)]
pub enum PushOutcome {
    Sent,
    /// FCM no longer accepts the token (app uninstalled or data cleared).
    TokenRejected,
}

pub struct FcmSender {
    project_id: String,
    client_email: String,
    token_uri: String,
    key_pair: RsaKeyPair,
    http: reqwest::Client,
    access_token: Mutex<Option<(String, Instant)>>,
}

static SENDER: OnceLock<Option<Arc<FcmSender>>> = OnceLock::new();

/// The configured sender, or `None` when push messaging is not set up.
pub fn sender() -> Option<Arc<FcmSender>> {
    SENDER
        .get_or_init(|| match FcmSender::from_env() {
            Ok(sender) => sender.map(Arc::new),
            Err(error) => {
                tracing::warn!("Push messaging disabled: {error}");
                None
            }
        })
        .clone()
}

impl FcmSender {
    fn from_env() -> Result<Option<Self>> {
        let Ok(raw) = std::env::var("FERROTUNE_FCM_SERVICE_ACCOUNT") else {
            return Ok(None);
        };
        let raw = raw.trim();
        if raw.is_empty() {
            return Ok(None);
        }
        let json = if raw.starts_with('{') {
            raw.to_string()
        } else {
            std::fs::read_to_string(raw)?
        };
        Self::from_service_account_json(&json).map(Some)
    }

    pub(crate) fn from_service_account_json(json: &str) -> Result<Self> {
        let account: ServiceAccount = serde_json::from_str(json)
            .map_err(|error| Error::Config(format!("Invalid FCM service account: {error}")))?;
        let key_pair = RsaKeyPair::from_pkcs8(&pem_to_der(&account.private_key)?)
            .map_err(|error| Error::Config(format!("Invalid FCM service account key: {error}")))?;
        Ok(Self {
            project_id: account.project_id,
            client_email: account.client_email,
            token_uri: account
                .token_uri
                .unwrap_or_else(|| DEFAULT_TOKEN_URI.to_string()),
            key_pair,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .map_err(|error| Error::Internal(format!("HTTP client: {error}")))?,
            access_token: Mutex::new(None),
        })
    }

    /// Sends a high-priority data message, which may wake a sleeping phone and
    /// lets the app start playback from the background.
    pub async fn send_data(&self, token: &str, data: Map<String, Value>) -> Result<PushOutcome> {
        let access_token = self.access_token().await?;
        let url = format!(
            "https://fcm.googleapis.com/v1/projects/{}/messages:send",
            self.project_id
        );
        let body = json!({
            "message": {
                "token": token,
                "data": data,
                // A wake-up for "play here" is useless once it is stale.
                "android": { "priority": "HIGH", "ttl": "60s" },
            }
        });
        let response = self
            .http
            .post(url)
            .bearer_auth(access_token)
            .json(&body)
            .send()
            .await
            .map_err(|error| Error::Internal(format!("FCM request failed: {error}")))?;
        let status = response.status();
        if status.is_success() {
            return Ok(PushOutcome::Sent);
        }
        let text = response.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND || text.contains("UNREGISTERED") {
            return Ok(PushOutcome::TokenRejected);
        }
        Err(Error::Internal(format!(
            "FCM send failed ({status}): {text}"
        )))
    }

    async fn access_token(&self) -> Result<String> {
        let mut cached = self.access_token.lock().await;
        if let Some((token, expires_at)) = cached.as_ref() {
            if Instant::now() + ACCESS_TOKEN_MARGIN < *expires_at {
                return Ok(token.clone());
            }
        }
        let assertion = self.signed_jwt()?;
        let response = self
            .http
            .post(&self.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await
            .map_err(|error| Error::Internal(format!("FCM token request failed: {error}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(Error::Internal(format!(
                "FCM token request failed ({status}): {text}"
            )));
        }
        let token: AccessTokenResponse = response
            .json()
            .await
            .map_err(|error| Error::Internal(format!("FCM token response: {error}")))?;
        *cached = Some((
            token.access_token.clone(),
            Instant::now() + Duration::from_secs(token.expires_in),
        ));
        Ok(token.access_token)
    }

    /// A service-account JWT asking Google for an FCM access token.
    fn signed_jwt(&self) -> Result<String> {
        let issued_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256","typ":"JWT"}"#);
        let claims = URL_SAFE_NO_PAD.encode(
            json!({
                "iss": self.client_email,
                "scope": FCM_SCOPE,
                "aud": self.token_uri,
                "iat": issued_at,
                "exp": issued_at + 3600,
            })
            .to_string(),
        );
        let signing_input = format!("{header}.{claims}");
        let mut signature = vec![0; self.key_pair.public().modulus_len()];
        self.key_pair
            .sign(
                &RSA_PKCS1_SHA256,
                &SystemRandom::new(),
                signing_input.as_bytes(),
                &mut signature,
            )
            .map_err(|_| Error::Internal("Could not sign the FCM token request".to_string()))?;
        Ok(format!(
            "{signing_input}.{}",
            URL_SAFE_NO_PAD.encode(signature)
        ))
    }
}

/// Decodes a PEM private key (as found in a service account file) to DER.
fn pem_to_der(pem: &str) -> Result<Vec<u8>> {
    let body: String = pem
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("-----"))
        .collect();
    STANDARD
        .decode(body)
        .map_err(|error| Error::Config(format!("Invalid FCM service account key: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pem_bodies_decode_across_lines() {
        let pem = "-----BEGIN PRIVATE KEY-----\nAAEC\nAwQ=\n-----END PRIVATE KEY-----\n";
        assert_eq!(pem_to_der(pem).ok(), Some(vec![0, 1, 2, 3, 4]));
    }

    /// Signs a token request with the RSA key at `FERROTUNE_TEST_RSA_PKCS8_PEM`
    /// and verifies it; skipped without one, so no private key lives in the
    /// repository (`openssl genpkey -algorithm RSA -out key.pem` makes one).
    #[test]
    fn signed_jwt_verifies_with_the_service_account_key() {
        use ring::signature::{UnparsedPublicKey, RSA_PKCS1_2048_8192_SHA256};

        let Ok(path) = std::env::var("FERROTUNE_TEST_RSA_PKCS8_PEM") else {
            return;
        };
        let pem = std::fs::read_to_string(path).expect("test key");
        let account = json!({
            "project_id": "ferrotune-test",
            "client_email": "push@ferrotune-test.iam.gserviceaccount.com",
            "private_key": pem,
        });
        let sender = FcmSender::from_service_account_json(&account.to_string()).expect("sender");

        let jwt = sender.signed_jwt().expect("jwt");
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3);
        UnparsedPublicKey::new(
            &RSA_PKCS1_2048_8192_SHA256,
            sender.key_pair.public().as_ref(),
        )
        .verify(
            format!("{}.{}", parts[0], parts[1]).as_bytes(),
            &URL_SAFE_NO_PAD.decode(parts[2]).expect("signature"),
        )
        .expect("signature verifies");
        let claims: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).expect("claims"))
                .expect("claims json");
        assert_eq!(claims["scope"], FCM_SCOPE);
        assert_eq!(claims["aud"], DEFAULT_TOKEN_URI);
        assert_eq!(claims["iss"], "push@ferrotune-test.iam.gserviceaccount.com");
    }

    #[test]
    fn invalid_service_accounts_are_configuration_errors() {
        assert!(matches!(
            FcmSender::from_service_account_json("{}"),
            Err(Error::Config(_))
        ));
        let bad_key = r#"{"project_id":"p","client_email":"e","private_key":"-----BEGIN PRIVATE KEY-----\nAAEC\n-----END PRIVATE KEY-----"}"#;
        assert!(matches!(
            FcmSender::from_service_account_json(bad_key),
            Err(Error::Config(_))
        ));
    }
}
