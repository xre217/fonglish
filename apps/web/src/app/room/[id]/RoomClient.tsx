"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { isLangCode, type LangCode } from "@fonglish/shared";
import { CallRoom } from "@/components/CallRoom";
import { randomId } from "@/lib/ids";

export function RoomClient({ roomId }: { roomId: string }) {
  const search = useSearchParams();

  const displayName = search.get("name")?.trim() || "Guest";
  const speakRaw = search.get("speak") ?? "en";
  const captionRaw = search.get("caption") ?? "es";
  const speakLang: LangCode = isLangCode(speakRaw) ? speakRaw : "en";
  const captionLang: LangCode = isLangCode(captionRaw) ? captionRaw : "es";

  const peerId = useMemo(() => {
    if (typeof window === "undefined") return randomId("peer");
    const key = `fong_peer_${roomId}`;
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = randomId("peer");
    sessionStorage.setItem(key, id);
    return id;
  }, [roomId]);

  return (
    <CallRoom
      roomId={roomId}
      displayName={displayName}
      speakLang={speakLang}
      captionLang={captionLang}
      peerId={peerId}
    />
  );
}
