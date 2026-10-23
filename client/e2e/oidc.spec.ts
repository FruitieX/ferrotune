/**
 * "Sign in with passkey": OIDC sign-in through a mock provider.
 */

import * as http from "http";
import type { AddressInfo } from "net";
import { createHash, randomBytes } from "crypto";
import { test, expect } from "@playwright/test";
import { cleanupServer, spawnServerWithEnv, type ServerInfo } from "./fixtures";
import { waitForAuthenticatedHome } from "./app-helpers";

type MockUser = { sub: string; username: string; groups: string[] };

const b64url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

/** Minimal OIDC provider: signs in `next` without asking anything. */
function startProvider() {
  const state: {
    issuer: string;
    next: MockUser;
    /** The `prompt` of each authorize request, in order (null when absent). */
    prompts: (string | null)[];
    codes: Map<string, { user: MockUser; nonce: string; challenge: string }>;
  } = {
    issuer: "",
    next: { sub: "sub-owner", username: "owner", groups: ["family"] },
    prompts: [],
    codes: new Map(),
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", state.issuer);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return json({
        issuer: state.issuer,
        authorization_endpoint: `${state.issuer}/authorize`,
        token_endpoint: `${state.issuer}/token`,
      });
    }
    if (url.pathname === "/authorize") {
      state.prompts.push(url.searchParams.get("prompt"));
      const code = randomBytes(16).toString("hex");
      state.codes.set(code, {
        user: state.next,
        nonce: url.searchParams.get("nonce") ?? "",
        challenge: url.searchParams.get("code_challenge") ?? "",
      });
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const issued = state.codes.get(form.get("code") ?? "");
        state.codes.delete(form.get("code") ?? "");
        const verifierHash = createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          !issued ||
          issued.challenge !== verifierHash ||
          form.get("client_secret") !== "idp-secret"
        ) {
          return json({ error: "invalid_grant" }, 400);
        }
        const claims = {
          iss: state.issuer,
          aud: "ferrotune",
          exp: Math.floor(Date.now() / 1000) + 300,
          nonce: issued.nonce,
          sub: issued.user.sub,
          preferred_username: issued.user.username,
          groups: issued.user.groups,
        };
        json({
          id_token: `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(claims))}.`,
          access_token: "a",
          token_type: "Bearer",
        });
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise<{ state: typeof state; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      state.issuer = `http://127.0.0.1:${port}`;
      resolve({ state, close: () => server.close() });
    });
  });
}

test.describe("passkey sign-in (OIDC)", () => {
  let provider: Awaited<ReturnType<typeof startProvider>>;
  let server: ServerInfo;

  test.beforeAll(async () => {
    provider = await startProvider();
    server = await spawnServerWithEnv(`oidc-${process.pid}`, (port) => ({
      FERROTUNE_OIDC_ISSUER: provider.state.issuer,
      FERROTUNE_OIDC_CLIENT_ID: "ferrotune",
      FERROTUNE_OIDC_CLIENT_SECRET: "idp-secret",
      FERROTUNE_PUBLIC_URL: `http://127.0.0.1:${port}`,
      FERROTUNE_OIDC_ALLOWED_GROUPS: "family,kids",
      FERROTUNE_OIDC_ADMIN_GROUP: "admins",
      // The provider's "owner" is the seeded test admin here.
      FERROTUNE_OIDC_USER_MAP: "owner:testadmin",
      // The web client runs on the Vite preview origin in tests.
      FERROTUNE_OIDC_REDIRECT_URIS: "http://localhost:13000/login/callback",
    }));
  });

  test.afterAll(async () => {
    await cleanupServer(server);
    provider.close();
  });

  async function openLogin(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByRole("button", { name: /advanced settings/i }).click();
    const serverUrl = page.locator("#server-url");
    await serverUrl.fill(server.url);
    await serverUrl.blur();
  }

  test("leads with the passkey button and signs in through the provider", async ({
    page,
  }) => {
    provider.state.next = {
      sub: "sub-owner",
      username: "owner",
      groups: ["admins", "family"],
    };
    await openLogin(page);

    const passkey = page.getByRole("button", { name: "Sign in with passkey" });
    await expect(passkey).toBeVisible();
    // Password sign-in is folded away behind a quieter link.
    await expect(page.locator("#password")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Sign in with a password instead" })
      .click();
    await expect(page.locator("#password")).toBeVisible();

    provider.state.prompts = [];
    await passkey.click();
    await waitForAuthenticatedHome(page);
    // A first account signs in silently through the provider's session.
    expect(provider.state.prompts).toEqual([null]);

    const connection = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ferrotune-connection") ?? "null"),
    );
    expect(connection.username).toBe("testadmin");
    expect(connection.isAdmin).toBe(true);
    expect(connection.serverUrl).toBe(server.url);
    expect(connection.sessionToken).toBeTruthy();
    // The code never outlives the callback page.
    expect(page.url()).not.toContain("code=");
  });

  test("creates an account for a family member on first sign-in", async ({
    page,
  }) => {
    provider.state.next = {
      sub: "sub-kid",
      username: "kiddo",
      groups: ["kids"],
    };
    await openLogin(page);
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await waitForAuthenticatedHome(page);

    const connection = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ferrotune-connection") ?? "null"),
    );
    expect(connection.username).toBe("kiddo");
    expect(connection.isAdmin).toBe(false);
  });

  test("adding an account lets the provider offer another account", async ({
    page,
  }) => {
    provider.state.next = {
      sub: "sub-owner",
      username: "owner",
      groups: ["admins", "family"],
    };
    await openLogin(page);
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await waitForAuthenticatedHome(page);

    // "Add Account" opens the login page with the owner already saved. The
    // provider still has the owner's session, so without a prompt it would
    // sign the owner in again and the kid could never be added.
    provider.state.prompts = [];
    provider.state.next = {
      sub: "sub-kid",
      username: "kiddo",
      groups: ["kids"],
    };
    await openLogin(page);
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await waitForAuthenticatedHome(page);
    expect(provider.state.prompts).toEqual(["select_account"]);

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ferrotune-saved-accounts") ?? "[]"),
    );
    expect(
      saved.map((account: { username: string }) => account.username),
    ).toEqual(["kiddo", "testadmin"]);
    const connection = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ferrotune-connection") ?? "null"),
    );
    expect(connection.username).toBe("kiddo");
  });

  test("refuses someone outside the allowed groups", async ({ page }) => {
    provider.state.next = {
      sub: "sub-guest",
      username: "guest",
      groups: ["guests"],
    };
    await openLogin(page);
    await page.getByRole("button", { name: "Sign in with passkey" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/not in a group allowed/i)).toBeVisible();
  });
});
