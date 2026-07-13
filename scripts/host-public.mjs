#!/usr/bin/env node
/**
 * One-click host mode for remote Windows guests (no guest setup).
 *
 * Prerequisites on this machine (Mac):
 *   - npm run gateway   (Whisper + Ollama) already running on :8787
 *   - cloudflared installed (brew install cloudflared)
 *   - UI on Vercel: https://fonglish.vercel.app
 *
 * This script:
 *   1. Checks gateway health
 *   2. Opens a free Cloudflare quick tunnel → public HTTPS/WSS
 *   3. Prints the one-click invite base URL for guests
 *
 * Guests open the printed https://fonglish.vercel.app/room/…?gw=wss://… link.
 * Your Mac must stay online while the session runs.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY_HTTP = process.env.GATEWAY_HTTP ?? "http://127.0.0.1:8787";
const PUBLIC_UI =
  process.env.NEXT_PUBLIC_SHARE_ORIGIN?.replace(/\/$/, "") ||
  "https://fonglish.vercel.app";
const OUT = path.join(ROOT, ".gateway-public.json");

async function checkGateway() {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return j;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n✗ Gateway not reachable at ${GATEWAY_HTTP} (${msg})`);
    console.error("  In another terminal run:  npm run gateway\n");
    process.exit(1);
  }
}

function whichCloudflared() {
  return new Promise((resolve) => {
    const p = spawn("which", ["cloudflared"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.on("close", (code) => resolve(code === 0 ? out.trim() : ""));
  });
}

function toWss(httpsUrl) {
  return httpsUrl.replace(/^https:/i, "wss:").replace(/\/$/, "");
}

console.log("Fonglish public host (Windows one-click)\n");

const health = await checkGateway();
console.log("✓ Gateway OK", {
  ollama: health.ollama,
  stt: health.stt,
  lan: health.lanIps,
});

const bin = (await whichCloudflared()) || "cloudflared";
if (!bin) {
  console.error("✗ cloudflared not found. Install:  brew install cloudflared\n");
  process.exit(1);
}

console.log(`\nStarting Cloudflare quick tunnel → ${GATEWAY_HTTP}`);
console.log("(Leave this running. Ctrl+C stops the public link.)\n");

const child = spawn(
  bin,
  ["tunnel", "--url", GATEWAY_HTTP, "--no-autoupdate"],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let publicHttps = null;
const urlRe = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i;

function onLine(line) {
  process.stderr.write(line.includes("http") ? `${line}\n` : "");
  const m = line.match(urlRe);
  if (m && !publicHttps) {
    publicHttps = m[1].replace(/\/$/, "");
    const wss = toWss(publicHttps);
    const payload = {
      https: publicHttps,
      wss,
      publicUi: PUBLIC_UI,
      exampleInvite: `${PUBLIC_UI}/room/demo-room?gw=${encodeURIComponent(wss)}&name=Guest`,
      startedAt: new Date().toISOString(),
    };
    writeFileSync(OUT, JSON.stringify(payload, null, 2));

    console.log("────────────────────────────────────────────");
    console.log("✓ Public gateway ready (free Cloudflare tunnel)");
    console.log("");
    console.log("  WSS for browsers:");
    console.log(`    ${wss}`);
    console.log("");
    console.log("  On this Mac (host): open the local UI, create a room,");
    console.log("  set Caption gateway to the WSS above (or paste once),");
    console.log("  then Share access link — guests get a one-click URL.");
    console.log("");
    console.log("  Example guest link shape:");
    console.log(`    ${PUBLIC_UI}/room/<ROOM_ID>?gw=${wss}`);
    console.log("");
    console.log("  Windows: click that link only — no Node, no flag, no install.");
    console.log(`  Saved: ${OUT}`);
    console.log("────────────────────────────────────────────\n");
  }
}

let buf = "";
const feed = (chunk) => {
  buf += chunk.toString();
  const parts = buf.split(/\r?\n/);
  buf = parts.pop() ?? "";
  for (const line of parts) onLine(line);
};

child.stdout.on("data", feed);
child.stderr.on("data", feed);

child.on("exit", (code) => {
  console.log(`\nTunnel exited (code ${code ?? "?"}). Public link is dead until you re-run.`);
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});
process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});
