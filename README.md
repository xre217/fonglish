# Fonglish

Real-time **bilingual subtitles** for 1:1 video calls.

Private **caption companion** direction: works **alongside** video apps (Zoom, Meet, etc.) long-term. Today’s ship is a **browser WebRTC harness** + local gateway so you can test STT/MT without cloud tokens.

- Browser **WebRTC** call (camera + mic)
- Each speaker streams **their own mic** to a Node **caption gateway**
- **Local Whisper STT** (energy VAD + Transformers.js) → **Ollama translation** → live captions
- **Windows / macOS / Linux** supported for the current stack (Node + browser)
- Designed so a later **desktop companion** reuses the same gateway by swapping only the audio source

## Prerequisites

| Tool | Notes |
|------|--------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) — Windows: LTS installer is fine |
| **npm** | Bundled with Node |
| **Ollama** | [ollama.com](https://ollama.com) — Windows desktop app or install script |
| **Browser** | Chrome, Edge, or Chromium (best WebRTC + mic support) |

Pull a chat model (balanced preset uses `llama3`):

```bash
ollama pull llama3          # recommended for translation quality
# optional smaller/faster: ollama pull llama3.2:3b
```

## Windows one-click (no guest setup)

**Windows guest:** open one HTTPS link — no Node, no Chrome flags.  
**Mac host:** must stay online (runs Whisper + Ollama + free Cloudflare tunnel).

```bash
# Terminal 1 — caption brain
npm run gateway

# Terminal 2 — public WSS tunnel (free Cloudflare quick tunnel)
npm run host:public
```

When the tunnel prints `wss://….trycloudflare.com`:

1. On the Mac open http://127.0.0.1:3000 (or the Vercel lobby).
2. Paste that **wss://** URL into **Caption gateway**.
3. Start a session → **Share access link**.
4. Send that link to Windows. It looks like:

```text
https://fonglish.vercel.app/room/<id>?gw=wss://xxxx.trycloudflare.com
```

Guest clicks → camera works (HTTPS) → joins your Mac gateway through the tunnel.

| Role | Needs |
|------|--------|
| Mac host | `gateway` + `host:public` running |
| Windows guest | Browser only + the shared link |

Quick tunnels change URL each restart; re-copy the link after restarting `host:public`.

## Caption quality (local, $0)

Accuracy is **STT × MT**. Defaults use the **balanced** preset (better than the old tiny/3B demo stack).

| `FONGLISH_QUALITY` | Whisper STT | Ollama MT | Use when |
|--------------------|-------------|-----------|----------|
| `fast` | `whisper-tiny` | `llama3.2:3b` | Lowest latency demos |
| **`balanced`** (default) | `whisper-base` | `llama3` (8B) | Daily use |
| `accurate` | `whisper-small` | `llama3` | Best local WER (heavier) |

```env
FONGLISH_QUALITY=balanced
# optional overrides:
# OLLAMA_MT_MODEL=llama3:latest
# WHISPER_MODEL=Xenova/whisper-small
# MT_ON_PARTIAL=0          # keep 0 — translate finals only (less flicker)
# MT_GLOSSARY=Fonglish,WebRTC,Ollama
```

**Tips for better translations**

1. Prefer **final** captions (default): partials show interim source; MT runs on speech end.  
2. Larger Whisper helps more than a larger chat model when the transcript is wrong.  
3. Use a glossary for product names that must not be translated.  
4. Pull a stronger multilingual model if needed (`qwen2.5:7b`, etc.) and set `OLLAMA_MT_MODEL`.

## Quick start (local)

Works the same on **Windows (PowerShell/cmd)**, macOS, and Linux:

```bash
cd fonglish
npm run env:init
# optional: edit .env — defaults use 127.0.0.1 (Windows-friendly)

npm install

# terminal 1 — caption brain (Whisper + Ollama)
npm run gateway

# terminal 2 — UI (or use the Vercel deploy and skip this)
npm run web
```

Open **http://127.0.0.1:3000** (or your Vercel URL) in two browser profiles.

## Deploy UI on Vercel

The **web app** deploys to Vercel. The **gateway does not** (long-lived WebSocket + local Whisper/Ollama).

```bash
# from repo root (requires vercel CLI login)
npx vercel link --yes
npx vercel --prod
```

| Piece | Where it runs |
|-------|----------------|
| Lobby + call UI | **Vercel** (Next.js) |
| WebSocket signaling + STT + MT | **Your machine** (`npm run gateway`) |

On the lobby page, set **Caption gateway** to `ws://127.0.0.1:8787` (default). Start the gateway before joining a room.

```bash
npm run gateway   # keep running on the machine that does STT/MT
```

Optional Vercel env:

| Name | Example | Notes |
|------|---------|--------|
| `NEXT_PUBLIC_GATEWAY_URL` | `ws://127.0.0.1:8787` | Default WS URL baked into the build |

Monorepo build uses `npm run vercel-build` (shared + audio + web only — not the gateway).

1. Create a room → **Copy invite**
2. Open the link on the other side (name + languages on the lobby)
3. Allow camera/mic
4. Speak — captions appear, translated into each person’s **Captions in** language

> Whisper ONNX downloads on first gateway start (~75MB). Ollama loads the model on first translation.

### Windows notes

- Prefer **`127.0.0.1`** over `localhost` in `.env` (avoids IPv6 `::1` when Node listens on IPv4).
- Allow **Node.js** through **Windows Defender Firewall** for ports **8787** (gateway) and **3000** (web) if you connect from another PC.
- Use **PowerShell** or **cmd**; no Bash required. Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
# or: curl.exe http://127.0.0.1:8787/health
```

- Install Ollama from [ollama.com/download](https://ollama.com/download) (Windows). Keep it running in the tray.
- Edge and Chrome both work; grant mic/camera when prompted.

### Two machines on a LAN

1. On the gateway host, note its LAN IP (e.g. `192.168.1.20`).
2. Set on **both** sides (or at least the client):

```env
NEXT_PUBLIC_GATEWAY_URL=ws://192.168.1.20:8787
```

3. Open `http://192.168.1.20:3000` (web is bound to `0.0.0.0`).
4. Ensure firewall allows inbound TCP **3000** and **8787** on the host.

## Architecture

```
Browser A ──WebRTC A/V── Browser B
   │ mic PCM                    │ mic PCM
   └──────────► Gateway ◄───────┘
                  │
     local Whisper STT + Ollama MT
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

### Companion-ready seam (future desktop)

```ts
interface AudioSource {
  start(): AsyncIterable<AudioChunk>; // PCM16 mono @ 16 kHz
  stop(): Promise<void>;
}
// v1: BrowserMicSource
// later: DesktopSystemAudioSource
//   Windows: WASAPI loopback / Stereo Mix / VB-Cable
//   macOS: BlackHole / ScreenCaptureKit
```

Gateway protocol stays the same: binary PCM frames in → `caption` events out. Video app is irrelevant to STT/MT.

## Platform support

| Layer | Windows | macOS | Linux |
|-------|---------|-------|-------|
| Gateway (Node) | ✅ | ✅ | ✅ |
| Web UI + WebRTC harness | ✅ | ✅ | ✅ |
| Ollama MT | ✅ | ✅ | ✅ |
| Local Whisper STT | ✅ | ✅ | ✅ |
| System-audio companion | 🔜 planned | 🔜 planned | 🔜 planned |

## Environment

| Variable | Default | Notes |
|----------|---------|--------|
| `FONGLISH_QUALITY` | `balanced` | `fast` / `balanced` / `accurate` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama HTTP API |
| `OLLAMA_MT_MODEL` | from preset | e.g. `llama3:latest` |
| `WHISPER_MODEL` | from preset | e.g. `Xenova/whisper-base` |
| `MT_ON_PARTIAL` | `0` | Set `1` to translate interim STT |
| `MT_GLOSSARY` | — | Comma-separated terms / `src=tgt` |
| `GATEWAY_PORT` | `8787` | Caption gateway |
| `GATEWAY_HOST` | `0.0.0.0` | Bind all interfaces (LAN-friendly) |
| `NEXT_PUBLIC_GATEWAY_URL` | `ws://127.0.0.1:8787` | Browser WS URL |
| `NEXT_PUBLIC_GATEWAY_PORT` | `8787` | Used if URL not set |

## Protocol (summary)

Client → gateway JSON: `join`, `leave`, `update_langs`, `signal`, `mute`  
Client → gateway binary: raw PCM16 LE mono @ 16 kHz (~100 ms chunks)  
Gateway → client: `welcome`, `peer_joined`, `peer_left`, `signal`, `caption`, `error`, `stats`, `services`

## Privacy note

This MVP runs **STT and translation on your machine** (Whisper ONNX + Ollama). Mic PCM is sent only to the local caption gateway. A consent note is shown in-call. No server-side transcript store is implemented.

## Out of scope (v1)

- Group calls (3+)
- Spoken dubbing / voice replacement
- Zoom/Meet in-app overlay (companion planned; not built)
- Accounts / auth

## Troubleshooting

| Symptom | Check |
|---------|--------|
| “WebSocket error” | Gateway running? `http://127.0.0.1:8787/health` |
| WS works on Mac, fails on Windows | Use `127.0.0.1` not `localhost` in `NEXT_PUBLIC_GATEWAY_URL` |
| Firewall blocked | Windows: allow Node for ports 8787 & 3000 |
| No captions | Ollama running? Model pulled? **STT**/**MT** pills green? Mic unmuted? |
| MT errors | `OLLAMA_MT_MODEL` matches a pulled model? `ollama run llama3.2:3b` |
| STT pill yellow | Whisper loading — wait for gateway log `STT: ready` |
| onnx / native errors after clone | Delete `node_modules`, run `npm install` **on that machine** (native binaries are OS-specific) |
| No remote video | Allow camera; same Wi‑Fi; browser console ICE errors |
| Room full | v1 is 1:1 — only two peers per room |

## License

Private / experimental.
