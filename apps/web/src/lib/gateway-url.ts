/** localStorage key for optional gateway override (Vercel UI → local gateway). */
export const GATEWAY_URL_KEY = "fong_gateway_url";

/**
 * Resolve caption gateway WebSocket URL.
 *
 * Priority:
 * 1. localStorage override (lobby setting — for Vercel-hosted UI + local STT/MT)
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
    // Hosted UI (Vercel) talks to a local gateway by default
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
  // Allow pasting http(s) URLs
  if (u.startsWith("https://")) u = `wss://${u.slice("https://".length)}`;
  if (u.startsWith("http://")) u = `ws://${u.slice("http://".length)}`;
  if (!u.startsWith("ws://") && !u.startsWith("wss://")) {
    u = `ws://${u}`;
  }
  // Prefer IPv4 loopback on Windows
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
  const n = normalizeWsUrl(url);
  window.localStorage.setItem(GATEWAY_URL_KEY, n);
}

/** Human-readable hint when the browser cannot open the caption gateway socket. */
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
      `Cannot reach your local caption gateway from this hosted page. ` +
      `Run npm run gateway, then open http://localhost:3000 — or set Caption gateway ` +
      `to your machine's LAN address (e.g. ws://192.168.1.x:8787). Tried ${url}`
    );
  }
  if (protocol === "https:" && url.startsWith("ws://")) {
    return (
      `This secure page cannot open an insecure WebSocket. ` +
      `Use http://localhost:3000 for local sessions, or configure a secure wss:// tunnel. ` +
      `Tried ${url}`
    );
  }
  return (
    `Cannot reach the caption gateway. Start it with npm run gateway ` +
    `and confirm ${url} is reachable (curl http://127.0.0.1:8787/health).`
  );
}

export function isHostedUi(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith(".vercel.app");
}

export function isLoopbackGatewayUrl(url: string): boolean {
  return /:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(url);
}

/**
 * Hosted UI cannot open ws://127.0.0.1 from the browser.
 * Redirect session flows to the local Next dev server when using loopback gateway.
 */
export function redirectHostedToLocalWeb(pathWithQuery: string): boolean {
  if (typeof window === "undefined") return false;
  if (!isHostedUi()) return false;
  const gatewayUrl = resolveGatewayUrl();
  if (!isLoopbackGatewayUrl(gatewayUrl)) return false;
  const port = process.env.NEXT_PUBLIC_WEB_PORT ?? "3000";
  const target = `http://localhost:${port}${pathWithQuery}`;
  window.location.replace(target);
  return true;
}
