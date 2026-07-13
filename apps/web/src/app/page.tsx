"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGES, type LangCode } from "@fonglish/shared";
import { randomId, roomPath } from "@/lib/ids";

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

  const canStart = useMemo(
    () => displayName.trim().length >= 1,
    [displayName],
  );

  const persist = () => {
    localStorage.setItem(NAME_KEY, displayName.trim());
    localStorage.setItem(SPEAK_KEY, speakLang);
    localStorage.setItem(CAPTION_KEY, captionLang);
  };

  const goRoom = (roomId: string) => {
    persist();
    const qs = new URLSearchParams({
      name: displayName.trim(),
      speak: speakLang,
      caption: captionLang,
    });
    router.push(`${roomPath(roomId)}?${qs.toString()}`);
  };

  return (
    <main className="container" style={{ padding: "3rem 0 4rem" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <p className="muted" style={{ margin: 0, fontWeight: 600 }}>
          Fonglish · real-time video call translation
        </p>
        <h1
          style={{
            margin: "0.4rem 0 0.75rem",
            fontSize: "clamp(2rem, 4vw, 2.6rem)",
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
          }}
        >
          Live bilingual subtitles for 1:1 calls
        </h1>
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
          Browser WebRTC call with live captions: your mic → xAI speech-to-text →
          Grok translation → subtitles for both sides. Companion overlay for
          Zoom/Meet is designed for later via a swappable audio source.
        </p>

        <div className="card" style={{ padding: "1.25rem", marginTop: "1.5rem" }}>
          <div style={{ display: "grid", gap: "1rem" }}>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                placeholder="Alex"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={40}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.85rem",
              }}
            >
              <div className="field">
                <label htmlFor="speak">I speak</label>
                <select
                  id="speak"
                  value={speakLang}
                  onChange={(e) => setSpeakLang(e.target.value as LangCode)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} ({l.nativeLabel})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="caption">I want captions in</label>
                <select
                  id="caption"
                  value={captionLang}
                  onChange={(e) => setCaptionLang(e.target.value as LangCode)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} ({l.nativeLabel})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              disabled={!canStart}
              onClick={() => goRoom(randomId("room"))}
            >
              Create room
            </button>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "0.6rem",
                alignItems: "end",
              }}
            >
              <div className="field">
                <label htmlFor="join">Or join room ID</label>
                <input
                  id="join"
                  placeholder="room-ab12cd34"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.trim())}
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canStart || !joinId}
                onClick={() => goRoom(joinId.replace(/^\/room\//, ""))}
              >
                Join
              </button>
            </div>
          </div>
        </div>

        <p className="muted" style={{ fontSize: "0.85rem", marginTop: "1.25rem" }}>
          Run the gateway (`npm run gateway`) with <code>XAI_API_KEY</code> set,
          then open this page in two browser profiles to demo.
        </p>
      </div>
    </main>
  );
}
