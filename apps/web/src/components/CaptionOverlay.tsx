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
        <span className="muted">Captions appear here when someone speaks…</span>
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
              <span className="caption-speaker">{line.speakerName}</span>
              {!line.isFinal && <span className="caption-live">live</span>}
            </div>
            <div className="caption-text">{line.translatedText}</div>
            {showOriginal && line.sourceText !== line.translatedText && (
              <div className="caption-original">{line.sourceText}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
