"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CaptionEvent } from "@fonglish/shared";

export type CaptionLine = CaptionEvent & { id: string };

type Props = {
  lines: CaptionLine[];
  showOriginal: boolean;
  selfPeerId: string | null;
  /** Overlay on video (CallRoom call-stage). Hides empty state; fewer lines. */
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
  const tailKey = tail ? `${tail.id}:${tail.translatedText}:${tail.isFinal}` : "";

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [tailKey]);

  if (visible.length === 0) {
    if (docked) return null;
    return (
      <div className="captions empty">
        <span className="muted">Captions appear here when someone speaks…</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={`captions${docked ? " docked" : ""}`}
      aria-live="polite"
      aria-relevant="additions text"
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
            {(docked ? isLatest : true) && (
              <div className="caption-meta">
                <span className="caption-speaker">{line.speakerName}</span>
                <span
                  className={`caption-state${line.isFinal ? " final" : " partial"}`}
                >
                  {line.isFinal ? "done" : "live"}
                </span>
              </div>
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
