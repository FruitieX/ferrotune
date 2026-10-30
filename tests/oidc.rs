//! OIDC (Pocket ID) sign-in against a mock provider: linking, auto-created
//! accounts, group checks, the browser binding and single-use codes.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{Form, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use common::{TestServer, TestServerConfig};
use reqwest::blocking::Client;
use serde_json::{json, Value};

const PUBLIC_URL: &str = "http://ferrotune.test";
const ANDROID_REDIRECT: &str = "ferrotune://oidc/callback";

/// Who the mock provider signs in next.
#[derive(Clone, Default)]
struct MockUser {
    sub: String,
    username: String,
    groups: Vec<String>,
}

#[derive(Default)]
struct MockState {
    issuer: String,
    next_user: MockUser,
    /// code -> (user, nonce, challenge, redirect_uri)
    codes: HashMap<String, (MockUser, String, String, String)>,
}

type Shared = Arc<Mutex<MockState>>;

async fn discovery(State(state): State<Shared>) -> Json<Value> {
    let issuer = state.lock().unwrap().issuer.clone();
    Json(json!({
        "issuer": issuer,
        "authorization_endpoint": format!("{issuer}/authorize"),
        "token_endpoint": format!("{issuer}/token"),
    }))
}

async fn authorize(
    State(state): State<Shared>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    assert_eq!(params["client_id"], "ferrotune");
    assert_eq!(params["code_challenge_method"], "S256");
    let code = format!("code-{}", rand_suffix());
    let mut state = state.lock().unwrap();
    let user = state.next_user.clone();
    state.codes.insert(
        code.clone(),
        (
            user,
            params["nonce"].clone(),
            params["code_challenge"].clone(),
            params["redirect_uri"].clone(),
        ),
    );
    let location = format!(
        "{}?code={code}&state={}",
        params["redirect_uri"], params["state"]
    );
    Redirect::to(&location).into_response()
}

async fn token(State(state): State<Shared>, Form(form): Form<HashMap<String, String>>) -> Response {
    let mut state = state.lock().unwrap();
    let Some((user, nonce, challenge, redirect_uri)) = state.codes.remove(&form["code"]) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let verifier_hash = URL_SAFE_NO_PAD.encode(ring::digest::digest(
        &ring::digest::SHA256,
        form["code_verifier"].as_bytes(),
    ));
    if form["client_secret"] != "secret"
        || verifier_hash != challenge
        || form["redirect_uri"] != redirect_uri
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 300;
    let claims = json!({
        "iss": state.issuer, "sub": user.sub, "aud": "ferrotune", "exp": exp,
        "nonce": nonce, "preferred_username": user.username, "groups": user.groups,
    });
    let id_token = format!(
        "e30.{}.sig",
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
    );
    Json(json!({"id_token": id_token, "access_token": "x", "token_type": "Bearer"})).into_response()
}

fn rand_suffix() -> String {
    use rand::TryRng;
    let mut bytes = [0u8; 8];
    rand::rngs::SysRng
        .try_fill_bytes(&mut bytes)
        .expect("OS random number generator failed");
    hex::encode(bytes)
}

/// Starts the mock provider on its own runtime thread.
fn start_provider() -> Shared {
    let state: Shared = Arc::default();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    state.lock().unwrap().issuer = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/.well-known/openid-configuration", get(discovery))
        .route("/authorize", get(authorize))
        .route("/token", post(token))
        .with_state(state.clone());
    std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async move {
                let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                axum::serve(listener, app).await.unwrap();
            });
    });
    state
}

struct Harness {
    server: TestServer,
    provider: Shared,
    http: Client,
}

impl Harness {
    fn new() -> Self {
        let provider = start_provider();
        let issuer = provider.lock().unwrap().issuer.clone();
        let server = TestServer::with_config(TestServerConfig {
            admin_user: Some("admin".to_string()),
            env: vec![
                ("FERROTUNE_OIDC_ISSUER".into(), issuer),
                ("FERROTUNE_OIDC_CLIENT_ID".into(), "ferrotune".into()),
                ("FERROTUNE_OIDC_CLIENT_SECRET".into(), "secret".into()),
                ("FERROTUNE_PUBLIC_URL".into(), PUBLIC_URL.into()),
                ("FERROTUNE_OIDC_ALLOWED_GROUPS".into(), "family,kids".into()),
                ("FERROTUNE_OIDC_ADMIN_GROUP".into(), "admins".into()),
                ("FERROTUNE_OIDC_USER_MAP".into(), "rasse:admin".into()),
            ],
            ..Default::default()
        })
        .expect("server should start");
        let http = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        Self {
            server,
            provider,
            http,
        }
    }

