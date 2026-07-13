import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { WebSocketServer, type WebSocket } from "ws";
import {
  isLangCode,
  type ClientMessage,
  type LangCode,
} from "@fonglish/shared";
import {
  broadcast,
  getOrCreateRoom,
  getRoom,
  peerInfo,
  removePeer,
  send,
  type RoomPeer,
} from "./rooms.js";
import { SpeakerPipeline } from "./pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load monorepo root .env
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv({ path: path.resolve(__dirname, "../../../.env.local") });

const PORT = Number(process.env.GATEWAY_PORT ?? 8787);
const HOST = process.env.GATEWAY_HOST ?? "0.0.0.0";

type SocketState = {
  peerId: string | null;
  roomId: string | null;
  pipeline: SpeakerPipeline | null;
};

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, hasKey: Boolean(process.env.XAI_API_KEY) }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("fonglish gateway\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const state: SocketState = {
    peerId: null,
    roomId: null,
    pipeline: null,
  };

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      handleBinary(ws, state, raw as Buffer);
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      send(ws, { type: "error", code: "bad_json", message: "Invalid JSON" });
      return;
    }
    void handleJson(ws, state, msg);
  });

  ws.on("close", () => {
    void cleanup(state);
  });

  ws.on("error", (err) => {
    console.warn("[ws] error", err.message);
  });
});

function handleBinary(_ws: WebSocket, state: SocketState, buf: Buffer): void {
  if (!state.pipeline) return;
  state.pipeline.pushPcm(buf);
}

async function handleJson(
  ws: WebSocket,
  state: SocketState,
  msg: ClientMessage,
): Promise<void> {
  switch (msg.type) {
    case "join": {
      if (!msg.roomId || !msg.peerId) {
        send(ws, {
          type: "error",
          code: "bad_join",
          message: "roomId and peerId required",
        });
        return;
      }
      if (!isLangCode(msg.speakLang) || !isLangCode(msg.captionLang)) {
        send(ws, {
          type: "error",
          code: "bad_lang",
          message: "Invalid language code",
        });
        return;
      }

      // Leave previous room if any
      await cleanup(state);

      const room = getOrCreateRoom(msg.roomId);
      if (room.peers.size >= 2 && !room.peers.has(msg.peerId)) {
        send(ws, {
          type: "error",
          code: "room_full",
          message: "This room already has 2 participants (v1 is 1:1)",
        });
        return;
      }

      const peer: RoomPeer = {
        peerId: msg.peerId,
        displayName: msg.displayName?.trim() || "Guest",
        speakLang: msg.speakLang as LangCode,
        captionLang: msg.captionLang as LangCode,
        muted: false,
        ws,
      };
      room.peers.set(peer.peerId, peer);
      state.peerId = peer.peerId;
      state.roomId = room.roomId;
      state.pipeline = new SpeakerPipeline(room, peer);

      const others = [...room.peers.values()]
        .filter((p) => p.peerId !== peer.peerId)
        .map(peerInfo);

      send(ws, {
        type: "welcome",
        peerId: peer.peerId,
        roomId: room.roomId,
        peers: others,
      });

      broadcast(
        room,
        { type: "peer_joined", peer: peerInfo(peer) },
        peer.peerId,
      );

      console.log(
        `[room ${room.roomId}] ${peer.displayName} joined (${room.peers.size} peers)`,
      );
      return;
    }

    case "leave": {
      await cleanup(state);
      return;
    }

    case "update_langs": {
      if (!state.roomId || !state.peerId) return;
      const room = getOrCreateRoom(state.roomId);
      const peer = room.peers.get(state.peerId);
      if (!peer) return;
      if (!isLangCode(msg.speakLang) || !isLangCode(msg.captionLang)) return;

      peer.captionLang = msg.captionLang;
      state.pipeline?.updateLangs(msg.speakLang, msg.captionLang);
      peer.speakLang = msg.speakLang;

      broadcast(room, { type: "peer_updated", peer: peerInfo(peer) });
      return;
    }

    case "signal": {
      if (!state.roomId || !state.peerId) return;
      const room = getOrCreateRoom(state.roomId);
      const target = room.peers.get(msg.targetId);
      if (!target) return;
      send(target.ws, {
        type: "signal",
        fromId: state.peerId,
        payload: msg.payload,
      });
      return;
    }

    case "mute": {
      if (!state.roomId || !state.peerId) return;
      const room = getOrCreateRoom(state.roomId);
      const peer = room.peers.get(state.peerId);
      if (!peer) return;
      peer.muted = msg.muted;
      broadcast(room, { type: "peer_updated", peer: peerInfo(peer) });
      return;
    }

    case "audio.meta":
    case "audio.end":
      // Optional metadata; binary frames carry PCM
      return;

    default:
      send(ws, {
        type: "error",
        code: "unknown",
        message: `Unknown message type`,
      });
  }
}

async function cleanup(state: SocketState): Promise<void> {
  if (state.pipeline) {
    await state.pipeline.close();
    state.pipeline = null;
  }
  if (state.roomId && state.peerId) {
    const roomId = state.roomId;
    const peerId = state.peerId;
    const left = removePeer(roomId, peerId);
    if (left) {
      // removePeer deletes empty rooms; only notify remaining peers
      const room = getRoom(roomId);
      if (room && room.peers.size > 0) {
        broadcast(room, { type: "peer_left", peerId });
      }
      console.log(`[room ${roomId}] ${peerId} left`);
    }
  }
  state.peerId = null;
  state.roomId = null;
}

server.listen(PORT, HOST, () => {
  console.log(`fonglish gateway on ws://${HOST}:${PORT}`);
  console.log(
    process.env.XAI_API_KEY
      ? "XAI_API_KEY: set"
      : "XAI_API_KEY: MISSING — STT/MT will fail until set in .env",
  );
});
