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
        <header className="lobby-header">
          <p className="lobby-mark">Fonglish</p>
          <h1 className="lobby-title">Secure bilingual consultation</h1>
          <p className="lobby-lead">
            Private video with live translated captions. Each participant selects
            their own spoken and caption language.
          </p>
        </header>

        <div className="card lobby-card">
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
          Captions are processed on your firm&apos;s local infrastructure. No
          recording or retention by this application.
        </p>
      </div>
    </main>
  );
}
