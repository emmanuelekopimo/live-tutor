// meet-bot.js
//
// Milestone 1: a headed Playwright bot that joins a Google Meet link and stays in
// the call. No audio, no DOM watching, no AI yet — just a reliable, resilient join.
//
// Usage:
//   node bot/meet-bot.js <meet-url>
//   MEET_URL=https://meet.google.com/xxx-xxxx-xxx node bot/meet-bot.js
//
// Notes:
//   - Runs HEADED on purpose. Meet blocks headless Chromium.
//   - Uses a persistent profile (.playwright-profile) so a one-time Google sign-in
//     (done by hand in the launched window) survives restarts. Signed-out guest
//     join also works for OPEN spaces.

require("dotenv").config();
const { launchBrowser } = require("./browser");
const audioInject = require("./audio-inject");
const moderator = require("./moderator");
const { getWelcomeClip } = require("./tts");
const S = require("./selectors");

const MEET_URL = process.argv[2] || process.env.MEET_URL;
const BOT_NAME = process.env.BOT_NAME || "Live Tutor";

if (!MEET_URL || !/^https:\/\/meet\.google\.com\//.test(MEET_URL)) {
  console.error(
    "Provide a Meet URL.\n" +
      "  node bot/meet-bot.js https://meet.google.com/xxx-xxxx-xxx\n" +
      "  (or set MEET_URL in .env)",
  );
  process.exit(1);
}

const log = (...args) => console.log(`[meet-bot ${new Date().toISOString()}]`, ...args);

// Click a locator if it shows up within `timeout`, but never throw on absence —
// the join flow varies (signed in vs guest, popups that may or may not appear).
async function clickIfPresent(page, sel, timeout = 6000) {
  try {
    const loc = page.getByRole(sel.role, { name: sel.name }).first();
    await loc.waitFor({ state: "visible", timeout });
    await loc.click();
    return true;
  } catch {
    return false;
  }
}

// Meet bounces bad/expired/unstarted links to a "/_meet/whoops" page ("Invalid video call
// name", etc.). Throw a clear reason here so we don't waste 60s waiting for a join button
// that will never appear. Returns nothing; throws if we're on the error page.
async function assertNotErrorPage(page) {
  // Give a client-side redirect a moment to land before judging the URL.
  await page.waitForTimeout(1500);
  if (!S.errorPageUrl.test(page.url())) return;
  let reason = "";
  try {
    reason = (await page.getByRole("heading").first().innerText({ timeout: 2000 })).trim();
  } catch {
    // No heading readable — fall back to a generic message below.
  }
  throw new Error(
    `Meet rejected this link${reason ? `: "${reason}"` : ""}. ` +
      "Check MEET_URL — it may be wrong, expired, or for a meeting that hasn't started.",
  );
}

async function join(page) {
  log("Opening", MEET_URL);
  await page.goto(MEET_URL, { waitUntil: "domcontentloaded" });

  // Bail early on Meet's "Invalid video call name" / "whoops" page.
  await assertNotErrorPage(page);

  // Clear any interstitial popups.
  for (const sel of S.dismissButtons) await clickIfPresent(page, sel, 2500);

  // Guest name (only present when signed out).
  try {
    const nameField = page.getByRole(S.nameInput.role, { name: S.nameInput.name }).first();
    await nameField.waitFor({ state: "visible", timeout: 4000 });
    await nameField.fill(BOT_NAME);
    log(`Entered guest name: "${BOT_NAME}"`);
  } catch {
    log("No name field (likely signed in) — continuing.");
  }

  // Join muted with camera off.
  if (await clickIfPresent(page, S.micToggleOff, 4000)) log("Microphone off.");
  if (await clickIfPresent(page, S.camToggleOff, 4000)) log("Camera off.");

  // Join now (OPEN space) or ask to be admitted.
  if (await clickIfPresent(page, S.joinNow, 8000)) {
    log("Clicked 'Join now'.");
  } else if (await clickIfPresent(page, S.askToJoin, 8000)) {
    log("Clicked 'Ask to join' — waiting for the host to admit the bot.");
  } else {
    throw new Error("Could not find a join button — Meet UI may have changed (see selectors.js).");
  }

  // Confirm we're actually in: the "Leave call" control only exists in-call.
  const leave = page.getByRole(S.leaveCall.role, { name: S.leaveCall.name }).first();
  await leave.waitFor({ state: "visible", timeout: 60000 });
  log("✅ In the call.");
}

async function main() {
  log("Launching headed browser (persistent profile)…");
  const context = await launchBrowser();

  // Register the mic-injection override BEFORE any navigation, so it patches getUserMedia
  // ahead of Meet's own scripts. Applies to every page/frame in the context.
  await context.addInitScript(audioInject.initScript);

  const page = context.pages()[0] || (await context.newPage());

  // Floor-management handle; started after the welcome clip, stopped on the way out.
  let watch = null;

  // Leave gracefully on Ctrl+C.
  let leaving = false;
  const shutdown = async () => {
    if (leaving) return;
    leaving = true;
    log("Shutting down — leaving the call…");
    if (watch) watch.stop();
    await clickIfPresent(page, S.leaveCall, 3000);
    await context.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await join(page);

    // Greet the call. This both says hello and verifies the audio path is connected —
    // a human in the call hearing it confirms the injected mic works.
    try {
      await page.waitForTimeout(2000); // let Meet's audio pipeline settle after join
      log("Playing welcome audio…");
      await audioInject.speak(page, await getWelcomeClip());
      log("Welcome audio played.");
    } catch (err) {
      log("Welcome audio skipped:", err.message);
    }

    // Begin floor management: watch raised hands and give the floor to one student at a
    // time. Mute is best-effort — if the bot lacks host rights it degrades to a voice-only
    // handoff ("please unmute yourself"). The watcher also folds in the liveness check, so
    // it doubles as the keep-alive heartbeat.
    watch = moderator.startHandWatch(page, {
      onState: (s) =>
        log(
          `floor: ${s.state}` +
            (s.current ? ` (${s.current.name})` : "") +
            (s.degraded ? " [no mute rights — voice-only]" : ""),
        ),
    });
  } catch (err) {
    log("Join failed:", err.message);
    log("Leaving the window open for inspection. Press Ctrl+C to quit.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
