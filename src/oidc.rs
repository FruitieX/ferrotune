//! Sign-in through an OpenID Connect provider (Pocket ID).
//!
//! The server is the relying party (confidential client, authorization code
//! flow with PKCE). Clients never see provider tokens:
//!
//! 1. A client opens `GET /api/auth/oidc/start?redirect=<client uri>` in a
//!    browser. The redirect must be on the allowlist (`<public url>/login/callback`,
//!    the Android app's custom scheme, plus `FERROTUNE_OIDC_REDIRECT_URIS`).
//! 2. The provider sends the browser to `GET /api/auth/oidc/callback`, which
//!    checks the ID token, maps it to a local user and redirects to the client
//!    URI with a short-lived single-use code (never a session token in a URL).
//! 3. The client posts that code to `POST /api/auth/oidc/exchange` and gets the
//!    normal login response with a regular `auth_sessions` session.
//!
//! The pending logins and issued codes live in memory: a restart in the middle
//! of a sign-in only means signing in again.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::Deserialize;

use crate::error::{Error, Result};

pub const ISSUER_ENV: &str = "FERROTUNE_OIDC_ISSUER";
pub const CLIENT_ID_ENV: &str = "FERROTUNE_OIDC_CLIENT_ID";
pub const CLIENT_SECRET_ENV: &str = "FERROTUNE_OIDC_CLIENT_SECRET";
pub const PUBLIC_URL_ENV: &str = "FERROTUNE_PUBLIC_URL";
pub const ALLOWED_GROUPS_ENV: &str = "FERROTUNE_OIDC_ALLOWED_GROUPS";
pub const ADMIN_GROUP_ENV: &str = "FERROTUNE_OIDC_ADMIN_GROUP";
pub const USER_MAP_ENV: &str = "FERROTUNE_OIDC_USER_MAP";
pub const REDIRECT_URIS_ENV: &str = "FERROTUNE_OIDC_REDIRECT_URIS";

/// Where the native Android app receives the end of a sign-in.
pub const ANDROID_REDIRECT_URI: &str = "ferrotune://oidc/callback";
/// Cookie tying a provider callback to the browser that started the sign-in.
pub const BINDING_COOKIE: &str = "ferrotune_oidc";
pub const CALLBACK_PATH: &str = "/api/auth/oidc/callback";

const LOGIN_TTL: Duration = Duration::from_secs(600);
const CODE_TTL: Duration = Duration::from_secs(120);
/// Pending sign-ins are created by unauthenticated requests; cap them so they
/// cannot grow memory without bound.
const MAX_PENDING: usize = 1000;

#[derive(Debug, Clone, PartialEq)]
pub struct OidcConfig {
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    /// Public origin of this server, e.g. `https://ferrotune.example.org`.
    pub public_url: String,
    /// Sign-in needs membership in one of these groups; empty allows anyone
    /// the provider lets through.
    pub allowed_groups: Vec<String>,
    /// Members of this group are admins, everyone else is not. `None` leaves
    /// the admin flag alone.
    pub admin_group: Option<String>,
    /// Provider username (lowercase) -> local username, for accounts whose
    /// names differ between the two.
    pub user_map: HashMap<String, String>,
    /// Client URIs the end of a sign-in may be sent to.
    pub client_redirects: Vec<String>,
}

fn split_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

