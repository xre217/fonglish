"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CaptionEvent } from "@fonglish/shared";

export type CaptionLine = CaptionEvent & { id: string };

type Props = {
  lines: CaptionLine[];
  showOriginal: boolean;
  selfPeerId: string | null;
  docked?: boolean;
};

export function CaptionOverlay({
  lines,
  showOriginal,
  selfPeerId,
  docked = false,
}: Props) {
  const visible = useMemo(
    () => lines.slice(docked ? -2 : -4),
    [lines, docked],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const tail = visible[visible.length - 1];
  const tailKey = tail ? `${tail.id}:${tail.isFinal}` : "";
  const tailText = tail?.translatedText ?? "";

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [tailKey, tailText]);

  if (visible.length === 0) {
    if (docked) return null;
    return (
      <div className="captions empty">
        <span className="muted">Captions will appear when dialogue begins.</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={`captions${docked ? " docked" : ""}`}
      aria-live="polite"
    >
      {visible.map((line, index) => {
        const isSelf = line.speakerId === selfPeerId;
        const isLatest = index === visible.length - 1;
        return (
          <div
            key={line.id}
            className={[
              "caption-line",
              line.isFinal ? "final" : "partial",
              isSelf ? "self" : "remote",
              isLatest ? "latest" : "older",
            ].join(" ")}
          >
            {isLatest && (
              <p className="caption-speaker-line">{line.speakerName}</p>
            )}
            <p className="caption-text">{line.translatedText}</p>
            {showOriginal && line.sourceText !== line.translatedText && (
              <p className="caption-original">{line.sourceText}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
