/** localStorage key for optional gateway override. */
export const GATEWAY_URL_KEY = "fong_gateway_url";
/** LAN hostname/IP used when building LAN invite links. */
export const SHARE_HOST_KEY = "fong_share_host";

/** Production UI origin for one-click Windows invites. */
export const DEFAULT_PUBLIC_UI =
  process.env.NEXT_PUBLIC_SHARE_ORIGIN?.replace(/\/$/, "") ||
  "https://fonglish.vercel.app";

/**
 * Resolve caption gateway WebSocket URL.
 *
 * Priority:
 * 1. localStorage (includes ?gw= from invite links)
 * 2. NEXT_PUBLIC_GATEWAY_URL
 * 3. Same host as the page / loopback defaults
 */
export function resolveGatewayUrl(): string {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(GATEWAY_URL_KEY)?.trim();
    if (saved) return normalizeWsUrl(saved);
  }

  if (process.env.NEXT_PUBLIC_GATEWAY_URL) {
    return normalizeWsUrl(process.env.NEXT_PUBLIC_GATEWAY_URL);
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (
      host.endsWith(".vercel.app") ||
      host === "localhost" ||
      host === "[::1]" ||
      host === "::1" ||
      host === "127.0.0.1"
    ) {
      const port = process.env.NEXT_PUBLIC_GATEWAY_PORT ?? "8787";
      return `ws://127.0.0.1:${port}`;
    }
    const port = process.env.NEXT_PUBLIC_GATEWAY_PORT ?? "8787";
    return `ws://${host}:${port}`;
  }

  return "ws://127.0.0.1:8787";
}

export function normalizeWsUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return "ws://127.0.0.1:8787";
  if (u.startsWith("https://")) u = `wss://${u.slice("https://".length)}`;
  if (u.startsWith("http://")) u = `ws://${u.slice("http://".length)}`;
  if (!u.startsWith("ws://") && !u.startsWith("wss://")) {
    u = `ws://${u}`;
  }
  // Only rewrite pure localhost — keep public tunnel hostnames
  u = u
    .replace("://localhost/", "://127.0.0.1/")
    .replace("://localhost:", "://127.0.0.1:")
    .replace(/:\/\/localhost$/, "://127.0.0.1")
    .replace("://[::1]", "://127.0.0.1");
  return u.replace(/\/$/, "");
}

/** Apply ?gw= from invite URL (one-click Windows path). */
export function applyGatewayFromSearch(
  search: URLSearchParams | { get(name: string): string | null },
): string | null {
  const raw = search.get("gw")?.trim();
  if (!raw) return null;
  const url = normalizeWsUrl(raw);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(GATEWAY_URL_KEY, url);
  }
  return url;
}

export function loadGatewayUrlSetting(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_GATEWAY_URL ?? "ws://127.0.0.1:8787";
  }
  return (
    window.localStorage.getItem(GATEWAY_URL_KEY)?.trim() ||
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    "ws://127.0.0.1:8787"
  );
}

export function saveGatewayUrlSetting(url: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GATEWAY_URL_KEY, normalizeWsUrl(url));
}

export function loadShareHost(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SHARE_HOST_KEY)?.trim() ?? "";
}

export function saveShareHost(host: string): void {
  if (typeof window === "undefined") return;
  const h = host.trim().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  if (h) window.localStorage.setItem(SHARE_HOST_KEY, h);
  else window.localStorage.removeItem(SHARE_HOST_KEY);
}

export function isPublicGatewayUrl(url: string): boolean {
  const u = normalizeWsUrl(url);
  if (u.startsWith("wss://")) return true;
  // public ws is rare; treat non-loopback as public
  return !isLoopbackGatewayUrl(u);
}

export function formatWsError(url: string): string {
  if (typeof window === "undefined") {
    return `WebSocket error — is the gateway running? Tried ${url}`;
  }
  const host = window.location.hostname;
  const protocol = window.location.protocol;
  const isHosted = host.endsWith(".vercel.app");
  const loopback = isLoopbackGatewayUrl(url);

  if (isHosted && loopback) {
    return (
      `This Vercel page needs a public gateway (wss://…). ` +
      `On the Mac host run: npm run host:public  then share the printed one-click link. Tried ${url}`
    );
  }
  if (protocol === "https:" && url.startsWith("ws://")) {
    return (
      `HTTPS pages require a secure WebSocket (wss://), not ${url}. ` +
      `Use npm run host:public on the Mac and open the one-click invite.`
    );
  }
  if (loopback) {
    return (
      `Gateway is loopback-only (${url}). Remote PCs cannot reach 127.0.0.1. ` +
      `Run npm run host:public on the host Mac.`
    );
  }
  return (
    `Cannot reach the caption gateway at ${url}. ` +
    `Is the host Mac online with npm run gateway + tunnel?`
  );
}

