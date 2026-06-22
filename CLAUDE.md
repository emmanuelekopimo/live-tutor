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

**Get the Playwright bot to join a Meet link and stay in the call.** Everything past that
(DOM watching, audio, STT, LLM, TTS, whiteboard) is later. Keep changes scoped to this
milestone unless asked otherwise. The build order is in `README.md` → Roadmap; follow it.

## Tech stack & committed choices

- Runtime: **Node.js**, CommonJS (`"type": "commonjs"`). Use `require`, not `import`.
- Package manager: **pnpm** (`pnpm-lock.yaml` is the lockfile — don't introduce npm/yarn lockfiles).
- Web server: **Express 5**.
- Google: **`@google-apps/meet`** (Meet API) + **`googleapis`** (OAuth).
- Live bot (to add): **Playwright** (headed Chromium) + companion **Chrome extension** for `tabCapture`.
- AI pipeline (committed): **OpenAI Whisper API** (STT) → **Claude Opus 4.x** (tutoring)
  → **OpenAI TTS or ElevenLabs** (TTS). When adding the Claude integration, use the latest
  Opus model and the `@anthropic-ai/sdk`.
- Audio routing on Windows: **VB-Audio Virtual Cable** (bot voice → Playwright mic → Meet).

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
| `auth.js`   | OAuth2 client, scopes, token load/save, refresh-token persistence. |
| `tokens.json` | Saved OAuth tokens (gitignored). Deleting it forces re-consent. |
| `.env`      | `CLIENT_ID`, `CLIENT_SECRET` today; more API keys as the bot grows. |

## Environment & secrets

- Required now: `CLIENT_ID`, `CLIENT_SECRET` (Google OAuth Web client).
- Add as needed: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`.
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

- Meet **blocks headless** Chromium — the Playwright bot must run `headless: false`.
- **Tab audio capture** needs a companion Chrome extension (`tabCapture` permission);
  Playwright/plain pages can't capture tab audio directly.
- Meet's **DOM selectors change often** — prefer `data-*` attributes over class names and
  expect ongoing maintenance.
- Joining/receiving media will require **additional OAuth scopes** beyond the current
  `meetings.space.created` scope in `auth.js`.
- `/create-meet` creates an **OPEN** space (anyone with the link can join) — be deliberate
  if changing `accessType`.

## Environment specifics

- Target platform is **Windows** (paths, VB-Audio Virtual Cable, virtual mic setup are
  Windows-oriented). The shell in use is bash — use Unix syntax (`/dev/null`, forward
  slashes).

## Working agreement

- Confirm before changing the architecture, swapping a committed tool, or widening scope
  beyond the current milestone.
- Keep edits minimal and in the style of the surrounding code.
- Update `README.md` and this file when you add a new layer (bot, extension, pipeline stage).
