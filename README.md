# Live Tutor

An AI teaching assistant that joins a **Google Meet** call as a participant, listens
when a student raises their hand and speaks, answers in a natural voice, and draws on a
shared whiteboard — a "live tutor" that operates *inside* Meet rather than in a custom UI.

> **Status:** early development. The current working baseline is OAuth + programmatic
> Meet creation via the official Google Meet API. The live bot (joining, audio, AI loop)
> is being built next. See [Roadmap](#roadmap).

---

## How it works (hybrid architecture)

Live Tutor uses **two cooperating layers**:

1. **Control plane — official Google Meet API** (`@google-apps/meet`)
   Authenticates via Google OAuth and programmatically **creates and manages** Meet
   spaces (the meeting link, access type, lifecycle). This is what `server.js` does today.

2. **Live plane — Playwright bot**
   A headed Chromium instance (driven by Playwright) **joins the meeting** through the web
   UI, watches the DOM for hand-raise and mute/unmute events, captures the call's audio,
   runs the AI pipeline, and **responds with voice** through a virtual microphone. It also
   screen-shares a separate whiteboard window.

```
                         ┌──────────────────────────┐
   Control plane         │  Node.js server          │
   (official API)        │  server.js + auth.js     │
                         │  POST /create-meet ──────┼──► Google Meet API ──► Meet link
                         └──────────────┬───────────┘
                                        │ meet link
                                        ▼
   Live plane            ┌──────────────────────────┐
   (Playwright bot)      │  Headed Chromium          │
                         │  • joins the call         │
                         │  • DOM watcher            │      hand raise / mute events
                         │    (hand raise, mute)     │ ───────────────┐
                         │  • tab-audio capture      │                │
                         │  • screen-shares canvas   │                ▼
                         └──────────────┬───────────┘        ┌─────────────────┐
                                        │ captured audio     │  State machine  │
                                        ▼                    │ IDLE/RECORDING/ │
                              OpenAI Whisper (STT)            │ PROCESSING/...  │
                                        │                     └────────┬────────┘
                                        ▼                              │
                                 Claude Opus (tutor)                   │
                                        │                              │
                                        ▼                              │
                            OpenAI / ElevenLabs (TTS)                  │
                                        │                              │
                                        ▼                              │
                          VB-Audio Virtual Cable ──► Playwright mic ──► Google Meet
```

### AI pipeline

| Stage | Tool |
|-------|------|
| Speech-to-text | **OpenAI Whisper API** |
| Reasoning / tutoring | **Claude Opus 4.x** |
| Text-to-speech | **OpenAI TTS** or **ElevenLabs** |
| Audio routing (bot voice → call) | **VB-Audio Virtual Cable** (Windows) |
| Whiteboard | **Excalidraw** window, shared via Meet screen-share |

---

## Current state

Implemented today:

- **Google OAuth flow** (`auth.js`) with token persistence (`tokens.json`) and automatic
  refresh-token handling.
- **Express server** (`server.js`) exposing:
  - `GET /auth` → start OAuth consent
  - `GET /auth/callback` → exchange code for tokens
  - `GET /create-meet` → create an **OPEN** Meet space and return the join link
- **Playwright bot** (`bot/meet-bot.js`) — milestone 1: joins a Meet link (muted,
  camera off) and stays in the call with a heartbeat. No audio/AI yet.

Not yet built: DOM watching (hand raise / mute), audio capture, the AI pipeline, the
whiteboard, and TTS playback. These are the next milestones.

---

## Prerequisites

- **Node.js** 18+ and **pnpm**
- A **Google Cloud project** with the **Google Meet API** enabled and an OAuth 2.0
  **Web application** client (redirect URI `http://localhost:3000/auth/callback`)
- A Google account allowed to use the Meet API (Workspace account recommended)
- *(for the live bot, later)* **VB-Audio Virtual Cable**, an **OpenAI API key**, an
  **Anthropic API key**, and optionally an **ElevenLabs API key**

---

## Setup

```bash
pnpm install
```

Create a `.env` file in the project root:

```ini
CLIENT_ID=your-google-oauth-client-id
CLIENT_SECRET=your-google-oauth-client-secret
# Added as the bot is built out:
# OPENAI_API_KEY=...
# ANTHROPIC_API_KEY=...
# ELEVENLABS_API_KEY=...
```

> `.env` and `tokens.json` are gitignored — never commit them.

---

## Running

```bash
pnpm dev      # nodemon, auto-restart on change
# or
pnpm start
```

Then:

1. Open <http://localhost:3000/auth> and complete Google consent (first run only —
   tokens are saved to `tokens.json` and reused across restarts).
