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
    return (
      <div
        className={`captions empty${docked ? " docked" : ""}`}
        role="status"
      >
        <span className="muted">
          Listening… speak clearly — captions appear here.
        </span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={`captions${docked ? " docked" : ""}`}
      aria-live="polite"
      aria-relevant="additions text"
      aria-atomic="false"
    >
      {visible.map((line, index) => {
        const isSelf = line.speakerId === selfPeerId;
        const isLatest = index === visible.length - 1;
        const stateLabel = line.isFinal ? "Final" : "In progress";
        return (
          <div
            key={line.id}
            className={[
              "caption-line",
              line.isFinal ? "final" : "partial",
              isSelf ? "self" : "remote",
              isLatest ? "latest" : "older",
            ].join(" ")}
            aria-label={`${line.speakerName}, ${stateLabel}: ${line.translatedText}`}
          >
            {isLatest && (
              <p className="caption-speaker-line">
                <span>{line.speakerName}</span>
                {!line.isFinal && (
                  <span className="caption-state partial" aria-hidden>
                    speaking
                  </span>
                )}
              </p>
            )}
            <p className="caption-text">{line.translatedText}</p>
            {showOriginal && line.sourceText !== line.translatedText && (
              <p className="caption-original" lang="auto">
                {line.sourceText}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
