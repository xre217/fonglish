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
  muted,
  mirror,
  placeholder,
  pip,
}: {
  stream: MediaStream | null;
  label: string;
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
      />
      {!stream && <div className="placeholder">{placeholder}</div>}
      <div className="video-label">{label}</div>
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
  const localLabel = [
    localName,
    muted ? "audio muted" : null,
    camOff ? "video off" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="video-stage">
      <VideoTile
        stream={remoteStream}
        label={remoteName ?? "Participant"}
        placeholder={
          waitingForPeer
            ? "Awaiting participant"
            : "Establishing connection"
        }
      />
      <VideoTile
        stream={camOff ? null : localStream}
        label={localLabel}
        muted
        mirror
        pip
        placeholder="Video disabled"
      />
    </div>
  );
}
