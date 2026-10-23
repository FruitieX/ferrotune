/**
 * "Sign in with passkey" through the server's OIDC provider (Pocket ID).
 *
 * The browser leaves for `<server>/api/auth/oidc/start`, signs in at the
 * provider and comes back to `/login/callback?code=…`; the code is redeemed
 * for a normal session with `POST /api/auth/oidc/exchange`. The code is bound
 * to a PKCE verifier kept in sessionStorage, so a leaked callback URL is
 * useless to anyone else.
 */
import type { AuthLoginResponse, ServerConnection } from "@/lib/api/types";

const PENDING_KEY = "ferrotune-oidc-pending";
export const OIDC_CALLBACK_PATH = "/login/callback";

interface PendingOidcLogin {
  serverUrl: string;
  verifier: string | null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function pkcePair(): Promise<{
  verifier: string;
  challenge: string;
} | null> {
  // crypto.subtle only exists in secure contexts (https, localhost).
  if (!globalThis.crypto?.subtle) {
    return null;
  }
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** Leaves for the provider; the page unloads on success. */
export async function startOidcLogin(serverUrl: string): Promise<void> {
  const pkce = await pkcePair();
  const pending: PendingOidcLogin = {
    serverUrl,
    verifier: pkce?.verifier ?? null,
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const params = new URLSearchParams({
    redirect: `${window.location.origin}${OIDC_CALLBACK_PATH}`,
  });
  if (pkce) {
    params.set("challenge", pkce.challenge);
  }
  window.location.assign(`${serverUrl}/api/auth/oidc/start?${params}`);
}

/** Reads (and forgets) the sign-in this tab started. */
export function takePendingOidcLogin(): PendingOidcLogin | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  if (!raw) {
    return null;
  }
  try {
    const pending = JSON.parse(raw) as PendingOidcLogin;
    return typeof pending.serverUrl === "string" ? pending : null;
  } catch {
    return null;
  }
}

export function connectionFromLogin(
  serverUrl: string,
  response: AuthLoginResponse,
): ServerConnection {
  return {
    serverUrl,
    username: response.user.username,
    userId: response.user.id,
    email: response.user.email,
    isAdmin: response.user.isAdmin,
    sessionToken: response.sessionToken,
    sessionExpiresAt: response.sessionExpiresAt,
    urlToken: response.urlToken,
    urlTokenExpiresAt: response.urlTokenExpiresAt,
  };
}
