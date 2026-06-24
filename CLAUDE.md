# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**Live Tutor** is an AI teaching assistant that operates *inside* a Google Meet call: it
joins as a participant, listens when a student raises their hand and speaks, answers in a
natural voice, and draws on a shared whiteboard. Read `README.md` for the full picture.

This is a **hybrid architecture**:

- **Control plane** — the official Google Meet API (`@google-apps/meet`) creates and
  manages meeting spaces. This is the code that exists today (`server.js`, `auth.js`).
- **Live plane** — a headed **Playwright** Chromium bot joins the meeting, watches the
  DOM, captures audio, runs the AI pipeline, and responds with voice + whiteboard. **Not
  built yet.**

Do not collapse these into one approach. The official API is *not* a replacement for the
Playwright bot, and vice versa — they cooperate.

## Current focus

Milestone 1 (**bot joins and stays in the call**) and the voice-output milestone are done.
Milestone 2 — **floor management** — is now in `bot/moderator.js`: it watches the People
panel for raised hands and gives the floor to one student at a time (mute the room
best-effort + call the student by name). Key constraint baked into the design: **Meet does
not let a host unmute another participant**, so the bot floor-*clears* and the student
unmutes themselves; with no host rights it degrades to a voice-only handoff. The moderator
selectors in `selectors.js` are all `[VERIFY]` — they need confirmation against a live call.