    fn sign_in_as(&self, sub: &str, username: &str, groups: &[&str]) {
        self.provider.lock().unwrap().next_user = MockUser {
            sub: sub.into(),
            username: username.into(),
            groups: groups.iter().map(|g| g.to_string()).collect(),
        };
    }

    fn location(response: &reqwest::blocking::Response) -> String {
        assert_eq!(
            response.status(),
            StatusCode::SEE_OTHER.as_u16(),
            "expected a redirect"
        );
        response.headers()[header::LOCATION.as_str()]
            .to_str()
            .unwrap()
            .to_string()
    }

    /// Runs start → provider → callback like a browser would and returns the
    /// final redirect to the client.
    fn browser_flow(
        &self,
        challenge: Option<&str>,
        send_cookie: bool,
    ) -> reqwest::blocking::Response {
        let mut start = format!(
            "{}?redirect={}",
            self.server.api_url("auth/oidc/start"),
            urlencoding::encode(ANDROID_REDIRECT)
        );
        if let Some(challenge) = challenge {
            start.push_str(&format!("&challenge={challenge}"));
        }
        let response = self.http.get(&start).send().unwrap();
        let cookie = response.headers()[header::SET_COOKIE.as_str()]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        assert!(cookie.starts_with("ferrotune_oidc="));
        let authorize = Self::location(&response);
        let response = self.http.get(&authorize).send().unwrap();
        let callback = response.headers()[header::LOCATION.as_str()]
            .to_str()
            .unwrap()
            .replace(PUBLIC_URL, &self.server.base_url);
        let mut request = self.http.get(&callback);
        if send_cookie {
            request = request.header(header::COOKIE.as_str(), cookie);
        }
        request.send().unwrap()
    }

    fn client_params(location: &str) -> HashMap<String, String> {
        let query = location
            .strip_prefix(&format!("{ANDROID_REDIRECT}?"))
            .unwrap_or_else(|| panic!("unexpected client redirect {location}"));
        serde_urlencoded::from_str(query).unwrap()
    }

    fn exchange(&self, code: &str, verifier: Option<&str>) -> reqwest::blocking::Response {
        self.http
            .post(self.server.api_url("auth/oidc/exchange"))
            .json(&json!({"code": code, "codeVerifier": verifier, "clientName": "test"}))
            .send()
            .unwrap()
    }

    fn me(&self, session_token: &str) -> Value {
        self.http
            .get(self.server.api_url("auth/me"))
            .bearer_auth(session_token)
            .send()
            .unwrap()
            .json()
            .unwrap()
    }
}

fn pkce() -> (String, String) {
    let verifier = format!("verifier-{}-{}", rand_suffix(), rand_suffix());
    let challenge = URL_SAFE_NO_PAD.encode(ring::digest::digest(
        &ring::digest::SHA256,
        verifier.as_bytes(),
    ));
    (verifier, challenge)
}

