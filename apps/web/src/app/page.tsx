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
    <main className="container lobby">
      <div className="lobby-inner">
        <p className="lobby-eyebrow">Fonglish</p>
        <h1 className="lobby-title">Live bilingual subtitles for 1:1 calls</h1>
        <p className="lobby-lead muted">
          Start a video call with real-time translated captions. Each person sees
          subtitles in their own language.
        </p>

        <div className="card lobby-card">
          <div className="lobby-form">
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

            <div className="lobby-langs">
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
                <label htmlFor="caption">Captions in</label>
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

            <div className="lobby-divider">or join existing</div>

            <div className="lobby-join">
              <div className="field">
                <label htmlFor="join">Room ID</label>
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
                className="btn btn-ghost"
                disabled={!canStart || !joinId}
                onClick={() => goRoom(joinId.replace(/^\/room\//, ""))}
              >
                Join
              </button>
            </div>
          </div>
        </div>

        <p className="lobby-hint muted">
          Requires <code>npm run gateway</code>, <code>npm run web</code>, and a
          running Ollama instance. Open in two browser windows to try a call.
        </p>
      </div>
    </main>
  );
}