impl OidcConfig {
    /// Reads the configuration from the environment. `Ok(None)` when no OIDC
    /// variable is set; an error when the configuration is incomplete.
    pub fn from_env() -> Result<Option<Self>> {
        Self::from_lookup(|key| {
            std::env::var(key)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
    }

    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Option<Self>> {
        let issuer = get(ISSUER_ENV);
        let client_id = get(CLIENT_ID_ENV);
        let client_secret = get(CLIENT_SECRET_ENV);
        if issuer.is_none() && client_id.is_none() && client_secret.is_none() {
            return Ok(None);
        }
        let missing = |name: &str| {
            Error::Config(format!(
                "OIDC sign-in needs {ISSUER_ENV}, {CLIENT_ID_ENV}, {CLIENT_SECRET_ENV} and {PUBLIC_URL_ENV}; {name} is not set"
            ))
        };
        let issuer = issuer.ok_or_else(|| missing(ISSUER_ENV))?;
        let client_id = client_id.ok_or_else(|| missing(CLIENT_ID_ENV))?;
        let client_secret = client_secret.ok_or_else(|| missing(CLIENT_SECRET_ENV))?;
        let public_url = get(PUBLIC_URL_ENV)
            .ok_or_else(|| missing(PUBLIC_URL_ENV))?
            .trim_end_matches('/')
            .to_string();
        if !public_url.starts_with("http://") && !public_url.starts_with("https://") {
            return Err(Error::Config(format!(
                "{PUBLIC_URL_ENV} must be an http(s) URL"
            )));
        }

        let mut user_map = HashMap::new();
        for pair in split_list(&get(USER_MAP_ENV).unwrap_or_default()) {
            let (provider, local) = pair.split_once(':').ok_or_else(|| {
                Error::Config(format!(
                    "{USER_MAP_ENV} entries look like provideruser:localuser, got {pair:?}"
                ))
            })?;
            user_map.insert(provider.trim().to_lowercase(), local.trim().to_string());
        }

        let mut client_redirects = vec![
            format!("{public_url}/login/callback"),
            ANDROID_REDIRECT_URI.to_string(),
        ];
        client_redirects.extend(split_list(&get(REDIRECT_URIS_ENV).unwrap_or_default()));

        Ok(Some(Self {
            issuer: issuer.trim_end_matches('/').to_string(),
            client_id,
            client_secret,
            allowed_groups: split_list(&get(ALLOWED_GROUPS_ENV).unwrap_or_default()),
            admin_group: get(ADMIN_GROUP_ENV),
            user_map,
            client_redirects,
            public_url,
        }))
    }

    pub fn callback_url(&self) -> String {
        format!("{}{CALLBACK_PATH}", self.public_url)
    }

    /// Exact match only: the code lands wherever this points.
    pub fn is_allowed_redirect(&self, redirect: &str) -> bool {
        self.client_redirects
            .iter()
            .any(|allowed| allowed == redirect)
    }

    pub fn secure_cookies(&self) -> bool {
        self.public_url.starts_with("https://")
    }

    /// The local username a provider account links to by default.
    pub fn local_username_for(&self, preferred_username: &str) -> String {
        self.user_map
            .get(&preferred_username.to_lowercase())
            .cloned()
            .unwrap_or_else(|| preferred_username.to_string())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Discovery {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
}

/// A sign-in between `start` and the provider callback.
#[derive(Debug, Clone)]
pub struct PendingLogin {
    pub nonce: String,
    pub verifier: String,
    /// blake3 of the browser binding cookie.
    pub binding_hash: String,
    pub client_redirect: String,
    /// The client's own PKCE challenge for the exchange step, if it sent one.
    pub client_challenge: Option<String>,
    pub created: Instant,
}

/// A signed-in user waiting for the client to redeem its code.
#[derive(Debug, Clone)]
pub struct IssuedCode {
    pub user_id: i64,
    pub client_challenge: Option<String>,
    pub created: Instant,
}

/// Who the provider says signed in, after the claim checks.
#[derive(Debug, Clone, PartialEq)]
pub struct Identity {
    pub issuer: String,
    pub subject: String,
    pub preferred_username: Option<String>,
    pub email: Option<String>,
    pub groups: Vec<String>,
}

#[derive(Deserialize)]
struct IdClaims {
    iss: String,
    sub: String,
    aud: Audience,
    exp: u64,
    nonce: Option<String>,
    preferred_username: Option<String>,
    email: Option<String>,
    #[serde(default)]
    email_verified: bool,
    #[serde(default)]
    groups: Vec<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

impl Audience {
    fn contains(&self, id: &str) -> bool {
        match self {
            Audience::One(aud) => aud == id,
            Audience::Many(auds) => auds.iter().any(|aud| aud == id),
        }
    }
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(ring::digest::digest(
        &ring::digest::SHA256,
        verifier.as_bytes(),
    ))
}

/// A PKCE S256 challenge is 32 bytes, base64url without padding.
pub fn is_valid_challenge(challenge: &str) -> bool {
    challenge.len() == 43
        && challenge
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The OIDC `prompt` values a client may ask the provider for. Anything
/// else (`none`, `consent`, combinations) is dropped rather than forwarded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prompt {
    /// Re-authenticate the provider's signed-in user.
    Login,
    /// Let the person confirm or switch the provider account (Pocket ID shows
    /// the signed-in user with "Use a different account"). Clients send it
    /// when adding another account, so a provider session can't silently
    /// sign in the same person again.
    SelectAccount,
}

impl Prompt {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "login" => Some(Self::Login),
            "select_account" => Some(Self::SelectAccount),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Login => "login",
            Self::SelectAccount => "select_account",
        }
    }
}

pub fn hash_secret(value: &str) -> String {
    blake3::hash(value.as_bytes()).to_hex().to_string()
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

/// Appends query parameters to a client redirect URI.
pub fn with_query(uri: &str, pairs: &[(&str, &str)]) -> String {
    let query = serde_urlencoded::to_string(pairs).unwrap_or_default();
    let separator = if uri.contains('?') { '&' } else { '?' };
    format!("{uri}{separator}{query}")
}

pub struct Oidc {
    pub config: OidcConfig,
    http: reqwest::Client,
    discovery: Mutex<Option<Discovery>>,
    pending: Mutex<HashMap<String, PendingLogin>>,
    codes: Mutex<HashMap<String, IssuedCode>>,
}

impl Oidc {
    pub fn new(config: OidcConfig) -> Self {
        Self {
            config,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
            discovery: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            codes: Mutex::new(HashMap::new()),
        }
    }

    pub fn from_env() -> Result<Option<Self>> {
        Ok(OidcConfig::from_env()?.map(Self::new))
    }

    async fn discovery(&self) -> Result<Discovery> {
        if let Some(discovery) = self.discovery.lock().unwrap().clone() {
            return Ok(discovery);
        }
        let url = format!("{}/.well-known/openid-configuration", self.config.issuer);
        let discovery: Discovery = self
            .http
            .get(&url)
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|e| Error::Internal(format!("fetching {url}: {e}")))?
            .json()
            .await
            .map_err(|e| Error::Internal(format!("reading {url}: {e}")))?;
        *self.discovery.lock().unwrap() = Some(discovery.clone());
        Ok(discovery)
    }

    /// Records a new sign-in and returns the provider URL to send the browser
    /// to. The caller has validated `client_redirect` and `client_challenge`.
    pub async fn start(
        &self,
        binding: &str,
        client_redirect: &str,
        client_challenge: Option<&str>,
        prompt: Option<Prompt>,
    ) -> Result<String> {
        let discovery = self.discovery().await?;
        let state = random_token();
        let login = PendingLogin {
            nonce: random_token(),
            verifier: random_token(),
            binding_hash: hash_secret(binding),
            client_redirect: client_redirect.to_string(),
            client_challenge: client_challenge.map(str::to_string),
            created: Instant::now(),
        };
        let url = self.authorization_url(&discovery, &state, &login, prompt);
        {
            let mut pending = self.pending.lock().unwrap();
            pending.retain(|_, login| login.created.elapsed() < LOGIN_TTL);
            if pending.len() >= MAX_PENDING {
                return Err(Error::Forbidden(
                    "Too many sign-ins in progress; try again later".to_string(),
                ));
            }
            pending.insert(state, login);
        }
        Ok(url)
    }

    fn authorization_url(
        &self,
        discovery: &Discovery,
        state: &str,
        login: &PendingLogin,
        prompt: Option<Prompt>,
    ) -> String {
        let challenge = pkce_challenge(&login.verifier);
        let callback = self.config.callback_url();
        let mut params: Vec<(&str, &str)> = vec![
            ("response_type", "code"),
            ("client_id", self.config.client_id.as_str()),
            ("redirect_uri", callback.as_str()),
            ("scope", "openid profile email groups"),
            ("state", state),
            ("nonce", login.nonce.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ];
        if let Some(prompt) = prompt {
            params.push(("prompt", prompt.as_str()));
        }
        with_query(&discovery.authorization_endpoint, &params)
    }

    /// Takes the pending sign-in for `state` (single use). `None` when it is
    /// unknown, expired, or was started in another browser.
    pub fn take_pending(&self, state: &str, binding: Option<&str>) -> Option<PendingLogin> {
        let login = self.pending.lock().unwrap().remove(state)?;
        if login.created.elapsed() >= LOGIN_TTL {
            return None;
        }
        let binding = binding?;
        constant_time_eq(&login.binding_hash, &hash_secret(binding)).then_some(login)
    }

    /// Redeems the provider's authorization code and checks the ID token.
    pub async fn finish(&self, login: &PendingLogin, code: &str) -> Result<Identity> {
        let discovery = self.discovery().await?;
        #[derive(Deserialize)]
        struct TokenResponse {
            id_token: String,
        }
        let callback = self.config.callback_url();
        let response = self
            .http
            .post(&discovery.token_endpoint)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", &callback),
                ("client_id", &self.config.client_id),
                ("client_secret", &self.config.client_secret),
                ("code_verifier", &login.verifier),
            ])
            .send()
            .await
            .map_err(|e| Error::Internal(format!("redeeming the authorization code: {e}")))?;
        if !response.status().is_success() {
            return Err(Error::Auth(format!(
                "the provider refused the authorization code ({})",
                response.status()
            )));
        }
        let tokens: TokenResponse = response
            .json()
            .await
            .map_err(|e| Error::Internal(format!("reading the token response: {e}")))?;
        self.check_id_token(&discovery, login, &tokens.id_token)
    }

    /// The ID token comes straight from the token endpoint over TLS, so its
    /// signature need not be checked (OpenID Connect Core 3.1.3.7); the
    /// claims still are.
    fn check_id_token(
        &self,
        discovery: &Discovery,
        login: &PendingLogin,
        id_token: &str,
    ) -> Result<Identity> {
        let malformed = || Error::Auth("malformed ID token".to_string());
        let payload = id_token.split('.').nth(1).ok_or_else(malformed)?;
        let bytes = URL_SAFE_NO_PAD.decode(payload).map_err(|_| malformed())?;
        let claims: IdClaims = serde_json::from_slice(&bytes).map_err(|_| malformed())?;
        if claims.iss.trim_end_matches('/') != discovery.issuer.trim_end_matches('/') {
            return Err(Error::Auth(format!(
                "ID token from unexpected issuer {}",
                claims.iss
            )));
        }
        if !claims.aud.contains(&self.config.client_id) {
            return Err(Error::Auth("ID token is for another client".to_string()));
        }
        if claims.exp <= unix_now() {
            return Err(Error::Auth("ID token has expired".to_string()));
        }
        if claims.nonce.as_deref() != Some(login.nonce.as_str()) {
            return Err(Error::Auth("ID token nonce does not match".to_string()));
        }
        let allowed = &self.config.allowed_groups;
        if !allowed.is_empty() && !claims.groups.iter().any(|g| allowed.contains(g)) {
            return Err(Error::Forbidden(
                "your account is not in a group allowed to use Ferrotune".to_string(),
            ));
        }
        Ok(Identity {
            issuer: claims.iss,
            subject: claims.sub,
            preferred_username: claims.preferred_username.filter(|name| !name.is_empty()),
            email: claims.email.filter(|_| claims.email_verified),
            groups: claims.groups,
        })
    }

    /// Whether this identity should be an admin; `None` leaves it unchanged.
    pub fn admin_flag(&self, identity: &Identity) -> Option<bool> {
        self.config
            .admin_group
            .as_ref()
            .map(|group| identity.groups.iter().any(|g| g == group))
    }

    /// Issues the single-use code the client redeems for a session.
    pub fn issue_code(&self, user_id: i64, client_challenge: Option<String>) -> String {
        let code = random_token();
        let mut codes = self.codes.lock().unwrap();
        codes.retain(|_, issued| issued.created.elapsed() < CODE_TTL);
        codes.insert(
            hash_secret(&code),
            IssuedCode {
                user_id,
                client_challenge,
                created: Instant::now(),
            },
        );
        code
    }

    /// Redeems a code once. The verifier must match the challenge the client
    /// sent to `start`, if it sent one.
    pub fn redeem_code(&self, code: &str, verifier: Option<&str>) -> Result<i64> {
        let invalid = || Error::Auth("Invalid or expired sign-in code".to_string());
        let issued = self
            .codes
            .lock()
            .unwrap()
            .remove(&hash_secret(code))
            .ok_or_else(invalid)?;
        if issued.created.elapsed() >= CODE_TTL {
            return Err(invalid());
        }
        if let Some(challenge) = &issued.client_challenge {
            let verifier = verifier.ok_or_else(invalid)?;
            if !constant_time_eq(challenge, &pkce_challenge(verifier)) {
                return Err(invalid());
            }
        }
        Ok(issued.user_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |key| map.get(key).cloned()
    }

    fn config() -> OidcConfig {
        OidcConfig::from_lookup(env(&[
            (ISSUER_ENV, "https://id.example.org/"),
            (CLIENT_ID_ENV, "ferrotune"),
            (CLIENT_SECRET_ENV, "s"),
            (PUBLIC_URL_ENV, "https://music.example.org/"),
            (ALLOWED_GROUPS_ENV, "family, kids"),
            (ADMIN_GROUP_ENV, "admins"),
            (USER_MAP_ENV, "Rasse:admin"),
            (REDIRECT_URIS_ENV, "http://localhost:3000/login/callback"),
        ]))
        .unwrap()
        .unwrap()
    }

    fn discovery() -> Discovery {
        Discovery {
            issuer: "https://id.example.org".into(),
            authorization_endpoint: "https://id.example.org/authorize".into(),
            token_endpoint: "https://id.example.org/api/oidc/token".into(),
        }
    }

    fn login() -> PendingLogin {
        PendingLogin {
            nonce: "n1".into(),
            verifier: "v".into(),
            binding_hash: hash_secret("b"),
            client_redirect: "ferrotune://oidc/callback".into(),
            client_challenge: None,
            created: Instant::now(),
        }
    }

    fn token(claims: serde_json::Value) -> String {
        format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
        )
    }

    fn claims() -> serde_json::Value {
        serde_json::json!({
            "iss": "https://id.example.org", "sub": "u1", "aud": "ferrotune",
            "exp": unix_now() + 60, "nonce": "n1", "preferred_username": "rasse",
            "email": "r@example.org", "email_verified": true,
            "groups": ["admins", "family"],
        })
    }

    #[test]
    fn config_is_optional_but_must_be_complete() {
        assert_eq!(OidcConfig::from_lookup(env(&[])).unwrap(), None);
        assert!(OidcConfig::from_lookup(env(&[(ISSUER_ENV, "https://id")])).is_err());
        assert!(OidcConfig::from_lookup(env(&[
            (ISSUER_ENV, "https://id"),
            (CLIENT_ID_ENV, "c"),
            (CLIENT_SECRET_ENV, "s"),
        ]))
        .is_err());
        assert!(OidcConfig::from_lookup(env(&[
            (ISSUER_ENV, "https://id"),
            (CLIENT_ID_ENV, "c"),
            (CLIENT_SECRET_ENV, "s"),
            (PUBLIC_URL_ENV, "https://music"),
            (USER_MAP_ENV, "nocolon"),
        ]))
        .is_err());

        let config = config();
        assert_eq!(config.issuer, "https://id.example.org");
        assert_eq!(
            config.callback_url(),
            "https://music.example.org/api/auth/oidc/callback"
        );
        assert_eq!(config.allowed_groups, vec!["family", "kids"]);
        assert!(config.secure_cookies());
    }

    #[test]
    fn redirects_are_allowlisted_exactly() {
        let config = config();
        assert!(config.is_allowed_redirect("https://music.example.org/login/callback"));
        assert!(config.is_allowed_redirect("ferrotune://oidc/callback"));
        assert!(config.is_allowed_redirect("http://localhost:3000/login/callback"));
        for bad in [
            "https://music.example.org/login/callback/",
            "https://music.example.org/login/callback?x=1",
            "https://evil.example.org/login/callback",
            "https://music.example.org.evil.org/login/callback",
            "ferrotune://other",
            "",
        ] {
            assert!(!config.is_allowed_redirect(bad), "{bad} should be refused");
        }
    }

    #[test]
    fn user_map_is_case_insensitive() {
        let config = config();
        assert_eq!(config.local_username_for("rasse"), "admin");
        assert_eq!(config.local_username_for("RASSE"), "admin");
        assert_eq!(config.local_username_for("ada"), "ada");
    }

    #[test]
    fn accepts_valid_id_token() {
        let oidc = Oidc::new(config());
        let identity = oidc
            .check_id_token(&discovery(), &login(), &token(claims()))
            .unwrap();
        assert_eq!(identity.subject, "u1");
        assert_eq!(identity.preferred_username.as_deref(), Some("rasse"));
        assert_eq!(identity.email.as_deref(), Some("r@example.org"));
        assert_eq!(oidc.admin_flag(&identity), Some(true));

        let mut kid = claims();
        kid["groups"] = serde_json::json!(["kids"]);
        kid["email_verified"] = serde_json::json!(false);
        let identity = oidc
            .check_id_token(&discovery(), &login(), &token(kid))
            .unwrap();
        assert_eq!(identity.email, None);
        assert_eq!(oidc.admin_flag(&identity), Some(false));
    }

    #[test]
    fn rejects_bad_claims() {
        let oidc = Oidc::new(config());
        let cases = [
            ("iss", serde_json::json!("https://evil.example.org")),
            ("aud", serde_json::json!(["other"])),
            ("exp", serde_json::json!(1)),
            ("nonce", serde_json::json!("n2")),
            ("groups", serde_json::json!(["admins"])),
        ];
        for (key, value) in cases {
            let mut claims = claims();
            claims[key] = value;
            assert!(
                oidc.check_id_token(&discovery(), &login(), &token(claims))
                    .is_err(),
                "{key} should be rejected"
            );
        }
        assert!(oidc
            .check_id_token(&discovery(), &login(), "not-a-jwt")
            .is_err());
    }

    #[test]
    fn pending_logins_are_single_use_and_browser_bound() {
        let oidc = Oidc::new(config());
        *oidc.discovery.lock().unwrap() = Some(discovery());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let url = runtime
            .block_on(oidc.start("binding", "ferrotune://oidc/callback", None, None))
            .unwrap();
        assert!(url.starts_with("https://id.example.org/authorize?response_type=code&"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains(
            "redirect_uri=https%3A%2F%2Fmusic.example.org%2Fapi%2Fauth%2Foidc%2Fcallback"
        ));
        let state = url
            .split('&')
            .find_map(|pair| pair.strip_prefix("state="))
            .unwrap()
            .to_string();
        let login = oidc.pending.lock().unwrap().get(&state).cloned().unwrap();
        assert!(url.contains(&format!(
            "code_challenge={}",
            pkce_challenge(&login.verifier)
        )));

        // Another browser's callback is refused and burns the state.
        assert!(oidc.take_pending(&state, Some("other")).is_none());
        assert!(oidc.take_pending(&state, Some("binding")).is_none());

        let url = runtime
            .block_on(oidc.start("binding", "ferrotune://oidc/callback", None, None))
            .unwrap();
        let state = url
            .split('&')
            .find_map(|pair| pair.strip_prefix("state="))
            .unwrap()
            .to_string();
        assert!(oidc.take_pending(&state, None).is_none());
        let url = runtime
            .block_on(oidc.start("binding", "ferrotune://oidc/callback", None, None))
            .unwrap();
        let state = url
            .split('&')
            .find_map(|pair| pair.strip_prefix("state="))
            .unwrap()
            .to_string();
        let login = oidc.take_pending(&state, Some("binding")).unwrap();
        assert_eq!(login.client_redirect, "ferrotune://oidc/callback");
        assert!(oidc.take_pending(&state, Some("binding")).is_none());
    }

    #[test]
    fn codes_are_single_use_and_check_the_client_verifier() {
        let oidc = Oidc::new(config());
        let code = oidc.issue_code(7, None);
        assert_eq!(oidc.redeem_code(&code, None).unwrap(), 7);
        assert!(oidc.redeem_code(&code, None).is_err());

        let verifier = random_token();
        let challenge = pkce_challenge(&verifier);
        assert!(is_valid_challenge(&challenge));
        let code = oidc.issue_code(8, Some(challenge.clone()));
        assert!(oidc.redeem_code(&code, Some("wrong")).is_err());
        // A failed attempt burns the code.
        assert!(oidc.redeem_code(&code, Some(&verifier)).is_err());

        let code = oidc.issue_code(8, Some(challenge));
        assert!(oidc.redeem_code(&code, None).is_err());
        let code = oidc.issue_code(8, Some(pkce_challenge(&verifier)));
        assert_eq!(oidc.redeem_code(&code, Some(&verifier)).unwrap(), 8);
    }

    #[test]
    fn query_is_appended() {
        assert_eq!(
            with_query("ferrotune://oidc/callback", &[("code", "a b")]),
            "ferrotune://oidc/callback?code=a+b"
        );
        assert_eq!(
            with_query("http://x/cb?y=1", &[("error", "no")]),
            "http://x/cb?y=1&error=no"
        );
    }
}
