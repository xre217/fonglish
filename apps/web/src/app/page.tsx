"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FonglishLogo } from "@/components/FonglishLogo";
import { LANGUAGES, type LangCode } from "@fonglish/shared";
import { randomId, roomPath } from "@/lib/ids";
import {
  applyGatewayFromSearch,
  buildLanGatewayUrl,
  discoverLanIp,
  isHostedUi,
  isLoopbackHost,
  isPublicGatewayUrl,
  loadGatewayUrlSetting,
  localWebBaseUrl,
  redirectHostedToLocalWeb,
  saveGatewayUrlSetting,
} from "@/lib/gateway-url";

const NAME_KEY = "fong_display_name";
const SPEAK_KEY = "fong_speak_lang";
const CAPTION_KEY = "fong_caption_lang";

function load(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

export default function LobbyPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(() => load(NAME_KEY, ""));
  const [speakLang, setSpeakLang] = useState<LangCode>(
    () => load(SPEAK_KEY, "en") as LangCode,
  );
  const [captionLang, setCaptionLang] = useState<LangCode>(
    () => load(CAPTION_KEY, "es") as LangCode,
  );
  const [joinId, setJoinId] = useState("");
  const [gatewayUrl, setGatewayUrl] = useState(() => {
    if (typeof window !== "undefined") {
      const fromLink = applyGatewayFromSearch(
        new URLSearchParams(window.location.search),
      );
      if (fromLink) return fromLink;
    }
    return loadGatewayUrlSetting();
  });
  const [hostedHint, setHostedHint] = useState<string | null>(null);
  const [lanGatewayUrl, setLanGatewayUrl] = useState<string | null>(null);
  const hostedUi = useMemo(() => isHostedUi(), []);
  const publicGw = isPublicGatewayUrl(gatewayUrl);
  const isLocalLobby = useMemo(
    () =>
      typeof window !== "undefined" &&
      isLoopbackHost(window.location.hostname),
    [],
  );

  useEffect(() => {
    if (!isLocalLobby || hostedUi) return;
    void discoverLanIp().then((ip) => {
      if (ip) setLanGatewayUrl(buildLanGatewayUrl(ip));
    });
  }, [isLocalLobby, hostedUi]);

  const canStart = useMemo(
    () => displayName.trim().length >= 1,
    [displayName],
  );

  const persist = () => {
    localStorage.setItem(NAME_KEY, displayName.trim());
    localStorage.setItem(SPEAK_KEY, speakLang);
    localStorage.setItem(CAPTION_KEY, captionLang);
    saveGatewayUrlSetting(gatewayUrl);
  };

  const goRoom = async (roomId: string) => {
    persist();
    setHostedHint(null);
    const qs = new URLSearchParams({
      name: displayName.trim(),
      speak: speakLang,
      caption: captionLang,
    });
    if (isPublicGatewayUrl(gatewayUrl)) {
      qs.set("gw", gatewayUrl);
    }
    const path = `${roomPath(roomId)}?${qs.toString()}`;

    // Public wss tunnel → join on this origin (Vercel or local)
    if (isPublicGatewayUrl(gatewayUrl)) {
      router.push(path);
      return;
    }

    if (await redirectHostedToLocalWeb(path)) return;
    if (hostedUi) {
      setHostedHint(
        `For Windows one-click: on the host Mac run "npm run gateway" then "npm run host:public", paste the wss:// URL into Caption gateway, start a room, and Share. Or run local web: ${localWebBaseUrl()}${path}`,
      );
      return;
    }
    router.push(path);
  };

  return (
    <main className="container lobby">
      <div className="lobby-inner">
        <header className="lobby-header">
          <FonglishLogo variant="lobby" />
          <h1 className="lobby-title">Clear conversation, across languages</h1>
          <p className="lobby-lead">
            Live video with translated captions. One-click guests use Vercel + a
            public tunnel; processing can stay on the host Mac.
          </p>
        </header>

        <div className="card lobby-card">
          {hostedUi && (
            <div className="banner info lobby-hosted-banner" role="note">
              <strong className="lobby-hosted-title">
                {publicGw ? "One-click guest mode" : "Windows one-click (host Mac)"}
              </strong>
              {publicGw ? (
                <p className="lobby-hosted-body">
                  Public gateway is set. Enter your name and start/join — no
                  install on this PC.
                </p>
              ) : (
                <>
                  <p className="lobby-hosted-body">
                    Host Mac runs the stack; Windows only opens the shared link:
                  </p>
                  <ol className="lobby-hosted-steps">
                    <li>
                      <code>npm run gateway</code>
                    </li>
                    <li>
                      <code>npm run host:public</code>
                    </li>
                    <li>
                      Paste <code>wss://…trycloudflare.com</code> into Caption
                      gateway below
                    </li>
                    <li>Start session → Share access link to Windows</li>
                  </ol>
                </>
              )}
            </div>
          )}

          {hostedHint && (
            <div className="banner warn lobby-hosted-banner" role="alert">
              {hostedHint}
            </div>
          )}

          {!hostedUi && isLocalLobby && (
            <div className="banner info lobby-lan-banner" role="note">
              <strong className="lobby-hosted-title">
                One-click remote guests
              </strong>
              <p className="lobby-hosted-body">
                Run <code>npm run host:public</code> (gateway must already be
                up), paste the printed <code>wss://</code> into Caption gateway,
                then Share from the room. Guests use Vercel only — no Node.
              </p>
              {lanGatewayUrl && (
                <p className="lobby-hosted-body">
                  Same Wi‑Fi fallback gateway: <code>{lanGatewayUrl}</code>
                </p>
              )}
            </div>
          )}

          <div className="lobby-form">
            <div className="field">
              <label htmlFor="name">Display name</label>
              <input
                id="name"
                placeholder="e.g. J. Mitchell"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={40}
              />
            </div>

            <div className="lobby-langs">
              <div className="field">
                <label htmlFor="speak">Spoken language</label>
                <select
                  id="speak"
                  value={speakLang}
                  onChange={(e) => setSpeakLang(e.target.value as LangCode)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="caption">Caption language</label>
                <select
                  id="caption"
                  value={captionLang}
                  onChange={(e) => setCaptionLang(e.target.value as LangCode)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="gateway">Caption gateway</label>
              <input
                id="gateway"
                placeholder="ws://127.0.0.1:8787 or wss://….trycloudflare.com"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                spellCheck={false}
                aria-describedby="gateway-hint"
                autoComplete="off"
              />
              <span id="gateway-hint" className="field-hint">
                Local: <code>ws://127.0.0.1:8787</code>. One-click guests: paste{" "}
                <code>wss://</code> from <code>npm run host:public</code>.
              </span>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!canStart}
              onClick={() => goRoom(randomId("room"))}
            >
              Start session
            </button>

            <div className="lobby-divider">Or join an existing session</div>

            <div className="lobby-join">
              <div className="field">
                <label htmlFor="join">Session ID</label>
                <input
                  id="join"
                  placeholder="room-ab12cd34"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.trim())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canStart && joinId) {
                      void goRoom(joinId.replace(/^\/room\//, ""));
                    }
                  }}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canStart || !joinId}
                onClick={() => void goRoom(joinId.replace(/^\/room\//, ""))}
              >
                Join
              </button>
            </div>
          </div>
        </div>

        <p className="lobby-footer">
          Nothing is recorded. One-click mode: host Mac stays on; Windows only
          needs the shared HTTPS link.
        </p>
      </div>
    </main>
  );
}
