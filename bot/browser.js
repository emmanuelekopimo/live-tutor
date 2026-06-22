// browser.js
//
// Single source of truth for launching the bot's browser. The login script and the
// meet bot MUST use the same browser/profile, otherwise a saved Google sign-in won't
// carry over. Keep all launch config here.
//
// TWO MODES:
//
// 1. Dedicated bot profile (DEFAULT, recommended)
//    The bot uses its own user-data dir (BOT_PROFILE_DIR, default ./.bot-profile). It has
//    its own lock, so it COEXISTS with your normal Chrome being open. Sign in once with
//    `pnpm login` (as team.toonitt@gmail.com) and it's reused forever.
//
// 2. System Chrome profile (USE_SYSTEM_PROFILE=true)
//    The bot opens one of your installed Chrome profiles directly (CHROME_PROFILE_DIRECTORY,
//    e.g. "Profile 12"). No separate login needed — BUT Chrome locks the whole "User Data"
//    folder, so you must FULLY QUIT Chrome (every window, every profile) before running.
//
// Overridable via env:
//   BOT_PROFILE_DIR           dedicated profile dir (mode 1)
//   USE_SYSTEM_PROFILE        "true" to use mode 2
//   CHROME_USER_DATA_DIR      Chrome "User Data" folder (mode 2)
//   CHROME_PROFILE_DIRECTORY  profile sub-folder, e.g. "Profile 12" (mode 2)
//   BROWSER_CHANNEL           "chrome" (default) or "chromium"

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const USE_SYSTEM_PROFILE = /^(1|true|yes)$/i.test(process.env.USE_SYSTEM_PROFILE || "");

// Mode 1: dedicated bot profile dir.
const BOT_PROFILE_DIR =
  process.env.BOT_PROFILE_DIR || path.join(__dirname, "..", ".bot-profile");

// Mode 2: real Chrome "User Data" dir + a specific profile sub-folder.
const SYSTEM_USER_DATA_DIR =
  process.env.CHROME_USER_DATA_DIR ||
  path.join(
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"),
    "Google",
    "Chrome",
    "User Data",
  );
const PROFILE_DIRECTORY = process.env.CHROME_PROFILE_DIRECTORY || "Profile 12";

// Real Chrome handles Google sign-in far better than bundled Chromium.
const CHANNEL = process.env.BROWSER_CHANNEL || "chrome";

// Which dir the bot actually launches against.
const USER_DATA_DIR = USE_SYSTEM_PROFILE ? SYSTEM_USER_DATA_DIR : BOT_PROFILE_DIR;

async function launchBrowser() {
  const args = [
    "--use-fake-ui-for-media-stream", // auto-accept the camera/mic permission prompt
    "--use-fake-device-for-media-stream", // provide fake devices so Meet sees a mic/cam
    "--disable-blink-features=AutomationControlled",
  ];

  // Only select a sub-profile in system mode; the dedicated dir uses its own Default.
  if (USE_SYSTEM_PROFILE && PROFILE_DIRECTORY) {
    args.push(`--profile-directory=${PROFILE_DIRECTORY}`);
  }

  const opts = { headless: false, viewport: null, args };
  if (CHANNEL && CHANNEL !== "chromium") opts.channel = CHANNEL;

  let context;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, opts);
  } catch (err) {
    if (/existing browser session|ProcessSingleton|in use|already running|SingletonLock/i.test(err.message)) {
      const hint = USE_SYSTEM_PROFILE
        ? `You're in system-profile mode. Chrome locks its whole "User Data" folder, so you must\n` +
          `FULLY QUIT Google Chrome (every window + tray icon) before running the bot.\n` +
          `Or switch to the dedicated bot profile: unset USE_SYSTEM_PROFILE and run \`pnpm login\`.`
        : `Another instance is using ${USER_DATA_DIR}. Close any leftover bot window (or check\n` +
          `the tray), then try again.`;
      throw new Error(`Could not launch the browser.\n${hint}\n\nOriginal error: ${err.message}`);
    }
    throw err;
  }

  await context.grantPermissions(["microphone", "camera"], {
    origin: "https://meet.google.com",
  });

  return context;
}

// Helper for diagnostics / the `profiles` script: read Chrome's profile name map.
function listProfiles() {
  const localState = path.join(SYSTEM_USER_DATA_DIR, "Local State");
  if (!fs.existsSync(localState)) return [];
  const cache = JSON.parse(fs.readFileSync(localState, "utf8")).profile?.info_cache || {};
  return Object.entries(cache).map(([dir, info]) => ({
    dir,
    name: info.name,
    email: info.user_name || "",
  }));
}

module.exports = {
  launchBrowser,
  listProfiles,
  USER_DATA_DIR,
  SYSTEM_USER_DATA_DIR,
  USE_SYSTEM_PROFILE,
  PROFILE_DIRECTORY,
  CHANNEL,
};
