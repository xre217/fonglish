"use client";

import { useEffect, useRef } from "react";

type Props = {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  localName: string;
  remoteName: string | null;
  muted: boolean;
  camOff: boolean;
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
      <div className="label">{label}</div>
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
}: Props) {
  return (
    <div className="video-stage">
      <VideoTile
        stream={remoteStream}
        label={remoteName ?? "Waiting for peer…"}
        placeholder="Share the invite link to start the call"
      />
      <VideoTile
        stream={camOff ? null : localStream}
        label={`${localName}${muted ? " · muted" : ""}`}
        muted
        mirror
        pip
        placeholder="Camera off"
      />
    </div>
  );
}