#[test]
fn oidc_sign_in_links_creates_and_refuses() {
    let h = Harness::new();

    let config: Value = h
        .http
        .get(h.server.api_url("auth/oidc/config"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(config, json!({"enabled": true}));

    // Redirects off the allowlist are refused before reaching the provider.
    let refused = h
        .http
        .get(format!(
            "{}?redirect={}",
            h.server.api_url("auth/oidc/start"),
            urlencoding::encode("https://evil.example.org/login/callback")
        ))
        .send()
        .unwrap();
    assert_eq!(refused.status(), 400);

    // The owner links to the existing local "admin" account via the user map.
    h.sign_in_as("sub-rasse", "rasse", &["admins", "family"]);
    let (verifier, challenge) = pkce();
    let response = h.browser_flow(Some(&challenge), true);
    let params = Harness::client_params(&Harness::location(&response));
    let code = &params["code"];
    // Without the client's verifier the code is refused (and burnt).
    assert_eq!(h.exchange(code, None).status(), 401);
    let response = h.browser_flow(Some(&challenge), true);
    let code = Harness::client_params(&Harness::location(&response))["code"].clone();
    let login: Value = h.exchange(&code, Some(&verifier)).json().unwrap();
    assert_eq!(login["user"]["username"], "admin");
    assert_eq!(login["user"]["isAdmin"], true);
    let me = h.me(login["sessionToken"].as_str().unwrap());
    assert_eq!(me["user"]["username"], "admin");
    // Codes are single use.
    assert_eq!(h.exchange(&code, Some(&verifier)).status(), 401);

    // A kid without a local account gets one, without admin rights or a password.
    h.sign_in_as("sub-kid", "Kiddo", &["kids"]);
    let response = h.browser_flow(None, true);
    let code = Harness::client_params(&Harness::location(&response))["code"].clone();
    let login: Value = h.exchange(&code, None).json().unwrap();
    assert_eq!(login["user"]["username"], "Kiddo");
    assert_eq!(login["user"]["isAdmin"], false);
    let password_login = h
        .http
        .post(h.server.api_url("auth/login"))
        .json(&json!({"username": "Kiddo", "password": "!oidc"}))
        .send()
        .unwrap();
    assert_eq!(password_login.status(), 401);
    // The new account can see the library.
    let folders: Value = h
        .http
        .get(h.server.api_url("users/me"))
        .bearer_auth(login["sessionToken"].as_str().unwrap())
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(folders["libraryAccess"].as_array().map(Vec::len), Some(1));

    // Signing in again finds the same account by subject, even after a rename
    // at the provider.
    h.sign_in_as("sub-kid", "kiddo-renamed", &["kids"]);
    let response = h.browser_flow(None, true);
    let code = Harness::client_params(&Harness::location(&response))["code"].clone();
    let login: Value = h.exchange(&code, None).json().unwrap();
    assert_eq!(login["user"]["username"], "Kiddo");

    // Another provider account can't take over an already linked user.
    h.sign_in_as("sub-impostor", "kiddo", &["kids"]);
    let response = h.browser_flow(None, true);
    let params = Harness::client_params(&Harness::location(&response));
    assert!(params["error"].contains("already linked"), "{params:?}");

    // Someone outside the allowed groups is refused and no account is made.
    h.sign_in_as("sub-guest", "guest", &["guests"]);
    let response = h.browser_flow(None, true);
    let params = Harness::client_params(&Harness::location(&response));
    assert!(params.contains_key("error") && !params.contains_key("code"));
    let users: Value = h
        .http
        .get(h.server.api_url("users"))
        .basic_auth(&h.server.admin_user, Some(&h.server.admin_password))
        .send()
        .unwrap()
        .json()
        .unwrap();
    let names: Vec<&str> = users["users"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["username"].as_str().unwrap())
        .collect();
    assert!(!names.contains(&"guest"), "{names:?}");

    // A callback without the browser binding cookie is refused outright.
    h.sign_in_as("sub-rasse", "rasse", &["admins", "family"]);
    let response = h.browser_flow(None, false);
    assert_eq!(response.status(), 400);

    // Leaving the admins group removes admin rights at the next sign-in.
    h.sign_in_as("sub-rasse", "rasse", &["family"]);
    let response = h.browser_flow(None, true);
    let code = Harness::client_params(&Harness::location(&response))["code"].clone();
    let login: Value = h.exchange(&code, None).json().unwrap();
    assert_eq!(login["user"]["isAdmin"], false);
}

#[test]
fn oidc_start_forwards_only_allowlisted_prompts() {
    let h = Harness::new();
    let authorize_prompt = |prompt: Option<&str>| -> Option<String> {
        let mut start = format!(
            "{}?redirect={}",
            h.server.api_url("auth/oidc/start"),
            urlencoding::encode(ANDROID_REDIRECT)
        );
        if let Some(prompt) = prompt {
            start.push_str(&format!("&prompt={}", urlencoding::encode(prompt)));
        }
        let response = h.http.get(&start).send().unwrap();
        let authorize = Harness::location(&response);
        let (endpoint, query) = authorize.split_once('?').unwrap();
        assert!(endpoint.ends_with("/authorize"), "{authorize}");
        let params: HashMap<String, String> = serde_urlencoded::from_str(query).unwrap();
        params.get("prompt").cloned()
    };

    // A plain sign-in stays silent: the provider may reuse its session.
    assert_eq!(authorize_prompt(None), None);
    // Adding an account asks the provider to let the person pick the account.
    assert_eq!(
        authorize_prompt(Some("select_account")).as_deref(),
        Some("select_account")
    );
    assert_eq!(authorize_prompt(Some("login")).as_deref(), Some("login"));
    // Anything else is dropped instead of forwarded.
    for prompt in ["none", "consent", "login consent", "", "LOGIN"] {
        assert_eq!(authorize_prompt(Some(prompt)), None, "prompt={prompt:?}");
    }
}

#[test]
fn oidc_is_off_without_configuration() {
    let server = TestServer::new().expect("server should start");
    let http = Client::new();
    let config: Value = http
        .get(server.api_url("auth/oidc/config"))
        .send()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(config, json!({"enabled": false}));
    let start = http
        .get(format!(
            "{}?redirect={}",
            server.api_url("auth/oidc/start"),
            urlencoding::encode(ANDROID_REDIRECT)
        ))
        .send()
        .unwrap();
    assert_eq!(start.status(), 404);
}
