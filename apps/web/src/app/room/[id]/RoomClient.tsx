"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isLangCode, type LangCode } from "@fonglish/shared";
import { CallRoom } from "@/components/CallRoom";
import { randomId, roomPath } from "@/lib/ids";
import {
  applyGatewayFromSearch,
  isHostedUi,
  isLoopbackGatewayUrl,
  isPublicGatewayUrl,
  loadGatewayUrlSetting,
  localWebBaseUrl,
  redirectHostedToLocalWeb,
  resolveGatewayUrl,
} from "@/lib/gateway-url";

export function RoomClient({ roomId }: { roomId: string }) {
  const search = useSearchParams();
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);

  const qs = search.toString();
  const pathWithQuery = `${roomPath(roomId)}${qs ? `?${qs}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Persist invite gateway before connecting (one-click ?gw=)
      if (search.get("gw")) {
        applyGatewayFromSearch(search);
      }

      const gw = resolveGatewayUrl();
      const publicMode = isPublicGatewayUrl(gw);

      // One-click path: Vercel + public wss — no local install
      if (publicMode) {
        if (!cancelled) {
          setBlocked(false);
          setChecking(false);
          setReady(true);
        }
        return;
      }

      if (!isHostedUi()) {
        if (!cancelled) {
          setChecking(false);
          setReady(true);
        }
        return;
      }

      // Hosted UI + loopback gateway only: try local web, else block with help
      if (isLoopbackGatewayUrl(gw) || isLoopbackGatewayUrl(loadGatewayUrlSetting())) {
        const redirected = await redirectHostedToLocalWeb(pathWithQuery);
        if (cancelled) return;
        if (redirected) return;
        setBlocked(true);
        setChecking(false);
        setReady(false);
        return;
      }

      if (!cancelled) {
        setChecking(false);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathWithQuery, search]);

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

  if (checking) {
    return (
      <main className="container lobby">
        <div className="card lobby-card">
          <p className="muted">Connecting…</p>
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
              Need a one-click invite
            </h1>
            <p className="lobby-lead muted">
              This link has no public gateway (<code>gw=wss://…</code>). Either
              ask the host for a one-click link from{" "}
              <code>npm run host:public</code>, or run Fonglish locally on this
              PC.
            </p>
            <div className="banner info" role="status">
              <strong>Host (Mac)</strong>
              <ol className="lobby-hosted-steps">
                <li>
                  <code>npm run gateway</code>
                </li>
                <li>
                  <code>npm run host:public</code>
                </li>
                <li>Create a room and Share access link (includes tunnel)</li>
              </ol>
            </div>
            <div className="banner warn" role="note">
              <strong>This PC (optional local install)</strong>
              <ol className="lobby-hosted-steps">
                <li>
                  <code>npm run gateway</code> + <code>npm run web</code>
                </li>
                <li>
                  Open <a href={localUrl}>{localUrl}</a>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!ready) return null;

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
