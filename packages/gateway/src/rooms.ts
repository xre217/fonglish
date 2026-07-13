import type { WebSocket } from "ws";
import type { LangCode, PeerInfo, ServerMessage } from "@fonglish/shared";

export type RoomPeer = {
  peerId: string;
  displayName: string;
  speakLang: LangCode;
  captionLang: LangCode;
  muted: boolean;
  ws: WebSocket;
};

export type Room = {
  roomId: string;
  peers: Map<string, RoomPeer>;
};

const rooms = new Map<string, Room>();

export function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = { roomId, peers: new Map() };
    rooms.set(roomId, room);
  }
  return room;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function removePeer(roomId: string, peerId: string): RoomPeer | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  const peer = room.peers.get(peerId);
  room.peers.delete(peerId);
  if (room.peers.size === 0) rooms.delete(roomId);
  return peer;
}

export function peerInfo(p: RoomPeer): PeerInfo {
  return {
    peerId: p.peerId,
    displayName: p.displayName,
    speakLang: p.speakLang,
    captionLang: p.captionLang,
    muted: p.muted,
  };
}

export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function broadcast(
  room: Room,
  msg: ServerMessage,
  exceptPeerId?: string,
): void {
  for (const p of room.peers.values()) {
    if (exceptPeerId && p.peerId === exceptPeerId) continue;
    send(p.ws, msg);
  }
}

/** Send a caption to peers who want captions in a specific language mapping. */
export function broadcastCaption(
  room: Room,
  fromSpeakerId: string,
  buildForViewer: (viewer: RoomPeer) => ServerMessage | null,
): void {
  for (const viewer of room.peers.values()) {
    if (viewer.peerId === fromSpeakerId) {
      // Also show own captions (optional UX: helpful for confidence)
      const msg = buildForViewer(viewer);
      if (msg) send(viewer.ws, msg);
      continue;
    }
    const msg = buildForViewer(viewer);
    if (msg) send(viewer.ws, msg);
  }
}

/**
 * Send spoken interpretation only to remote peers listening in `targetLang`.
 * Never sends to the speaker (avoids self-echo of translated speech).
 */
export function sendInterpretToListeners(
  room: Room,
  fromSpeakerId: string,
  targetLang: LangCode,
  msg: ServerMessage,
): void {
  for (const viewer of room.peers.values()) {
    if (viewer.peerId === fromSpeakerId) continue;
    if (viewer.captionLang !== targetLang) continue;
    send(viewer.ws, msg);
  }
}