export function isHostedUi(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith(".vercel.app");
}

export function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

export function isLoopbackGatewayUrl(url: string): boolean {
  return /:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(url);
}

export function localWebBaseUrl(): string {
  const port = process.env.NEXT_PUBLIC_WEB_PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export function isPrivateLanIp(ip: string): boolean {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

export function discoverLanIp(timeoutMs = 2000): Promise<string | null> {
  if (typeof window === "undefined" || typeof RTCPeerConnection === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const ips = new Set<string>();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve([...ips].filter(isPrivateLanIp)[0] ?? null);
    };

    const pc = new RTCPeerConnection({ iceServers: [] });
    const timer = window.setTimeout(finish, timeoutMs);
    pc.createDataChannel("lan");
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) {
        window.clearTimeout(timer);
        finish();
        return;
      }
      const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(ev.candidate.candidate);
      if (m?.[1] && m[1] !== "0.0.0.0") ips.add(m[1]);
    };
    void pc
      .createOffer()
      .then((o) => pc.setLocalDescription(o))
      .catch(() => {
        window.clearTimeout(timer);
        finish();
      });
  });
}

export async function isLocalWebReachable(timeoutMs = 800): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const base = localWebBaseUrl();
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(base, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(t);
  }
}

export async function redirectHostedToLocalWeb(
  pathWithQuery: string,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!isHostedUi()) return false;
  const gatewayUrl = resolveGatewayUrl();
  // Public wss tunnel: stay on Vercel (one-click path)
  if (isPublicGatewayUrl(gatewayUrl)) return false;
  if (!isLoopbackGatewayUrl(gatewayUrl)) return false;

  const up = await isLocalWebReachable();
  if (!up) return false;

  window.location.replace(`${localWebBaseUrl()}${pathWithQuery}`);
  return true;
}

function webPort(): string {
  if (typeof window !== "undefined" && window.location.port) {
    return window.location.port;
  }
  return process.env.NEXT_PUBLIC_WEB_PORT ?? "3000";
}

function gatewayPort(): string {
  return process.env.NEXT_PUBLIC_GATEWAY_PORT ?? "8787";
}

/**
 * LAN-oriented share URL (same Wi‑Fi). Prefer oneClickInvite when using tunnel.
 */
export function buildShareUrl(roomId: string, lanHost?: string | null): string {
  if (typeof window === "undefined") return "";
  const path = `/room/${encodeURIComponent(roomId)}`;
  const hostOverride =
    lanHost?.trim() ||
    loadShareHost() ||
    process.env.NEXT_PUBLIC_SHARE_ORIGIN?.replace(/^https?:\/\//, "").replace(
      /\/$/,
      "",
    ) ||
    "";

  if (hostOverride && !hostOverride.includes("vercel.app")) {
    const hasPort = /:\d+$/.test(hostOverride);
    const origin = hostOverride.startsWith("http")
      ? hostOverride.replace(/\/$/, "")
      : `http://${hostOverride}${hasPort ? "" : `:${webPort()}`}`;
    return `${origin}${path}`;
  }

  const host = window.location.hostname;
  if (!isLoopbackHost(host)) {
    return `${window.location.origin}${path}`;
  }

  return `${window.location.origin}${path}`;
}

/**
 * One-click invite for remote Windows (no install):
 * https://fonglish.vercel.app/room/ID?gw=wss://….trycloudflare.com
 */
export function buildOneClickInvite(
  roomId: string,
  opts?: {
    gatewayUrl?: string;
    name?: string;
    speak?: string;
    caption?: string;
  },
): string {
  const gw = normalizeWsUrl(opts?.gatewayUrl ?? resolveGatewayUrl());
  const base = DEFAULT_PUBLIC_UI;
  const url = new URL(`${base}/room/${encodeURIComponent(roomId)}`);
  if (isPublicGatewayUrl(gw)) {
    url.searchParams.set("gw", gw);
  }
  if (opts?.name) url.searchParams.set("name", opts.name);
  if (opts?.speak) url.searchParams.set("speak", opts.speak);
  if (opts?.caption) url.searchParams.set("caption", opts.caption);
  return url.toString();
}

export function buildLanGatewayUrl(lanHost: string): string {
  const h = lanHost.replace(/^https?:\/\//, "").split(":")[0] ?? lanHost;
  return `ws://${h}:${gatewayPort()}`;
}

export function isShareUrlLoopback(url: string): boolean {
  try {
    const u = new URL(url);
    return isLoopbackHost(u.hostname);
  } catch {
    return /127\.0\.0\.1|localhost/.test(url);
  }
}

/** True when we can offer a real one-click remote invite. */
export function canOneClickInvite(gatewayUrl?: string): boolean {
  return isPublicGatewayUrl(gatewayUrl ?? resolveGatewayUrl());
}