**Whiteboard sharing** is now done (reordered ahead of audio capture at the team's request):
the bot serves a view-only **Excalidraw** board (`bot/board/index.html`) from a tiny local
http server (`bot/board-server.js`), opens it in a second tab, and screen-shares it via Meet's
"Present now → A tab" (`bot/present.js`). A fixed bottom-right **status overlay** in the board
page (`window.TutorBoard.setStatus`) shows tutor state, driven by the floor-state machine
(`meet-bot.js` `onState` → `pushStatus`). The present selectors in `selectors.js` are `[VERIFY]`.
The board surface is view-only and **nothing draws on it yet** — the Excalidraw control API
(`window.excalidrawAPI` is already parked on the page) is the next sub-step.

The **next** milestones: drawing/maths onto the board (Excalidraw control API + MathJax → SVG
→ image elements), then audio capture (companion Chrome extension + `tabCapture`), then STT
and the LLM tutoring loop. Keep changes scoped one milestone at a time — the build order is in
`README.md` → Roadmap; follow it.

## Tech stack & committed choices

- Runtime: **Node.js**, CommonJS (`"type": "commonjs"`). Use `require`, not `import`.
- Package manager: **pnpm** (`pnpm-lock.yaml` is the lockfile — don't introduce npm/yarn lockfiles).
- Web server: **Express 5**.
- Google: **`@google-apps/meet`** (Meet API) + **`googleapis`** (OAuth).
- Live bot: **Playwright** (headed Chromium); companion **Chrome extension** for `tabCapture` still to add.
- Whiteboard: **Excalidraw**, embedded via **ESM + import maps** from `esm.sh` (no bundler —
  keeps the no-build, CommonJS project intact), served by a tiny built-in-`http` static server.
  Math (later): **MathJax** `tex2svg` → SVG → data URL → Excalidraw **image element**.
- AI pipeline (committed): **OpenAI Whisper API** (STT) → **Claude Opus 4.x** (tutoring)
  → **TTS via OpenRouter `x-ai/grok-voice-tts-1.0`** (dedicated `/api/v1/audio/speech`
  endpoint, mp3). When adding the Claude integration, use the latest Opus model and the
  `@anthropic-ai/sdk`.
- Audio routing (bot voice → Meet): **in-browser `getUserMedia` injection** — `bot/audio-inject.js`
  overrides `navigator.mediaDevices.getUserMedia` so Meet receives a synthetic Web Audio
  MediaStream we feed TTS clips into. No OS driver. **VB-Audio Virtual Cable** is the
  documented fallback if Meet's audio processing gates the synthetic stream.

Don't swap any of these for an alternative without asking — they were chosen deliberately.

## Code conventions (match the existing files)

- Double quotes, semicolons, 2-space indentation.
- Small, focused modules exporting via `module.exports` (see `auth.js`).
- Comments explain *why*, not *what* — keep the existing terse, intent-revealing style.
- Load env with `dotenv` at the top of the entry point (`server.js`), never in libraries.
- Keep secrets in `.env`; keep persisted state (like `tokens.json`) out of git.

## Key files

| File | Role |
|------|------|
| `server.js` | Express entry point. Routes: `/auth`, `/auth/callback`, `/create-meet`. |
| `create-meet.js` | CLI mirror of `/create-meet`: makes an OPEN space, prints the link (`pnpm meet`). |
| `auth.js`   | OAuth2 client, scopes, token load/save, refresh-token persistence. |
| `bot/meet-bot.js` | Playwright bot: joins a Meet link, mutes, plays the welcome clip, stays in call, heartbeats. |
| `bot/browser.js` | Shared launcher: opens a specific real Chrome profile. All launch config lives here. |
| `bot/audio-inject.js` | Mic injection: `initScript` overrides `getUserMedia`; `speak()` does unmute → play → mute. |
| `bot/tts.js` | OpenRouter `grok-voice-tts-1.0` TTS (mp3); caches the welcome clip to `bot/assets/welcome.mp3`. |
| `bot/moderator.js` | Floor management: opens the People panel, reads raised hands (ordered), mutes the room best-effort, runs the one-speaker-at-a-time state machine. |
| `bot/board/index.html` | The shared whiteboard tab: view-only Excalidraw + fixed bottom-right status overlay (`window.TutorBoard.setStatus`). Title "Live Tutor Board" — matched by the screen-share auto-select flag. |
| `bot/board-server.js` | Tiny built-in-`http` static server for `bot/board/` on a loopback port; returns `{ url, close }`. |
| `bot/present.js` | Drives Meet's "Present now → A tab" to screen-share the board (best-effort, never throws). |
| `bot/profiles.js` | Lists Chrome profiles → directory names (`pnpm profiles`). |
| `bot/login.js` | Optional manual Google sign-in (only if not reusing an existing profile). |
| `bot/selectors.js` | **All** Meet DOM locators. Update here first when the join flow breaks. |
| `tokens.json` | Saved OAuth tokens (gitignored). Deleting it forces re-consent. |
| `.playwright-profile/` | Persistent browser profile for the bot (gitignored). Holds Google sign-in. |
| `.env`      | `CLIENT_ID`, `CLIENT_SECRET` today; more API keys as the bot grows. |

## Environment & secrets

- Required now: `CLIENT_ID`, `CLIENT_SECRET` (Google OAuth Web client).
- Bot config: `BOT_NAME`, `MEET_URL`, `BROWSER_CHANNEL`; dedicated mode `BOT_PROFILE_DIR`;
  system mode `USE_SYSTEM_PROFILE`, `CHROME_PROFILE_DIRECTORY`, `CHROME_USER_DATA_DIR`.
- Audio/TTS: `OPENROUTER_API_KEY` (required for the welcome clip); optional `WELCOME_TEXT`,
  `TTS_VOICE` (default `eve`).
- Add as needed: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
- **Never** print, commit, or log secret values or token contents. `.env` and
  `tokens.json` are already gitignored — keep it that way.

## Running & testing

```bash
pnpm install
pnpm dev        # nodemon
pnpm start
```

- There is **no test suite yet** (`pnpm test` is a placeholder that exits non-zero). Don't
  claim tests pass. If you add tests, wire up a real `test` script.
- Manual smoke test: start the server, visit `/auth` once, then `/create-meet` and confirm
  a `meetLink` comes back.

## Gotchas (read before touching the live plane)

- Meet **blocks anonymous/signed-out guests** on most meetings ("You can't join this video
  call"), so the bot runs signed in. Only `accessType: OPEN` spaces (from `/create-meet`)
  allow anonymous join.
- **The bot joins muted**, so a muted mic track transmits nothing. Any spoken output must
  **unmute → play → re-mute** — that's what `audio-inject.js` `speak()` does (via the
  `micToggleOn`/`micToggleOff` selectors). The injection (`addInitScript`) MUST be registered
  **before** `page.goto`, or Meet captures the real (fake) device instead of our stream.
- **Can't auto-verify remote reception:** there's no clean programmatic proof that *other*
  participants hear the bot without a second client. The welcome clip + Meet's own mic-activity
  indicator are the practical check — keep a human in the call for the smoke test.
- **Profile model — two modes in `bot/browser.js`:**
  - *Dedicated (default):* the bot uses its own `./.bot-profile` dir; sign in once via
    `pnpm login` (as team.toonitt@gmail.com). Coexists with the user's normal Chrome.
  - *System (`USE_SYSTEM_PROFILE=true`):* opens an installed profile directly
    (`CHROME_PROFILE_DIRECTORY`, e.g. `Profile 12`; `pnpm profiles` lists them).
- **Chrome locks the whole "User Data" folder while open** — that's why system mode needs
  Chrome fully quit, and why the dedicated profile (separate lock) is the default. Don't
  point the bot at the live `User Data` dir as the default. `browser.js` converts the lock
  error into a clear message.
- Cloning a logged-in profile's cookies is unreliable (Chrome App-Bound Encryption) — prefer
  a fresh `pnpm login` into the dedicated profile over copying profile files.
- The browser defaults to real **Google Chrome** (`channel: "chrome"` in `bot/browser.js`),
  not Playwright's bundled Chromium. Override with `BROWSER_CHANNEL=chromium`.
- Meet **blocks headless** Chromium — the Playwright bot must run `headless: false`.
- **Tab audio capture** needs a companion Chrome extension (`tabCapture` permission);
  Playwright/plain pages can't capture tab audio directly.
- **Sharing the board** relies on launch flags (`bot/browser.js`) to auto-pick the capture
  source so there's no manual picker click: `--auto-select-desktop-capture-source=Live Tutor
  Board` (the classic, broadly-supported one that actually engages) **plus** the newer
  `--auto-select-tab-capture-source-by-title=Live Tutor Board` (not honoured on every build).
  Both match the source named exactly **"Live Tutor Board"**, so the board page's
  `document.title` MUST stay exactly that. **Crucially, `--use-fake-ui-for-media-stream` must
  NOT be set:** for `getDisplayMedia` it short-circuits the picker and returns the **entire
  screen** (infinity-mirror share) *before* the auto-select flags can run — they only take
  effect inside the picker. With fake-ui off, the picker runs and the auto-select resolves it
  to the board tab with no dialog; the mic/cam permission comes from `context.grantPermissions()`
  instead. The present gesture must fire on the **Meet** tab (`present.js` calls
  `bringToFront()`), and the Meet tab is left in front for two reasons: moderation stays
  responsive, AND the board tab must NOT be focused (a focused tab makes the Chrome *window*
  title "Live Tutor Board", so the auto-select grabs the whole window instead of the tab). A
  *captured* tab keeps rendering in the background, so the board still shows. The board loads
  Excalidraw/React from **esm.sh at runtime** (needs internet; vendoring `dist` locally is a
  later hardening step).
- **Never set `--use-fake-device-for-media-stream`** (`bot/browser.js`): it hijacks
  `getDisplayMedia` so screen-share shows Chromium's **green test-pattern + beep** instead of
  the real board tab. The mic path doesn't need it — `audio-inject.js` overrides
  `getUserMedia` with a synthetic stream — and the bot joins camera-off, so the fake device
  is pure downside. `--use-fake-ui-for-media-stream` is also OFF (it breaks the board share —
  see above); mic/cam are auto-granted via `context.grantPermissions()` in `browser.js`.
- Meet's **DOM selectors change often** — prefer `data-*` attributes over class names and
  expect ongoing maintenance.
- Joining/receiving media will require **additional OAuth scopes** beyond the current
  `meetings.space.created` scope in `auth.js`.
- **Muting others does NOT need Host Management / "Mute all".** As long as the bot account
  is host/co-host (it creates the space, so it is — see [[bot-account-is-meeting-host]]), each
  People-panel row exposes an inline **"Mute <name>'s microphone"** button. `moderator.muteAll()`
  mutes the room by clicking each individually; `participantMicState()` reads mic state from the
  same control (unmuted → "Mute …'s microphone"; muted → "You can't unmute someone else"). So
  Host Management being off in the UI is fine. Don't rely on a "Mute all" button, and avoid
  Meet's **Audio Lock** — it would block a called student from unmuting.
- `/create-meet` (and `pnpm meet`) still create the space with `moderation: "ON"` (harmless;
  turns host management on by default), but it is **not required** for the bot to mute. Be
  deliberate if changing `accessType` or `moderation`.
- **DOM debugging:** `BOT_DEBUG=1` logs panel-scan summaries to the console; `BOT_DEBUG_DOM=1`
  streams full per-tick DOM snapshots (listitems + mute/hand/host controls, with outerHTML) to
  `bot/debug/dom-<session>.jsonl` (gitignored) — use it to fix drifting Meet selectors.

## Environment specifics

- Target platform is **Windows** (paths, VB-Audio Virtual Cable, virtual mic setup are
  Windows-oriented). The shell in use is bash — use Unix syntax (`/dev/null`, forward
  slashes).

## Working agreement

- Confirm before changing the architecture, swapping a committed tool, or widening scope
  beyond the current milestone.
- Keep edits minimal and in the style of the surrounding code.
- Update `README.md` and this file when you add a new layer (bot, extension, pipeline stage).
- When the implementation diverges from what this file describes — a committed tool swapped,
  a milestone reordered, an architecture decision changed (often at the user's request) —
  update this file in the same change so it keeps reflecting reality. Treat the divergence
  itself as the trigger: don't leave `CLAUDE.md` describing the old plan.
