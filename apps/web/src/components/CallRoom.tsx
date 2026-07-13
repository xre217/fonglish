"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserMicSource } from "@fonglish/audio";
import {
  LANGUAGES,
  type CaptionEvent,
  type GatewayServices,
  type LangCode,
  type PeerInfo,
} from "@fonglish/shared";
import { CaptionClient } from "@/lib/caption-client";
import {
  buildLanGatewayUrl,
  buildOneClickInvite,
  buildShareUrl,
  canOneClickInvite,
  discoverLanIp,
  isLoopbackHost,
  isShareUrlLoopback,
  loadShareHost,
  resolveGatewayUrl,
  saveShareHost,
} from "@/lib/gateway-url";
import { CallPeer, getMediaStream } from "@/lib/webrtc";
import { CaptionOverlay, type CaptionLine } from "./CaptionOverlay";
import { VideoStage } from "./VideoStage";
import { FonglishLogo } from "./FonglishLogo";

function servicePillClass(
  kind: "ok" | "loading" | "bad",
): string {
  if (kind === "ok") return "svc-pill ok";
  if (kind === "loading") return "svc-pill loading";
  return "svc-pill bad";
}

function ollamaKind(s: GatewayServices | null): "ok" | "loading" | "bad" {
  if (!s) return "loading";
  return s.ollama ? "ok" : "bad";
}

function sttKind(s: GatewayServices | null): "ok" | "loading" | "bad" {
  if (!s) return "loading";
  if (s.stt === "ready") return "ok";
  if (s.stt === "loading") return "loading";
  return "bad";
}

type Props = {
  roomId: string;
  displayName: string;
  speakLang: LangCode;
  captionLang: LangCode;
  peerId: string;
};

