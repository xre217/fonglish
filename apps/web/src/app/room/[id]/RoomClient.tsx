"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isLangCode, type LangCode } from "@fonglish/shared";
import { CallRoom } from "@/components/CallRoom";
import { randomId, roomPath } from "@/lib/ids";
import {
  isHostedUi,
  localWebBaseUrl,
  redirectHostedToLocalWeb,
} from "@/lib/gateway-url";

export function RoomClient({ roomId }: { roomId: string }) {
  const search = useSearchParams();
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(true);

  const qs = search.toString();
  const pathWithQuery = `${roomPath(roomId)}${qs ? `?${qs}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isHostedUi()) {
        if (!cancelled) setChecking(false);
        return;
      }
      const redirected = await redirectHostedToLocalWeb(pathWithQuery);
      if (cancelled) return;
      if (redirected) return; // navigating away
      setBlocked(true);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathWithQuery]);

  const displayName = search.get("name")?.trim() || "Guest";
  const speakRaw = search.get("speak") ?? "en";
  const captionRaw = search.get("caption") ?? "es";
  const speakLang: LangCode = isLangCode(speakRaw) ? speakRaw : "en";
  const captionLang: LangCode = isLangCode(captionRaw) ? captionRaw : "es";

  const peerId = useMemo(() => {
    if (typeof window === "undefined") return randomId("peer");
    const key = `fong_peer_${roomId}`;
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = randomId("peer");
    sessionStorage.setItem(key, id);
    return id;
  }, [roomId]);

  if (checking && isHostedUi()) {
    return (
      <main className="container lobby">
        <div className="card lobby-card">
          <p className="muted">Checking for local Fonglish on this PC…</p>
        </div>
      </main>
    );
  }

  if (blocked) {
    const localUrl = `${localWebBaseUrl()}${pathWithQuery}`;
    return (
      <main className="container lobby">
        <div className="lobby-inner">
          <div className="card lobby-card">
            <h1 className="lobby-title" style={{ fontSize: "1.35rem" }}>
              Local app not running
            </h1>
            <p className="lobby-lead muted">
              This invite opened on Vercel. Captions need Fonglish running on{" "}
              <strong>this Windows PC</strong> (or the host machine). The browser
              cannot open a session on <code>127.0.0.1</code> until you start it.
            </p>
            <div className="banner warn" role="alert">
              <ol className="lobby-hosted-steps">
                <li>
                  Install Node 20+ and clone the repo if needed
                </li>
                <li>
                  <code>npm install</code>
                </li>
                <li>
                  <code>npm run gateway</code>
                </li>
                <li>
                  <code>npm run web</code>
                </li>
                <li>
                  Open this link:{" "}
                  <a href={localUrl}>{localUrl}</a>
                </li>
              </ol>
            </div>
            <p className="field-hint">
              Prefer <code>http://127.0.0.1:3000</code> over{" "}
              <code>localhost</code> on Windows.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <CallRoom
      roomId={roomId}
      displayName={displayName}
      speakLang={speakLang}
      captionLang={captionLang}
      peerId={peerId}
    />
  );
}
