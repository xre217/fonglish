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
  name,
  role,
  muted,
  mirror,
  placeholder,
  pip,
  showMuted,
  showCamOff,
}: {
  stream: MediaStream | null;
  name: string;
  role: "you" | "peer";
  muted?: boolean;
  mirror?: boolean;
  placeholder: string;
  pip?: boolean;
  showMuted?: boolean;
  showCamOff?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
  }, [stream]);

  return (
    <div
      className={[
        "video-tile",
        pip ? "pip" : "",
        role === "you" ? "local" : "remote-tile",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={mirror ? "mirror" : undefined}
      />
      {!stream && <div className="placeholder">{placeholder}</div>}
      <div className="video-label">
        <span className={`video-role${role === "you" ? " you" : ""}`}>
          {role === "you" ? "You" : "Peer"}
        </span>
        <span className="video-name">{name}</span>
        {(showMuted || showCamOff) && (
          <span className="video-badges">
            {showMuted && <span className="video-badge off">Mic off</span>}
            {showCamOff && <span className="video-badge off">Cam off</span>}
          </span>
        )}
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
}: Props) {
  return (
    <div className="video-stage">
      <VideoTile
        stream={remoteStream}
        name={remoteName ?? "Waiting…"}
        role="peer"
        placeholder="Share the invite link to start the call"
      />
      <VideoTile
        stream={camOff ? null : localStream}
        name={localName}
        role="you"
        muted
        mirror
        pip
        showMuted={muted}
        showCamOff={camOff}
        placeholder="Camera is off"
      />
    </div>
  );
}
