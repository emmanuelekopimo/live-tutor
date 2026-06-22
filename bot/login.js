// login.js
//
// One-time helper: opens the bot's persistent-profile browser at Google's sign-in page
// so you can log in BY HAND (including 2FA). The session is saved into
// .playwright-profile/ and reused by meet-bot.js, so the bot joins as a real,
// identified participant instead of a blocked anonymous guest.
//
// Usage:
//   node bot/login.js     (or: pnpm bot:login)
// Then sign in, and press ENTER in this terminal to save & close.

require("dotenv").config();
const { launchBrowser, CHANNEL } = require("./browser");

(async () => {
  console.log(`Launching ${CHANNEL === "chromium" ? "bundled Chromium" : CHANNEL} with the bot's profile…`);
  const context = await launchBrowser();
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://accounts.google.com/");

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log(" A browser window is open on the bot's DEDICATED profile.");
  console.log(" Sign in as the account the bot should use (e.g. team.toonitt@gmail.com).");
  console.log(" Complete any 2FA.");
  console.log("");
  console.log(' If Google says "this browser may not be secure", quit (Ctrl+C),');
  console.log(" make sure real Chrome is installed, and run this again.");
  console.log("");
  console.log(" When your account shows as signed in, come back here and press ENTER.");
  console.log("──────────────────────────────────────────────────────────────\n");

  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));

  await context.close();
  console.log("\n✅ Saved. The bot will reuse this login from .playwright-profile/.");
  process.exit(0);
})().catch((err) => {
  console.error("Login helper failed:", err.message);
  if (/executable doesn't exist|channel/i.test(err.message)) {
    console.error("Tip: Google Chrome may not be installed. Retry with BROWSER_CHANNEL=chromium.");
  }
  process.exit(1);
});