export function CallRoom({
  roomId,
  displayName,
  speakLang: initialSpeak,
  captionLang: initialCaption,
  peerId,
}: Props) {
  const [speakLang, setSpeakLang] = useState<LangCode>(initialSpeak);
  const [captionLang, setCaptionLang] = useState<LangCode>(initialCaption);
  const [status, setStatus] = useState("Connecting…");
  const [error, setError] = useState<string | null>(null);
  const [remotePeer, setRemotePeer] = useState<PeerInfo | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [mtMs, setMtMs] = useState<number | null>(null);
  const [services, setServices] = useState<GatewayServices | null>(null);
  const [copyToast, setCopyToast] = useState(false);
  const [lanHost, setLanHost] = useState(() => loadShareHost());
  const [lanHint, setLanHint] = useState<string | null>(null);
  /** Mic level 0–1 for caption-path diagnostics (STT feed, not WebRTC). */
  const [micLevel, setMicLevel] = useState(0);
  const [pcmSent, setPcmSent] = useState(0);

  const clientRef = useRef<CaptionClient | null>(null);
  const callRef = useRef<CallPeer | null>(null);
  const micSourceRef = useRef<BrowserMicSource | null>(null);
  const micLoopStop = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const joinedRef = useRef(false);
  const mutedRef = useRef(false);
  const pcmCountRef = useRef(0);
  const levelTickRef = useRef(0);

  const activeGateway = useMemo(() => resolveGatewayUrl(), []);
  const oneClick = canOneClickInvite(activeGateway);
  const shareUrl = useMemo(() => {
    if (oneClick) {
      return buildOneClickInvite(roomId, {
        gatewayUrl: activeGateway,
        speak: speakLang,
        caption: captionLang,
      });
    }
    return buildShareUrl(roomId, lanHost || null);
  }, [roomId, lanHost, oneClick, activeGateway, speakLang, captionLang]);
  const shareIsLoopback = isShareUrlLoopback(shareUrl);
  const pageIsLoopback =
    typeof window !== "undefined" && isLoopbackHost(window.location.hostname);

  useEffect(() => {
    if (!pageIsLoopback || lanHost) return;
    let cancelled = false;
    void discoverLanIp().then((ip) => {
      if (cancelled || !ip) return;
      setLanHost(ip);
      saveShareHost(ip);
      setLanHint(
        `Detected LAN address ${ip}. Windows should open the share link below (not 127.0.0.1).`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [pageIsLoopback, lanHost]);

  const upsertCaption = useCallback((caption: CaptionEvent) => {
    setCaptions((prev) => {
      const id = `${caption.speakerId}:${caption.utteranceId}`;
      const next = prev.filter((c) => c.id !== id);
      next.push({ ...caption, id });
      // keep last 12
      return next.slice(-12);
    });
  }, []);

  const ensureCall = useCallback(
    (remote: PeerInfo, local: MediaStream, client: CaptionClient, polite: boolean) => {
      if (callRef.current) return callRef.current;

      const call = new CallPeer(
        local,
        {
          onRemoteStream: (s) => setRemoteStream(s),
          onSignal: (payload) => client.signal(remote.peerId, payload),
          onConnectionState: (state) => {
            if (state === "connected") {
              setStatus("Connected");
              setError(null);
            }
            if (state === "failed") {
              setError(
                "Video link failed (WebRTC). Both must use the same room + same public gateway. Click the main video once if it’s black (autoplay). Check firewall / try again.",
              );
            }
            if (state === "disconnected") setStatus("Reconnecting…");
            if (state === "connecting") setStatus("Connecting media…");
          },
          onIceConnectionState: (state) => {
            if (state === "failed" || state === "disconnected") {
              setStatus(`Network: ${state}`);
            }
            if (state === "connected" || state === "completed") {
              setStatus("Connected");
            }
            if (state === "checking") setStatus("Finding network path…");
          },
        },
        { polite },
      );
      callRef.current = call;
      return call;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const client = new CaptionClient();
    clientRef.current = client;
    micLoopStop.current = false;

    (async () => {
      try {
        const stream = await getMediaStream();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setLocalStream(stream);

        client.connect({
          onOpen: () => {
            setStatus("Joining room…");
            client.join({
              roomId,
              peerId,
              displayName,
              speakLang: initialSpeak,
              captionLang: initialCaption,
            });
          },
          onClose: () => setStatus("Disconnected"),
          onWelcome: (peers, _peerId, _roomId, svc) => {
            joinedRef.current = true;
            if (svc) setServices(svc);
            setStatus(peers.length ? "Connecting media…" : "Waiting for peer…");
            const other = peers[0] ?? null;
            setRemotePeer(other);
            if (other && streamRef.current) {
              // Existing peer: we are the joiner → make offer (impolite initiator)
              const call = ensureCall(other, streamRef.current, client, false);
              void call.createOffer();
            }
          },
          onServices: (svc) => setServices(svc),
          onPeerJoined: (peer) => {
            setRemotePeer(peer);
            setStatus("Peer joined — connecting media…");
            if (streamRef.current) {
              // We were first: polite peer answers their offer (or wait for offer)
              ensureCall(peer, streamRef.current, client, true);
            }
          },
          onPeerLeft: () => {
            setRemotePeer(null);
            setRemoteStream(null);
            callRef.current?.close();
            callRef.current = null;
            setStatus("Peer left — waiting…");
          },
          onPeerUpdated: (peer) => {
            if (peer.peerId !== peerId) setRemotePeer(peer);
          },
          onSignal: (fromId, payload) => {
            if (!streamRef.current) return;
            const remote: PeerInfo = {
              peerId: fromId,
              displayName: "Peer",
              speakLang: "en",
              captionLang: "en",
              muted: false,
            };
            const call =
              callRef.current ??
              ensureCall(
                remote,
                streamRef.current,
                client,
                // Answerer when we receive an offer first
                payload.kind === "offer",
              );
            void call.handleSignal(payload).catch((err) => {
              console.error(err);
              setError(err instanceof Error ? err.message : "Signal error");
            });
          },
          onCaption: upsertCaption,
          onError: (code, message) => {
            setError(`${code}: ${message}`);
          },
          onStats: (s) => {
            if (s.mtMs != null) setMtMs(s.mtMs);
          },
        });

        // Stream mic PCM to gateway for STT (own mic only). Independent of WebRTC A/V.
        const mic = new BrowserMicSource(async () => stream);
        micSourceRef.current = mic;
        (async () => {
          try {
            for await (const chunk of mic.start()) {
              if (micLoopStop.current) break;
              // Wait until room join so gateway has a pipeline
              if (!joinedRef.current || !client.ready || mutedRef.current) continue;
              client.sendPcm(chunk.pcm);
              pcmCountRef.current += 1;
              // Throttle React updates for level / counters
              const now = Date.now();
              if (now - levelTickRef.current > 200) {
                levelTickRef.current = now;
                setMicLevel(mic.peak);
                setPcmSent(pcmCountRef.current);
              }
            }
          } catch (err) {
            if (!cancelled) {
              console.error(err);
              setError(
                err instanceof Error ? err.message : "Mic capture for captions failed",
              );
            }
          }
        })();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not access camera/microphone",
        );
        setStatus("Media error");
      }
    })();

    return () => {
      cancelled = true;
      micLoopStop.current = true;
      joinedRef.current = false;
      void micSourceRef.current?.stop();
      callRef.current?.close();
      client.leave();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per room
  }, [roomId, peerId, displayName]);

  useEffect(() => {
    if (!clientRef.current?.ready) return;
    clientRef.current.updateLangs(speakLang, captionLang);
    setCaptions([]);
    setError(null);
  }, [speakLang, captionLang]);

  const waitingForPeer = !remotePeer;

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    callRef.current?.setMicEnabled(!next);
    clientRef.current?.setMuted(next);
  };

  const toggleCam = () => {
    const next = !camOff;
    setCamOff(next);
    callRef.current?.setCamEnabled(!next);
  };

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        window.prompt("Copy:", text);
        return;
      }
      setCopyToast(true);
      window.setTimeout(() => setCopyToast(false), 2000);
    } catch {
      window.prompt("Copy:", text);
    }
  };

  const copyLink = async () => {
    if (lanHost) saveShareHost(lanHost);
    const url = oneClick
      ? buildOneClickInvite(roomId, {
          gatewayUrl: resolveGatewayUrl(),
          speak: speakLang,
          caption: captionLang,
        })
      : buildShareUrl(roomId, lanHost || null);
    await copyText(url);
  };

  const copyGatewayUrl = async () => {
    if (!lanHost) return;
    await copyText(buildLanGatewayUrl(lanHost));
  };

  const statusKind = error
    ? "error"
    : status === "Connected"
      ? "connected"
      : "waiting";

  const statusLabel =
    statusKind === "error"
      ? "Connection issue"
      : statusKind === "connected"
        ? "Connected"
        : "Waiting for guest";

  const ollamaK = ollamaKind(services);
  const sttK = sttKind(services);
  const ollamaTitle = services?.ollama
    ? `Translation ready (${services.ollamaModel ?? "model"})`
    : `Translation unavailable${services?.ollamaError ? `: ${services.ollamaError}` : ""}`;
  const sttTitle =
    services?.stt === "ready"
      ? `Speech recognition ready (${services.sttModel ?? "whisper"})`
      : services?.stt === "loading" || !services
        ? "Initializing speech recognition…"
        : `Speech recognition error${services?.sttError ? `: ${services.sttError}` : ""}`;

  const showSttLoading =
    services != null && services.stt === "loading";
  const showOllamaBad = services != null && !services.ollama;
  const showSttBad = services != null && (services.stt === "error" || services.stt === "unavailable");
  const hasAlerts = showSttLoading || showOllamaBad || showSttBad || !!error;
  const showLanPanel =
    waitingForPeer && (shareIsLoopback || pageIsLoopback || !!lanHost);

  return (
    <div className="room room-animate">
      {copyToast && (
        <div className="toast" role="status">
          Copied to clipboard
        </div>
      )}
      <header className="room-header">
        <div className="room-header-main">
          <FonglishLogo variant="compact" />
          <div className="room-meta muted">
            <div className="room-meta-row">
              <code className="room-id" title={roomId}>
                {roomId}
              </code>
              <span
                className={`status-pill ${statusKind}`}
                title={status}
                aria-label={`Session status: ${statusLabel}`}
              >
                <span className="status-dot" aria-hidden />
                <span className="status-label">{statusLabel}</span>
              </span>
            </div>
            <div className="room-meta-row room-meta-services">
              <span
                className={servicePillClass(sttK)}
                title={sttTitle}
                aria-label={sttTitle}
              >
                Speech
              </span>
              <span
                className={servicePillClass(ollamaK)}
                title={ollamaTitle}
                aria-label={ollamaTitle}
              >
                Translate
              </span>
              <span
                className="room-stat"
                title={mtMs != null ? `Caption delay ${mtMs} ms` : "Caption delay"}
                aria-label={mtMs != null ? `${mtMs} ms` : "No delay recorded"}
              >
                {mtMs != null ? `${mtMs} ms` : "—"}
              </span>
              <span
                className="room-stat"
                title={
                  pcmSent > 0
                    ? `Caption mic feed active (${pcmSent} chunks). Level ${(micLevel * 100).toFixed(0)}%`
                    : "Caption mic feed not sending yet — wait for join or check Speech pill"
                }
                aria-label={
                  pcmSent > 0
                    ? `Mic level ${(micLevel * 100).toFixed(0)} percent`
                    : "Mic feed idle"
                }
              >
                {pcmSent > 0
                  ? `Mic ${Math.min(99, Math.round(micLevel * 100))}%`
                  : "Mic —"}
              </span>
            </div>
          </div>
        </div>
        <div className="room-actions">
          <button
            type="button"
            className={waitingForPeer ? "btn btn-primary" : "btn btn-secondary"}
            onClick={copyLink}
            aria-label="Share session access link"
          >
            Share access link
          </button>
          <a className="btn btn-ghost" href="/" aria-label="End session and return to lobby">
            End session
          </a>
        </div>
      </header>

      {oneClick && (
        <div className="banner info room-lan-banner" role="status">
          <strong className="room-lan-title">One-click Windows ready</strong>
          <p className="room-lan-lead">
            Public <code>wss://</code> tunnel detected. Share the access link —
            guests open one HTTPS URL on Vercel (no Node, no Chrome flags). Keep
            this Mac online with <code>npm run gateway</code> +{" "}
            <code>npm run host:public</code>.
          </p>
          <div className="room-lan-rows">
            <div className="room-lan-row">
              <span className="room-lan-label">Guest link</span>
              <code className="room-lan-value">{shareUrl}</code>
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={copyLink}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {!oneClick && (showLanPanel || lanHint) && (
        <div className="banner info room-lan-banner" role="note">
          <strong className="room-lan-title">Inviting someone on another computer</strong>
          <p className="room-lan-lead">
            <strong>One-click (no guest setup):</strong> run{" "}
            <code>npm run host:public</code> on this Mac, set Caption gateway to
            the printed <code>wss://…trycloudflare.com</code>, then Share access
            link.
          </p>
          <p className="room-lan-lead">
            <strong>Same Wi‑Fi fallback:</strong> use LAN IP (not{" "}
            <code>127.0.0.1</code>). Cam/mic on <code>http://192.168…</code> needs
            a Chrome insecure-origin flag.
          </p>
          <div className="field room-lan-field">
            <label htmlFor="lan-host">Your network address</label>
            <input
              id="lan-host"
              placeholder="192.168.1.67"
              value={lanHost}
              onChange={(e) => {
                setLanHost(e.target.value.trim());
                saveShareHost(e.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              aria-describedby="lan-join-hint"
            />
          </div>
          {lanHost && (
            <div className="room-lan-rows">
              <div className="room-lan-row">
                <span className="room-lan-label">Session link</span>
                <code className="room-lan-value">{shareUrl}</code>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={copyLink}
                  aria-label="Copy session link"
                >
                  Copy
                </button>
              </div>
              <div className="room-lan-row">
                <span className="room-lan-label">Caption gateway</span>
                <code className="room-lan-value">
                  {buildLanGatewayUrl(lanHost)}
                </code>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={copyGatewayUrl}
                  aria-label="Copy caption gateway URL"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
          <p id="lan-join-hint" className="field-hint">
            On the other computer: open the session link, then paste the caption
            gateway address into the lobby.
          </p>
          {lanHint && <p className="field-hint">{lanHint}</p>}
        </div>
      )}

      {hasAlerts && (
        <div className="room-alerts">
          {showSttLoading && (
            <div className="banner info" role="status">
              Warming up speech recognition — the first load can take a moment.
            </div>
          )}
          {showOllamaBad && (
            <div
              className="banner warn"
              role="status"
              title={
                services?.ollamaModel
                  ? `IT: ollama pull ${services.ollamaModel}`
                  : undefined
              }
            >
              Translation isn&apos;t available right now. You&apos;ll still see
              captions in the spoken language.
            </div>
          )}
          {showSttBad && (
            <div className="banner warn" role="alert">
              Speech recognition couldn&apos;t start
              {services?.sttError ? `: ${services.sttError}` : ""}. Check that
              the gateway is running.
            </div>
          )}
          {error && (
            <div className="banner warn" role="alert">
              {error}
            </div>
          )}
        </div>
      )}

      <div className="call-stage">
        <VideoStage
          localStream={localStream}
          remoteStream={remoteStream}
          localName={displayName}
          remoteName={remotePeer?.displayName ?? null}
          muted={muted}
          camOff={camOff}
          waitingForPeer={waitingForPeer}
        />

        <div className="caption-dock">
          <CaptionOverlay
            lines={captions}
            showOriginal={showOriginal}
            selfPeerId={peerId}
            docked
          />
        </div>
      </div>

      <div className="toolbar card" role="toolbar" aria-label="Call controls">
        <div className="toolbar-controls">
          <button
            type="button"
            className={`btn btn-ghost btn-media${muted ? " off" : ""}`}
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-media${camOff ? " off" : ""}`}
            onClick={toggleCam}
            aria-pressed={camOff}
            aria-label={camOff ? "Turn camera on" : "Turn camera off"}
          >
            {camOff ? "Camera on" : "Camera off"}
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(e) => setShowOriginal(e.target.checked)}
              aria-describedby="show-original-hint"
            />
            Show source language
          </label>
          <span id="show-original-hint" className="sr-only">
            Displays the original spoken text beneath each translated caption
          </span>
        </div>
        <div className="toolbar-langs">
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
      </div>

      <p className="room-footer consent-note">
        This session is not recorded. Captions are processed locally and fade
        when the call ends.
      </p>
    </div>
  );
}
