"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGES, type LangCode } from "@fonglish/shared";
import { randomId, roomPath } from "@/lib/ids";
import {
  isHostedUi,
  isLoopbackHost,
  loadGatewayUrlSetting,
  localWebBaseUrl,
  redirectHostedToLocalWeb,
  saveGatewayUrlSetting,
  discoverLanIp,
  buildLanGatewayUrl,
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
  const [gatewayUrl, setGatewayUrl] = useState(() => loadGatewayUrlSetting());
  const [hostedHint, setHostedHint] = useState<string | null>(null);
  const [lanGatewayUrl, setLanGatewayUrl] = useState<string | null>(null);
  const hostedUi = useMemo(() => isHostedUi(), []);
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
    const path = `${roomPath(roomId)}?${qs.toString()}`;
    // Only jumps to 127.0.0.1:3000 if local web is actually running
    if (await redirectHostedToLocalWeb(path)) return;
    if (hostedUi) {
      setHostedHint(
        `Local web is not running on this PC. In a terminal run: npm run gateway  and  npm run web, then open ${localWebBaseUrl()}${path}`,
      );
      return;
    }
    router.push(path);
  };

  return (
    <main className="container lobby">
      <div className="lobby-inner">
        <header className="lobby-header">
          <p className="lobby-mark">Fonglish</p>
          <h1 className="lobby-title">Secure bilingual consultation</h1>
          <p className="lobby-lead">
            Private video with live translated captions. Speech recognition and
            translation run on your local gateway — not in the cloud.
          </p>
        </header>

        <div className="card lobby-card">
          {hostedUi && (
            <div className="banner info lobby-hosted-banner" role="note">
              <strong className="lobby-hosted-title">Windows / any PC setup</strong>
              <p className="lobby-hosted-body">
                Vercel only hosts this UI. On the machine that will process
                captions, open a terminal in the repo and run:
              </p>
              <ol className="lobby-hosted-steps">
                <li>
                  <code>npm run gateway</code>
                </li>
                <li>
                  <code>npm run web</code>
                </li>
                <li>
                  Open{" "}
                  <a href={localWebBaseUrl()}>
                    {localWebBaseUrl()}
                  </a>{" "}
                  (use <strong>127.0.0.1</strong>, not only the Vercel link)
                </li>
              </ol>
              <p className="lobby-hosted-body">
                If you click a Vercel invite without local web running, the
                browser cannot open the session — that is expected.
              </p>
            </div>
          )}

          {hostedHint && (
            <div className="banner warn lobby-hosted-banner" role="alert">
              {hostedHint}
            </div>
          )}

          {!hostedUi && isLocalLobby && lanGatewayUrl && (
            <div className="banner info lobby-lan-banner" role="note">
              <strong className="lobby-hosted-title">Hosting for another device?</strong>
              <p className="lobby-hosted-body">
                This Mac runs the gateway. A Windows (or other) peer must set{" "}
                <strong>Caption gateway</strong> to{" "}
                <code>{lanGatewayUrl}</code> in the lobby —{" "}
                <code>127.0.0.1</code> only works on this machine.
              </p>
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
                placeholder="ws://127.0.0.1:8787"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                spellCheck={false}
                aria-describedby="gateway-hint"
                autoComplete="off"
              />
              <span id="gateway-hint" className="field-hint">
                Default for local use. On another device, use your host LAN IP.
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

            <div className="lobby-divider">or join an existing session</div>

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
                      goRoom(joinId.replace(/^\/room\//, ""));
                    }
                  }}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canStart || !joinId}
                onClick={() => goRoom(joinId.replace(/^\/room\//, ""))}
              >
                Join
              </button>
            </div>
          </div>
        </div>

        <p className="lobby-footer">
          No recording or retention. Quality preset{" "}
          <code>balanced</code> uses whisper-base and llama3 on your gateway.
        </p>
      </div>
    </main>
  );
}
