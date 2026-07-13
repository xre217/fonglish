"use client";

import type { CaptionEvent } from "@fonglish/shared";

export type CaptionLine = CaptionEvent & { id: string };

type Props = {
  lines: CaptionLine[];
  showOriginal: boolean;
  selfPeerId: string | null;
};

export function CaptionOverlay({ lines, showOriginal, selfPeerId }: Props) {
  const visible = lines.slice(-4);

  if (visible.length === 0) {
    return (
      <div className="captions empty">
        <span className="muted">Captions will appear here when someone speaks…</span>
      </div>
    );
  }

  return (
    <div className="captions" aria-live="polite">
      {visible.map((line) => {
        const isSelf = line.speakerId === selfPeerId;
        return (
          <div
            key={line.id}
            className={`caption-line ${line.isFinal ? "final" : "partial"} ${isSelf ? "self" : "remote"}`}
          >
            <div className="caption-meta">
              <span className="speaker">{line.speakerName}</span>
              {!line.isFinal && <span className="live">live</span>}
            </div>
            <div className="caption-text">{line.translatedText}</div>
            {showOriginal && line.sourceText !== line.translatedText && (
              <div className="caption-original">{line.sourceText}</div>
            )}
          </div>
        );
      })}
      <style jsx>{`
        .captions {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          max-height: 220px;
          overflow: hidden;
          padding: 0.85rem 1rem;
          border-radius: 14px;
          background: linear-gradient(
            180deg,
            rgba(4, 8, 18, 0.2),
            rgba(4, 8, 18, 0.82)
          );
          border: 1px solid rgba(140, 170, 255, 0.12);
        }
        .captions.empty {
          align-items: center;
          justify-content: center;
          min-height: 72px;
        }
        .caption-line {
          padding: 0.45rem 0.55rem;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.04);
        }
        .caption-line.partial {
          opacity: 0.85;
        }
        .caption-line.remote {
          border-left: 3px solid #6ea8ff;
        }
        .caption-line.self {
          border-left: 3px solid #8b5cf6;
        }
        .caption-meta {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          margin-bottom: 0.15rem;
        }
        .speaker {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #93a0c2;
          font-weight: 700;
        }
        .live {
          font-size: 0.65rem;
          color: #3dd68c;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .caption-text {
          font-size: 1.05rem;
          line-height: 1.35;
          font-weight: 600;
        }
        .caption-original {
          margin-top: 0.2rem;
          font-size: 0.85rem;
          color: #93a0c2;
        }
      `}</style>
    </div>
  );
}
