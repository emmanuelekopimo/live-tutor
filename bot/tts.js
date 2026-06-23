// tts.js
//
// Text-to-speech via OpenRouter (openai/gpt-audio-mini). Returns WAV bytes the audio-inject
// layer can decode and play into the call.
//
// The welcome clip is generated once and CACHED to bot/assets/welcome.wav, so restarts don't
// re-hit the API and the bot still greets the call offline after the first run.
//
// Chat-completion audio output on this model requires stream:true, so we accumulate the
// base64 chunks. A simpler raw-bytes alternative is the dedicated speech endpoint:
//   POST https://openrouter.ai/api/v1/audio/speech  { model, input, voice, response_format }
// which returns the audio body directly (no JSON, no streaming) — swap to it if the streamed
// chunk shape ever changes.

const fs = require("fs");
const path = require("path");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openai/gpt-audio-mini";
const VOICE = process.env.TTS_VOICE || "alloy";

const ASSETS_DIR = path.join(__dirname, "assets");
const WELCOME_PATH = path.join(ASSETS_DIR, "welcome.wav");
const WELCOME_TEXT =
  process.env.WELCOME_TEXT ||
  "Welcome, everyone — I am Live Tutor, and I'll be taking you through this lesson. Let's get started.";

// Synthesize speech for `text`; resolves to a Buffer of WAV audio.
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
      modalities: ["text", "audio"],
      audio: { voice: VOICE, format: "wav" },
      stream: true,
      messages: [{ role: "user", content: `Say exactly, with no extra words: ${text}` }],
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`OpenRouter TTS failed: ${res.status} ${res.statusText}`);
  }

  // Parse the SSE stream, concatenating base64 audio deltas into one buffer.
  let b64 = "";
  let pending = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop(); // keep the trailing partial line for the next chunk
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta;
        const part = delta?.audio?.data;
        if (part) b64 += part;
      } catch {
        // ignore keep-alive/comment lines that aren't JSON
      }
    }
  }

  if (!b64) throw new Error("OpenRouter TTS returned no audio data.");
  return Buffer.from(b64, "base64");
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
