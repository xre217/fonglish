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
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  mirror?: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
  }, [stream]);

  return (
    <div className="tile">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={mirror ? "mirror" : undefined}
      />
      {!stream && <div className="placeholder">{placeholder}</div>}
      <div className="label">{label}</div>
      <style jsx>{`
        .tile {
          position: relative;
          overflow: hidden;
          border-radius: 16px;
          background: #0a1020;
          border: 1px solid rgba(140, 170, 255, 0.14);
          aspect-ratio: 16 / 10;
          min-height: 180px;
        }
        video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          background: #05080f;
        }
        video.mirror {
          transform: scaleX(-1);
        }
        .placeholder {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          color: #93a0c2;
          font-size: 0.95rem;
          padding: 1rem;
          text-align: center;
        }
        .label {
          position: absolute;
          left: 0.7rem;
          bottom: 0.7rem;
          padding: 0.25rem 0.55rem;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.55);
          font-size: 0.78rem;
          font-weight: 600;
        }
      `}</style>
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
    <div className="stage">
      <VideoTile
        stream={remoteStream}
        label={remoteName ?? "Waiting for peer…"}
        placeholder="Share the room link with the other person"
      />
      <VideoTile
        stream={camOff ? null : localStream}
        label={`${localName}${muted ? " (muted)" : ""}`}
        muted
        mirror
        placeholder="Camera off"
      />
      <style jsx>{`
        .stage {
          display: grid;
          grid-template-columns: 1.4fr 0.9fr;
          gap: 0.85rem;
        }
        @media (max-width: 800px) {
          .stage {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