2. Hit <http://localhost:3000/create-meet> to create a meeting. You'll get JSON like:

   ```json
   {
     "meetLink": "https://meet.google.com/xxx-xxxx-xxx",
     "spaceId": "spaces/...",
     "meetingCode": "xxx-xxxx-xxx"
   }
   ```

### The bot's identity (sign in once)

Most meetings **block anonymous/signed-out guests** (Google shows *"You can't join this
video call"*), so the bot runs as a **signed-in Google user**.

The bot uses its **own dedicated Chrome profile** (`./.bot-profile`) so it can run *while
your normal Chrome is open*. Sign it in once:

```bash
pnpm login
```

A real Chrome window opens on the bot's profile — log in as **team.toonitt@gmail.com**
(complete any 2FA), then press **ENTER** to save. Reused on every later run.

> **Why a dedicated profile?** Chrome locks its whole *User Data* folder while open, so the
> bot can't share your everyday Chrome's profile unless you quit Chrome entirely every time.
> A separate profile sidesteps that. Uses real Chrome by default (`channel: "chrome"`); set
> `BROWSER_CHANNEL=chromium` to use Playwright's bundled build.

<details>
<summary>Advanced: open an installed Chrome profile directly</summary>

If you'd rather reuse an existing signed-in profile (no separate login), set
`USE_SYSTEM_PROFILE=true` and pick the profile directory (`pnpm profiles` lists them):

```ini
# .env
USE_SYSTEM_PROFILE=true
CHROME_PROFILE_DIRECTORY=Profile 12   # "Live Tutor" — the directory, not the display name
```

⚠️ In this mode you must **fully quit Google Chrome** (every window + tray) before running
the bot, because Chrome locks the shared *User Data* folder.
</details>

### Sending the bot into a call

```bash
pnpm bot https://meet.google.com/xxx-xxxx-xxx
# or set MEET_URL in .env and run: pnpm bot
```

A Chrome window opens on the chosen profile, joins the meeting (mic + camera off), and
stays until you press **Ctrl+C** (the bot leaves the call cleanly on exit). Depending on
the meeting's access setting, the bot may click **"Ask to join"** and wait — the **host
then admits it** from inside the call.

---

## Roadmap

Build order — each step builds on the previous:

1. **Bot joins & stays alive** ✅ *scaffolded* (`bot/meet-bot.js`) — Playwright (headed)
   joins the Meet link from `/create-meet` and remains in the call.
2. **DOM watcher** — detect hand raises and mute/unmute state changes.
3. **Audio capture** — capture tab audio (companion Chrome extension + `tabCapture`).
4. **Transcription** — pipe captured audio to OpenAI Whisper.
5. **Tutoring** — Claude Opus generates the answer.
6. **Voice response** — TTS played through VB-Audio Virtual Cable into the call.
7. **Whiteboard** — Excalidraw window driven by Claude, screen-shared into Meet.

---

## Project layout

```
live-tutor/
├── server.js        # Express app: auth + create-meet routes (control plane)
├── auth.js          # Google OAuth client, token load/save/refresh
├── bot/
│   ├── meet-bot.js  # Playwright bot: joins a Meet link and stays (live plane)
│   ├── browser.js   # Shared browser launcher: opens a specific Chrome profile
│   ├── profiles.js  # Lists Chrome profiles → directory names (pnpm profiles)
│   ├── login.js     # Optional: sign a fresh Google account in by hand
│   └── selectors.js # Meet DOM selectors, isolated so they're easy to update
├── tokens.json      # Persisted OAuth tokens (gitignored)
├── .env             # Secrets (gitignored)
├── package.json
└── CLAUDE.md        # Guidance for Claude Code working in this repo
```

---

## Notes & caveats

- The Playwright bot must run **headed** (`headless: false`) — Meet blocks headless
  Chromium.
- Tab audio capture requires a **companion Chrome extension**; it is not available to a
  plain page or to Playwright directly.
- Meet's DOM selectors change frequently — prefer `data-*` attributes over class names
  and expect to maintain them.
- Joining the call and receiving media will require **additional OAuth scopes** beyond the
  `meetings.space.created` scope used today.

---

*Built as a SIWES project.*
