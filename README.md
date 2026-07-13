# Fonglish

Real-time **bilingual subtitles** for 1:1 video calls.

- Browser **WebRTC** call (camera + mic)
- Each speaker streams **their own mic** to a Node **caption gateway**
- **xAI Speech-to-Text** (streaming) → **Grok translation** → live captions
- Designed so a later **Zoom/Meet companion** can reuse the same gateway by swapping only the audio source

## Quick start

```bash
cd /Users/trefong/Projects/fonglish
cp .env.example .env
# put your key in .env:
# XAI_API_KEY=xai-...

npm install

# terminal 1
npm run gateway

# terminal 2
npm run web
```

Open http://localhost:3000 in two browser profiles (or two machines).

1. Create a room on one side → **Copy invite link**
2. Open the link on the other side (set name + languages on the lobby, or join via room ID)
3. Allow camera/mic
4. Speak — captions appear under the video, translated into each person’s **Captions in** language

## Architecture

```
Browser A ──WebRTC A/V── Browser B
   │ mic PCM                    │ mic PCM
   └──────────► Gateway ◄───────┘
                  │
          xAI STT stream + Grok MT
                  │
            CaptionEvent (WS)
```

### Packages

| Path | Role |
|------|------|
| `apps/web` | Next.js lobby + call UI |
| `packages/gateway` | WebSocket signaling + STT/MT pipeline |
| `packages/shared` | Protocol types, languages |
| `packages/audio` | `AudioSource` interface + `BrowserMicSource` |

### Companion-ready seam

```ts
interface AudioSource {
  start(): AsyncIterable<AudioChunk>; // PCM16 mono @ 16 kHz
  stop(): Promise<void>;
}
// v1: BrowserMicSource
// later: DesktopSystemAudioSource (system/call audio)
```

Gateway protocol stays the same: binary PCM frames in → `caption` events out.

## Environment

| Variable | Default | Notes |
|----------|---------|--------|
| `XAI_API_KEY` | — | Required for STT + translation |
| `GATEWAY_PORT` | `8787` | Caption gateway |
| `NEXT_PUBLIC_GATEWAY_URL` | `ws://localhost:8787` | Browser WS URL |
| `XAI_MT_MODEL` | `grok-4.5` | Translation model |

Get a key: https://console.x.ai

## Protocol (summary)

Client → gateway JSON: `join`, `leave`, `update_langs`, `signal`, `mute`  
Client → gateway binary: raw PCM16 LE mono @ 16 kHz (~100 ms chunks)  
Gateway → client: `welcome`, `peer_joined`, `peer_left`, `signal`, `caption`, `error`, `stats`

## Privacy note

This MVP streams call audio to xAI for transcription and sends utterance text to Grok for translation. A consent banner is shown in-call. No server-side transcript store is implemented.

## Out of scope (v1)

- Group calls (3+)
- Spoken dubbing / voice replacement
- Zoom/Meet overlay (designed, not built)
- Accounts / auth

## Troubleshooting

| Symptom | Check |
|---------|--------|
| “WebSocket error” | Gateway running? `curl http://localhost:8787/health` |
| No captions | `XAI_API_KEY` set? Gateway logs show `[stt] ready`? Mic unmuted? |
| No remote video | Allow camera; try same Wi‑Fi; check browser console for ICE errors |
| Room full | v1 is 1:1 — only two peers per room |

## License

Private / experimental.
