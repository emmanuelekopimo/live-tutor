// tts.js
//
// Text-to-speech via OpenRouter's dedicated speech endpoint (x-ai/grok-voice-tts-1.0).
// Returns raw mp3 bytes the audio-inject layer decodes (via decodeAudioData) and plays into
// the call. mp3 over pcm on purpose: decodeAudioData needs a self-describing container, and
// raw pcm has no header — mp3 just works (and is smaller).
//
// The welcome clip is generated once and CACHED to bot/assets/welcome.mp3, so restarts don't
// re-hit the API and the bot still greets the call offline after the first run.

const fs = require("fs");
const path = require("path");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/audio/speech";
const MODEL = "x-ai/grok-voice-tts-1.0";
const VOICE = process.env.TTS_VOICE || "eve";
const FORMAT = "mp3";

const ASSETS_DIR = path.join(__dirname, "assets");
const WELCOME_PATH = path.join(ASSETS_DIR, "welcome.mp3");
const WELCOME_TEXT =
  process.env.WELCOME_TEXT ||
  "Welcome, everyone. I am Live Tutor, and I'll be taking you through this lesson. Let's get started.";

// Synthesize speech for `text`; resolves to a Buffer of mp3 audio.
async function synthesize(text) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set — add it to .env.");

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      input: text,
      voice: VOICE,
      response_format: FORMAT,
    }),
  });

  // The endpoint returns the audio body directly; on error it returns JSON, so surface it.
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter TTS failed: ${res.status} ${res.statusText} ${detail}`.trim(),
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("OpenRouter TTS returned no audio data.");
  return buffer;
}

// Return the welcome clip, generating + caching it on first use.
async function getWelcomeClip() {
  if (fs.existsSync(WELCOME_PATH)) return fs.readFileSync(WELCOME_PATH);
  const buffer = await synthesize(WELCOME_TEXT);
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.writeFileSync(WELCOME_PATH, buffer);
  return buffer;
}

module.exports = { synthesize, getWelcomeClip, WELCOME_PATH };
