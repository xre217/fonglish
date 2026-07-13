"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserMicSource } from "@fonglish/audio";
import {
  LANGUAGES,
  type CaptionEvent,
  type GatewayServices,
  type InterpretEvent,
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
import { InterpretPlayer } from "@/lib/interpret-player";
import { CallPeer, getMediaStream } from "@/lib/webrtc";
import { CaptionOverlay, type CaptionLine } from "./CaptionOverlay";
import { VideoStage } from "./VideoStage";
import { FonglishLogo } from "./FonglishLogo";

const SUBTITLES_KEY = "fong_show_subtitles";
/** Volume of remote original voice while host interpretation plays. */
const DUCK_VOLUME = 0.2;

function loadShowSubtitles(): boolean {
  if (typeof window === "undefined") return false;
  const v = localStorage.getItem(SUBTITLES_KEY);
  if (v === null) return false; // default off — interpreter-first
  return v === "1" || v === "true";
}

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

function ttsKind(s: GatewayServices | null): "ok" | "loading" | "bad" {
  if (!s || s.tts == null) return "loading";
  if (s.tts === "ready") return "ok";
  if (s.tts === "loading") return "loading";
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
  const [showSubtitles, setShowSubtitles] = useState(loadShowSubtitles);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [mtMs, setMtMs] = useState<number | null>(null);
  const [ttsMs, setTtsMs] = useState<number | null>(null);
  const [services, setServices] = useState<GatewayServices | null>(null);
  const [copyToast, setCopyToast] = useState(false);
  const [lanHost, setLanHost] = useState(() => loadShareHost());
  const [lanHint, setLanHint] = useState<string | null>(null);
  /** Mic level 0–1 for STT-path diagnostics (not WebRTC). */
  const [micLevel, setMicLevel] = useState(0);
  const [pcmSent, setPcmSent] = useState(0);
  const [mediaDiag, setMediaDiag] = useState<string>("");
  const [needClickToPlay, setNeedClickToPlay] = useState(true);
  const [iceState, setIceState] = useState<string>("");
  const [remoteVolume, setRemoteVolume] = useState(1);
  const [interpreting, setInterpreting] = useState(false);

  const clientRef = useRef<CaptionClient | null>(null);
  const callRef = useRef<CallPeer | null>(null);
  const micSourceRef = useRef<BrowserMicSource | null>(null);
  const interpretPlayerRef = useRef<InterpretPlayer | null>(null);
  const micLoopStop = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const joinedRef = useRef(false);
  const mutedRef = useRef(false);
  const pcmCountRef = useRef(0);
  const levelTickRef = useRef(0);
  const captionLangRef = useRef(captionLang);
  const peerIdRef = useRef(peerId);
  captionLangRef.current = captionLang;
  peerIdRef.current = peerId;

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

  const handleInterpret = useCallback((ev: InterpretEvent) => {
    // Only play remote speech translated into my listen language
    if (ev.speakerId === peerIdRef.current) return;
    if (ev.targetLang !== captionLangRef.current) return;
    if (!ev.data) return;

    const player = interpretPlayerRef.current;
    if (!player) return;

    if (ev.format === "pcm16" || ev.format === "wav") {
      // wav format from host is still raw pcm16 after gateway parse; both use PCM path
      void player.playPcm16Base64(ev.data, ev.sampleRate || 22050);
    }
  }, []);

  const ensureCall = useCallback(
    (remote: PeerInfo, local: MediaStream, client: CaptionClient, polite: boolean) => {
      if (callRef.current) return callRef.current;

      const call = new CallPeer(
        local,
        {
          onRemoteStream: (s) => {
            setRemoteStream(new MediaStream(s.getTracks()));
            setNeedClickToPlay(true);
            setStatus("Media arrived — tap video for sound");
          },
          onSignal: (payload) => client.signal(remote.peerId, payload),
          onConnectionState: (state) => {
            if (state === "connected") {
              setStatus("Connected — tap video if silent");
              setError(null);
            }
            if (state === "failed") {
              setError(
                "Video link failed (WebRTC). Same room + same wss gateway on both PCs? Tap Retry media. Also click the main video once (autoplay).",
              );
            }
            if (state === "disconnected") setStatus("Reconnecting…");
            if (state === "connecting") setStatus("Connecting media…");
          },
          onIceConnectionState: (state) => {
            setIceState(state);
            if (state === "failed" || state === "disconnected") {
              setStatus(`Network: ${state}`);
            }
            if (state === "connected" || state === "completed") {
              setStatus("Connected — tap video if silent");
            }
            if (state === "checking") setStatus("Finding network path…");
          },
          onDiagnostic: (line) => {
            setMediaDiag(line);
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

    const player = new InterpretPlayer();
    interpretPlayerRef.current = player;
    player.setHandlers({
      onPlayStart: () => {
        setRemoteVolume(DUCK_VOLUME);
        setInterpreting(true);
      },
      onPlayEnd: () => {
        setRemoteVolume(1);
        setInterpreting(false);
      },
    });

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
            interpretPlayerRef.current?.stop();
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
          onInterpret: handleInterpret,
          onError: (code, message) => {
            setError(`${code}: ${message}`);
          },
          onStats: (s) => {
            if (s.mtMs != null) setMtMs(s.mtMs);
            if (s.ttsMs != null) setTtsMs(s.ttsMs);
          },
        });

        // Captions: PCM → Mac Whisper only (no browser SpeechRecognition — it
        // steals the Windows mic and breaks WebRTC see/hear).
        const mic = new BrowserMicSource(async () => stream);
        micSourceRef.current = mic;
        (async () => {
          try {
            for await (const chunk of mic.start()) {
              if (micLoopStop.current) break;
              const now = Date.now();
              if (now - levelTickRef.current > 200) {
                levelTickRef.current = now;
                setMicLevel(mic.peak);
              }
              if (!joinedRef.current || !client.ready || mutedRef.current) continue;
              client.sendPcm(chunk.pcm);
              pcmCountRef.current += 1;
              setPcmSent(pcmCountRef.current);
            }
          } catch (err) {
            if (!cancelled) {
              console.error(err);
              setError(
                err instanceof Error
                  ? err.message
                  : "Mic capture for captions failed",
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
      interpretPlayerRef.current?.dispose();
      interpretPlayerRef.current = null;
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

  const retryMedia = () => {
    setError(null);
    setNeedClickToPlay(true);
    setStatus("Retrying media…");
    void callRef.current?.restartIce();
  };

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
  const ttsK = ttsKind(services);
  const ollamaTitle = services?.ollama
    ? `Translation ready (${services.ollamaModel ?? "model"})`
    : `Translation unavailable${services?.ollamaError ? `: ${services.ollamaError}` : ""}`;
  const sttTitle =
    services?.stt === "ready"
      ? `Speech recognition ready (${services.sttModel ?? "whisper"})`
      : services?.stt === "loading" || !services
        ? "Initializing speech recognition…"
        : `Speech recognition error${services?.sttError ? `: ${services.sttError}` : ""}`;
  const ttsTitle =
    services?.tts === "ready"
      ? `Spoken interpretation ready (${services.ttsEngine ?? "say"})`
      : services?.tts === "loading" || !services || services.tts == null
        ? "Checking host TTS…"
        : `Spoken interpretation unavailable${services?.ttsError ? `: ${services.ttsError}` : ""}`;

  const showSttLoading =
    services != null && services.stt === "loading";
  const showOllamaBad = services != null && !services.ollama;
  const showSttBad = services != null && (services.stt === "error" || services.stt === "unavailable");
  const showTtsBad =
    services != null &&
    services.tts != null &&
    (services.tts === "error" || services.tts === "unavailable");
  const hasAlerts =
    showSttLoading || showOllamaBad || showSttBad || showTtsBad || !!error;
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
                className={servicePillClass(ttsK)}
                title={ttsTitle}
                aria-label={ttsTitle}
              >
                {interpreting ? "Speaking…" : "Voice"}
              </span>
              <span
                className="room-stat"
                title={
                  mtMs != null || ttsMs != null
                    ? `MT ${mtMs ?? "—"} ms · TTS ${ttsMs ?? "—"} ms`
                    : "Interpreter delay"
                }
                aria-label={
                  mtMs != null ? `${mtMs} ms translate` : "No delay recorded"
                }
              >
                {mtMs != null ? `${mtMs} ms` : "—"}
              </span>
              <span
                className="room-stat"
                title={
                  pcmSent > 0
                    ? `Mic → gateway (${pcmSent} chunks). Level ${(micLevel * 100).toFixed(0)}%`
                    : "Mic feed idle"
                }
              >
                {pcmSent > 0
                  ? `Mic ${Math.min(99, Math.round(micLevel * 100))}%`
                  : "Mic —"}
              </span>
              {iceState && (
                <span
                  className="room-stat"
                  title={mediaDiag || `ICE ${iceState}`}
                >
                  ICE {iceState}
                </span>
              )}
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
            <code>npm run host:public</code> on this Mac, set Interpreter gateway
            to the printed <code>wss://…trycloudflare.com</code>, then Share
            access link.
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
                <span className="room-lan-label">Interpreter gateway</span>
                <code className="room-lan-value">
                  {buildLanGatewayUrl(lanHost)}
                </code>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={copyGatewayUrl}
                  aria-label="Copy interpreter gateway URL"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
          <p id="lan-join-hint" className="field-hint">
            On the other computer: open the session link, then paste the
            interpreter gateway address into the lobby.
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
              Translation isn&apos;t available right now. Spoken interpretation
              and subtitles need Ollama running on the host Mac.
            </div>
          )}
          {showSttBad && (
            <div className="banner warn" role="alert">
              Speech recognition couldn&apos;t start
              {services?.sttError ? `: ${services.sttError}` : ""}. Check that
              the gateway is running.
            </div>
          )}
          {showTtsBad && (
            <div className="banner warn" role="status">
              Spoken interpretation isn&apos;t available
              {services?.ttsError ? `: ${services.ttsError}` : ""}. Host TTS uses
              macOS <code>say</code> on the machine running the gateway.
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
          needClickToPlay={needClickToPlay}
          onUserPlay={() => setNeedClickToPlay(false)}
          remoteVolume={remoteVolume}
        />

        {showSubtitles && (
          <div className="caption-dock">
            <CaptionOverlay
              lines={captions}
              showOriginal={showOriginal}
              selfPeerId={peerId}
              docked
            />
          </div>
        )}
      </div>

      {remotePeer && (
        <div className="banner info" role="status">
          <strong>Can&apos;t see or hear?</strong>{" "}
          Click the big video once (browsers block sound until you tap). Then{" "}
          <button type="button" className="btn btn-secondary btn-compact" onClick={retryMedia}>
            Retry media
          </button>
          {iceState ? (
            <span className="muted"> · ICE: {iceState}{mediaDiag ? ` · ${mediaDiag}` : ""}</span>
          ) : null}
        </div>
      )}

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
            className="btn btn-ghost btn-media"
            onClick={retryMedia}
            aria-label="Retry video and audio connection"
          >
            Retry media
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
              checked={showSubtitles}
              onChange={(e) => {
                const on = e.target.checked;
                setShowSubtitles(on);
                localStorage.setItem(SUBTITLES_KEY, on ? "1" : "0");
              }}
            />
            Subtitles
          </label>
          {showSubtitles && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={showOriginal}
                onChange={(e) => setShowOriginal(e.target.checked)}
                aria-describedby="show-original-hint"
              />
              Show source language
            </label>
          )}
          <span id="show-original-hint" className="sr-only">
            Displays the original spoken text beneath each translated subtitle
          </span>
        </div>
        <div className="toolbar-langs">
          <div className="field">
            <label htmlFor="speak">I speak</label>
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
            <label htmlFor="caption">I listen in</label>
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
        Digital interpreter: you hear the other person spoken in your listen
        language (host Mac TTS). Original voice is ducked while translation
        plays. Subtitles optional. Nothing is recorded; processing stays on the
        host machine.
      </p>
    </div>
  );
}
