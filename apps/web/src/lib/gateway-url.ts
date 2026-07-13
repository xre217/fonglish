/** localStorage key for optional gateway override (Vercel UI → local gateway). */
export const GATEWAY_URL_KEY = "fong_gateway_url";
/** LAN hostname/IP used when building invite links (Mac → Windows). */
export const SHARE_HOST_KEY = "fong_share_host";

/**
 * Resolve caption gateway WebSocket URL.
 *
 * Priority:
 * 1. localStorage override (lobby setting)
 * 2. NEXT_PUBLIC_GATEWAY_URL
 * 3. Same host as the page (or 127.0.0.1 when on localhost / Vercel)
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

function normalizeWsUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return "ws://127.0.0.1:8787";
  if (u.startsWith("https://")) u = `wss://${u.slice("https://".length)}`;
  if (u.startsWith("http://")) u = `ws://${u.slice("http://".length)}`;
  if (!u.startsWith("ws://") && !u.startsWith("wss://")) {
    u = `ws://${u}`;
  }
  u = u.replace("://localhost", "://127.0.0.1").replace("://[::1]", "://127.0.0.1");
  return u.replace(/\/$/, "");
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

export function formatWsError(url: string): string {
  if (typeof window === "undefined") {
    return `WebSocket error — is the gateway running? Tried ${url}`;
  }
  const host = window.location.hostname;
  const protocol = window.location.protocol;
  const isHosted = host.endsWith(".vercel.app");
  const loopback = /:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(url);

  if (isHosted && loopback) {
    return (
      `Cannot reach a local caption gateway from Vercel. ` +
      `For Mac↔Windows: on the Mac run gateway+web, open http://MAC_LAN_IP:3000 on both machines, ` +
      `and set Caption gateway to ws://MAC_LAN_IP:8787. Tried ${url}`
    );
  }
  if (protocol === "https:" && url.startsWith("ws://")) {
    return (
      `This secure page cannot open an insecure WebSocket. ` +
      `Use http://MAC_LAN_IP:3000 (not https://vercel) for cross-device calls. Tried ${url}`
    );
  }
  if (loopback) {
    return (
      `Gateway is loopback-only (${url}). A Windows PC cannot reach your Mac's 127.0.0.1. ` +
      `On Windows open http://MAC_LAN_IP:3000 and set gateway to ws://MAC_LAN_IP:8787.`
    );
  }
  return (
    `Cannot reach the caption gateway at ${url}. ` +
    `Start npm run gateway on the host and allow firewall ports 3000 & 8787.`
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
  return /:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(url);
}

export function localWebBaseUrl(): string {
  const port = process.env.NEXT_PUBLIC_WEB_PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export function isPrivateLanIp(ip: string): boolean {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

/**
 * Best-effort LAN IPv4: gateway /health first, then WebRTC ICE.
 */
export async function discoverLanIp(timeoutMs = 2000): Promise<string | null> {
  const health = await fetchGatewayHealth();
  const fromGateway = health?.lanIps?.find(isPrivateLanIp);
  if (fromGateway) return fromGateway;

  if (typeof window === "undefined" || typeof RTCPeerConnection === "undefined") {
    return null;
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
      const lan = [...ips].filter(isPrivateLanIp);
      resolve(lan[0] ?? null);
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
 * Invite URL for the other person (prefer LAN / public origin over 127.0.0.1).
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

  if (hostOverride) {
    // hostOverride may be "192.168.1.67" or "192.168.1.67:3000"
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

  // Loopback — still return local URL but callers should warn
  return `${window.location.origin}${path}`;
}

export function gatewayHttpBaseFromWs(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://")
    .replace(/\/$/, "");
}

export type GatewayHealth = {
  ok?: boolean;
  lanIps?: string[];
};

/** Probe gateway /health (CORS-enabled) for LAN join hints. */
export async function fetchGatewayHealth(
  wsUrl?: string,
): Promise<GatewayHealth | null> {
  if (typeof window === "undefined") return null;
  const base = gatewayHttpBaseFromWs(wsUrl ?? resolveGatewayUrl());
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as GatewayHealth;
  } catch {
    return null;
  }
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
