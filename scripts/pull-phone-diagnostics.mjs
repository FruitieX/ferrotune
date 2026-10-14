#!/usr/bin/env node
// Pulls the Android app's diagnostics through the Ferrotune server, without
// adb: the server asks the app over its session stream, or wakes it with a
// push message when it is idle, and the app uploads its gzipped logs plus a
// device-state snapshot (battery, Doze, standby bucket, recent process exits).
//
// Usage:
//   node scripts/pull-phone-diagnostics.mjs [--max-bytes N] [--wait SECONDS]
//       [--client-id ID] [--request-id ID] [--out DIR]
//
// --max-bytes  upload only the newest N bytes of logs (default: all, ≤ 12 MiB)
// --wait       seconds the server waits for the upload (default 45, max 120)
// --request-id fetch the upload of an earlier pull that answered "pending"
//              (kept on the server for an hour)
//
// Environment: FERROTUNE_URL (default https://ferrotune.fruitiex.org),
// FERROTUNE_USERNAME and FERROTUNE_PASSWORD (HTTP Basic auth).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    "client-id": { type: "string" },
    "max-bytes": { type: "string" },
    wait: { type: "string" },
    "request-id": { type: "string" },
    out: { type: "string", default: "test-results/android-diagnostics" },
  },
});

const baseUrl = (
  process.env.FERROTUNE_URL ?? "https://ferrotune.fruitiex.org"
).replace(/\/$/, "");
const { FERROTUNE_USERNAME: username, FERROTUNE_PASSWORD: password } =
  process.env;
if (!username || !password) {
  console.error("Set FERROTUNE_USERNAME and FERROTUNE_PASSWORD.");
  process.exit(2);
}
const headers = {
  Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, { headers, ...init });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${text}`);
  }
  return { status: response.status, body: JSON.parse(text) };
}

const session = (await api("/sessions")).body;
const result = args["request-id"]
  ? await api(`/sessions/${session.id}/diagnostics/${args["request-id"]}`)
  : await api(`/sessions/${session.id}/diagnostics`, {
      method: "POST",
      body: JSON.stringify({
        clientId: args["client-id"],
        maxBytes: args["max-bytes"] ? Number(args["max-bytes"]) : undefined,
        waitSecs: args.wait ? Number(args.wait) : undefined,
      }),
    });

const { requestId, status, deliveredVia, bundle } = result.body;
if (status !== "complete") {
  console.log(
    `The app hasn't uploaded yet (request ${requestId}, sent via ${deliveredVia?.join(" and ") || "?"}).`,
  );
  console.log(
    `Fetch it later: node scripts/pull-phone-diagnostics.mjs --request-id ${requestId}`,
  );
  process.exit(3);
}

const stamp = bundle.collectedAt.replace(/[-:]/g, "").replace(/\.\d+/, "");
const outDir = join(args.out, `${stamp}-remote`);
mkdirSync(outDir, { recursive: true });
for (const file of bundle.files) {
  writeFileSync(join(outDir, file.name), file.content);
}
writeFileSync(
  join(outDir, "pull.json"),
  JSON.stringify(
    {
      requestId,
      clientId: bundle.clientId,
      collectedAt: bundle.collectedAt,
      deliveredVia,
      files: bundle.files.map(({ name, bytes, content }) => ({
        name,
        bytes,
        uploadedBytes: Buffer.byteLength(content),
      })),
    },
    null,
    2,
  ),
);
console.log(
  `Wrote ${bundle.files.length} files from ${bundle.clientId} to ${outDir} (via ${deliveredVia?.join(" and ") || "earlier pull"}).`,
);
