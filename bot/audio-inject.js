// audio-inject.js
//
// How the bot's voice reaches the call. Google Meet only takes audio from "a microphone",
// and there is no official media API — so we hand Meet a microphone we control.
//
// `initScript` runs in the page BEFORE Meet's own JS (registered via context.addInitScript)
// and overrides navigator.mediaDevices.getUserMedia: any audio request returns a synthetic
// MediaStream fed by a Web Audio graph. To "speak", we decode a TTS clip into an AudioBuffer
// and push it through that stream. No OS audio driver (VB-Cable) needed; fully dynamic.
//
// `speak(page, buffer)` is the Node-side counterpart: the bot joins MUTED, so a spoken
// output must unmute -> play -> re-mute. Reused for every answer, not just the welcome.

const S = require("./selectors");

// Injected into the page. Self-contained: no Node scope is available here.
function initScript() {
  // One graph per frame. Guard so re-entrant injections don't stack contexts.
  if (window.__ltAudio) return;

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();

  // A silent constant source keeps the track "live" while idle — some browsers mark a
  // fully-silent MediaStreamTrack as muted/ended, which Meet would treat as no mic.
  const silent = ctx.createConstantSource();
  const mute = ctx.createGain();
  mute.gain.value = 0;
  silent.connect(mute).connect(dest);
  silent.start();

  // Decode a base64 audio clip (WAV/MP3 — decodeAudioData handles both) and play it into
  // the synthetic mic. Resolves when playback finishes so the caller can re-mute.
  window.__ltPlayClip = async (b64) => {
    if (ctx.state === "suspended") await ctx.resume();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const audioBuf = await ctx.decodeAudioData(bytes.buffer);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(dest);
    return new Promise((resolve) => {
      src.onended = resolve;
      src.start();
    });
  };

  // Hand Meet our stream for any audio capture; leave non-audio requests untouched so the
  // (fake) camera device still works if Meet ever asks for video.
  const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (constraints && constraints.audio) {
      const stream = dest.stream;
      if (constraints.video) {
        const v = await realGUM({ video: constraints.video });
        v.getVideoTracks().forEach((t) => stream.addTrack(t));
      }
      return stream;
    }
    return realGUM(constraints);
  };

  window.__ltAudio = { ctx, dest };
}

// Toggle a mic control if it's present; never throw (the label flips between states).
async function clickMic(page, sel) {
  try {
    const loc = page.getByRole(sel.role, { name: sel.name }).first();
    await loc.waitFor({ state: "visible", timeout: 4000 });
    await loc.click();
    return true;
  } catch {
    return false;
  }
}

// Speak a clip into the call: unmute, play, re-mute. `buffer` is WAV/MP3 audio bytes.
async function speak(page, buffer) {
  const b64 = buffer.toString("base64");
  await clickMic(page, S.micToggleOn); // unmute (no-op if already live)
  try {
    await page.evaluate((data) => window.__ltPlayClip(data), b64);
  } finally {
    await clickMic(page, S.micToggleOff); // back to muted/idle
  }
}

module.exports = { initScript, speak };
