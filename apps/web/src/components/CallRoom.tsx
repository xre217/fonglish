"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserMicSource } from "@fonglish/audio";
import { LANGUAGES, type CaptionEvent, type LangCode, type PeerInfo } from "@fonglish/shared";
import { CaptionClient } from "@/lib/caption-client";
import { CallPeer, getMediaStream } from "@/lib/webrtc";
import { CaptionOverlay, type CaptionLine } from "./CaptionOverlay";
import { VideoStage } from "./VideoStage";

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
          onWelcome: (peers) => {
            setStatus(peers.length ? "Connecting media…" : "Waiting for peer…");
            const other = peers[0] ?? null;
            setRemotePeer(other);
            if (other && streamRef.current) {
              // Existing peer: we are the joiner → make offer (impolite initiator)
              const call = ensureCall(other, streamRef.current, client, false);
              void call.createOffer();
            }
          },
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
      setStatus("Invite link copied");
      setTimeout(() => setStatus(remotePeer ? "Connected" : "Waiting for peer…"), 2000);
    } catch {
      setError("Could not copy link");
    }
  };

  const statusKind = error
    ? "error"
    : status === "Connected"
      ? "connected"
      : "waiting";

  return (
    <div className="room">
      <header className="room-header">
        <div>
          <div className="room-brand">Fonglish</div>
          <div className="room-meta muted">
            <code className="room-id">{roomId}</code>
            <span className={`status-pill ${statusKind}`}>
              <span className="status-dot" />
              {status}
            </span>
            {mtMs != null && <span>MT {mtMs}ms</span>}
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

      <div className="banner">
        This call is transcribed and translated in real time. Audio is sent to the
        caption gateway for processing. Nothing is stored.
      </div>

      {error && (
        <div className="banner warn" role="alert">
          {error}
        </div>
      )}

      <VideoStage
        localStream={localStream}
        remoteStream={remoteStream}
        localName={displayName}
        remoteName={remotePeer?.displayName ?? null}
        muted={muted}
        camOff={camOff}
      />

      <CaptionOverlay
        lines={captions}
        showOriginal={showOriginal}
        selfPeerId={peerId}
      />

      <div className="toolbar card">
        <div className="toolbar-controls">
          <button
            type="button"
            className={`btn btn-ghost btn-icon${muted ? " active" : ""}`}
            onClick={toggleMute}
            title={muted ? "Unmute" : "Mute"}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          >
            {muted ? "🔇" : "🎤"}
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-icon${camOff ? " active" : ""}`}
            onClick={toggleCam}
            title={camOff ? "Turn camera on" : "Turn camera off"}
            aria-label={camOff ? "Turn camera on" : "Turn camera off"}
          >
            {camOff ? "📷" : "🎥"}
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(e) => setShowOriginal(e.target.checked)}
            />
            Show original
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
