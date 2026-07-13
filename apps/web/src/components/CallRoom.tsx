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
import { CallPeer, getMediaStream } from "@/lib/webrtc";
import { CaptionOverlay, type CaptionLine } from "./CaptionOverlay";
import { VideoStage } from "./VideoStage";

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

  const clientRef = useRef<CaptionClient | null>(null);
  const callRef = useRef<CallPeer | null>(null);
  const micSourceRef = useRef<BrowserMicSource | null>(null);
  const micLoopStop = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/room/${encodeURIComponent(roomId)}`;
  }, [roomId]);

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
            if (state === "connected") setStatus("Connected");
            if (state === "failed") setError("WebRTC connection failed");
            if (state === "disconnected") setStatus("Reconnecting…");
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

        // Stream mic PCM to gateway for STT (own mic only)
        const mic = new BrowserMicSource(async () => stream);
        micSourceRef.current = mic;
        (async () => {
          try {
            for await (const chunk of mic.start()) {
              if (micLoopStop.current) break;
              client.sendPcm(chunk.pcm);
            }
          } catch (err) {
            if (!cancelled) {
              console.error(err);
              setError(
                err instanceof Error ? err.message : "Mic capture failed",
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
      void micSourceRef.current?.stop();
      callRef.current?.close();
      client.leave();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per room
  }, [roomId, peerId, displayName]);

  useEffect(() => {
    clientRef.current?.updateLangs(speakLang, captionLang);
  }, [speakLang, captionLang]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    callRef.current?.setMicEnabled(!next);
    clientRef.current?.setMuted(next);
  };

  const toggleCam = () => {
    const next = !camOff;
    setCamOff(next);
    callRef.current?.setCamEnabled(!next);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyToast(true);
      window.setTimeout(() => setCopyToast(false), 2000);
    } catch {
      setError("Could not copy link");
    }
  };

  const statusKind = error
    ? "error"
    : status === "Connected"
      ? "connected"
      : "waiting";

  const statusLabel =
    statusKind === "error"
      ? "Error"
      : statusKind === "connected"
        ? "Connected"
        : "Waiting";

  const ollamaK = ollamaKind(services);
  const sttK = sttKind(services);
  const ollamaTitle = services?.ollama
    ? `Ollama ready (${services.ollamaModel ?? "model"})`
    : `Ollama offline${services?.ollamaError ? `: ${services.ollamaError}` : " — start ollama and pull model"}`;
  const sttTitle =
    services?.stt === "ready"
      ? `STT ready (${services.sttModel ?? "whisper"})`
      : services?.stt === "loading" || !services
        ? "Loading Whisper STT…"
        : `STT error${services?.sttError ? `: ${services.sttError}` : ""}`;

  const showSttLoading =
    services != null && services.stt === "loading";
  const showOllamaBad = services != null && !services.ollama;
  const showSttBad = services != null && (services.stt === "error" || services.stt === "unavailable");
  const hasAlerts = showSttLoading || showOllamaBad || showSttBad || !!error;

  return (
    <div className="room">
      {copyToast && (
        <div className="toast" role="status">
          Invite link copied
        </div>
      )}
      <header className="room-header">
        <div className="room-header-main">
          <div className="room-brand">Fonglish</div>
          <div className="room-meta muted">
            <div className="room-meta-row">
              <code className="room-id" title={roomId}>
                {roomId}
              </code>
              <span
                className={`status-pill ${statusKind}`}
                title={status}
                aria-label={`Call status: ${status}`}
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
                STT
              </span>
              <span
                className={servicePillClass(ollamaK)}
                title={ollamaTitle}
                aria-label={ollamaTitle}
              >
                MT
              </span>
              <span
                className="room-stat"
                title={mtMs != null ? `Translation latency ${mtMs}ms` : "Translation latency"}
                aria-label={mtMs != null ? `${mtMs} ms` : "No latency yet"}
              >
                {mtMs != null ? `${mtMs}ms` : "—"}
              </span>
            </div>
          </div>
        </div>
        <div className="room-actions">
          <button type="button" className="btn btn-ghost" onClick={copyLink}>
            Copy invite
          </button>
          <a className="btn btn-ghost" href="/">
            Leave
          </a>
        </div>
      </header>

      <p className="consent-note">
        Captions run locally (Whisper + Ollama). Nothing is saved.
      </p>

      {hasAlerts && (
        <div className="room-alerts">
          {showSttLoading && (
            <div className="banner info" role="status">
              Loading local Whisper STT… first run may download the model.
            </div>
          )}
          {showOllamaBad && (
            <div className="banner warn" role="status">
              Ollama not ready
              {services?.ollamaModel ? ` (need ${services.ollamaModel})` : ""}.
              Start it and run{" "}
              <code>ollama pull {services?.ollamaModel ?? "llama3.2:3b"}</code>.
              Same-language captions still work; translation will fail until fixed.
            </div>
          )}
          {showSttBad && (
            <div className="banner warn" role="alert">
              Local STT failed to load
              {services?.sttError ? `: ${services.sttError}` : ""}.
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

      <div className="toolbar card">
        <div className="toolbar-controls">
          <button
            type="button"
            className={`btn btn-ghost btn-media${muted ? " off" : ""}`}
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          >
            <span className="media-glyph mic" aria-hidden />
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-media${camOff ? " off" : ""}`}
            onClick={toggleCam}
            aria-pressed={camOff}
            aria-label={camOff ? "Turn camera on" : "Turn camera off"}
          >
            <span className="media-glyph cam" aria-hidden />
            {camOff ? "Camera on" : "Camera off"}
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(e) => setShowOriginal(e.target.checked)}
            />
            Original
          </label>
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
            <label htmlFor="caption">Captions in</label>
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
    </div>
  );
}
