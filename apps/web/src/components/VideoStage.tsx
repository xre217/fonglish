"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  localName: string;
  remoteName: string | null;
  muted: boolean;
  camOff: boolean;
  waitingForPeer?: boolean;
  /** Show a strong "tap for sound" affordance until remote audio unlocks. */
  needClickToPlay?: boolean;
  onUserPlay?: () => void;
};

function VideoTile({
  stream,
  label,
  ariaLabel,
  muted,
  mirror,
  placeholder,
  pip,
  forcePlayToken,
  showPlayHint,
  onPlayClick,
}: {
  stream: MediaStream | null;
  label: string;
  ariaLabel: string;
  muted?: boolean;
  mirror?: boolean;
  placeholder: string;
  pip?: boolean;
  forcePlayToken?: number;
  showPlayHint?: boolean;
  onPlayClick?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (!stream) {
      setBlocked(false);
      return;
    }
    el.volume = 1;
    const p = el.play();
    if (p !== undefined) {
      void p
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    }
  }, [stream, forcePlayToken, muted]);

  const tryPlay = () => {
    const el = ref.current;
    if (!el) return;
    el.muted = Boolean(muted);
    el.volume = 1;
    void el
      .play()
      .then(() => {
        setBlocked(false);
        onPlayClick?.();
      })
      .catch(() => setBlocked(true));
  };

  const needsHint = Boolean(stream && !muted && (blocked || showPlayHint));

  return (
    <div
      className={`video-tile${pip ? " pip" : ""}${needsHint ? " needs-play" : ""}`}
      onClick={tryPlay}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") tryPlay();
      }}
      role={stream && !muted ? "button" : undefined}
      tabIndex={stream && !muted ? 0 : undefined}
      title={
        stream && !muted
          ? "Click to play video/audio if black or silent"
          : undefined
      }
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={mirror ? "mirror" : undefined}
        aria-label={ariaLabel}
      />
      {!stream && (
        <div className="placeholder" role="status" aria-live="polite">
          {placeholder}
        </div>
      )}
      {needsHint && (
        <div className="play-gate" role="status">
          <span className="play-gate-btn">Tap for video &amp; sound</span>
        </div>
      )}
      <div className="video-label" aria-hidden>
        {label}
      </div>
    </div>
  );
}

export function VideoStage({
  localStream,
  remoteStream,
  localName,
  remoteName,
  muted,
  camOff,
  waitingForPeer = false,
  needClickToPlay = false,
  onUserPlay,
}: Props) {
  const [playToken, setPlayToken] = useState(0);
  const remotePlaceholder = waitingForPeer
    ? "Waiting for your guest"
    : "Connecting media…";

  const localLabel = [
    localName,
    muted ? "audio muted" : null,
    camOff ? "video off" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const localAria = [
    `Your video, ${localName}`,
    muted ? "microphone muted" : null,
    camOff ? "camera off" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const remoteTrackInfo = remoteStream
    ? [
        remoteStream.getVideoTracks().length ? "video" : "no-video",
        remoteStream.getAudioTracks().length ? "audio" : "no-audio",
      ].join(" · ")
    : null;

  return (
    <div
      className={[
        "video-stage",
        remoteStream ? "has-remote" : "",
        waitingForPeer && !remoteStream ? "waiting" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="region"
      aria-label="Video conference"
    >
      <VideoTile
        stream={remoteStream}
        label={
          remoteTrackInfo
            ? `${remoteName ?? "Participant"} · ${remoteTrackInfo}`
            : (remoteName ?? "Participant")
        }
        ariaLabel={`${remoteName ?? "Participant"} video`}
        placeholder={remotePlaceholder}
        forcePlayToken={playToken}
        showPlayHint={needClickToPlay && Boolean(remoteStream)}
        onPlayClick={() => {
          setPlayToken((n) => n + 1);
          onUserPlay?.();
        }}
      />
      <VideoTile
        stream={camOff ? null : localStream}
        label={localLabel}
        ariaLabel={localAria}
        muted
        mirror
        pip
        placeholder="Camera off"
      />
    </div>
  );
}
