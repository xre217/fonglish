"use client";

import { useEffect, useRef } from "react";

type Props = {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  localName: string;
  remoteName: string | null;
  muted: boolean;
  camOff: boolean;
  waitingForPeer?: boolean;
};

function VideoTile({
  stream,
  label,
  ariaLabel,
  muted,
  mirror,
  placeholder,
  pip,
}: {
  stream: MediaStream | null;
  label: string;
  ariaLabel: string;
  muted?: boolean;
  mirror?: boolean;
  placeholder: string;
  pip?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
  }, [stream]);

  return (
    <div className={`video-tile${pip ? " pip" : ""}`}>
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
}: Props) {
  const remotePlaceholder = waitingForPeer
    ? "Waiting for your guest"
    : "Connecting…";

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

  return (
    <div className="video-stage" role="region" aria-label="Video conference">
      <VideoTile
        stream={remoteStream}
        label={remoteName ?? "Participant"}
        ariaLabel={`${remoteName ?? "Participant"} video`}
        placeholder={remotePlaceholder}
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
