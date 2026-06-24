// present.js
//
// Screen-share the Tutor board into the call. Mirrors the best-effort, never-throw style of
// moderator.js: every click is optional, so a stale selector degrades the bot (no board on
// screen) instead of crashing it. The native tab-picker is auto-resolved by the
// --auto-select-tab-capture-source-by-title launch flag (bot/browser.js), so this only has to
// drive Meet's own "Present now -> A tab" menu — there's no native dialog to click through.

const S = require("./selectors");

const log = (...args) => console.log(`[present ${new Date().toISOString()}]`, ...args);

// Click a role+name control if it shows up in time; never throw. Same shape as the helper in
// meet-bot.js / moderator.js.
async function clickIfPresent(page, sel, timeout = 4000) {
  try {
    const loc = page.getByRole(sel.role, { name: sel.name }).first();
    await loc.waitFor({ state: "visible", timeout });
    await loc.click();
    return true;
  } catch {
    return false;
  }
}

// Present the board tab into the call. Click "Present now"; depending on the Meet build that
// either opens an in-page submenu with "A tab" OR fires getDisplayMedia straight to Chrome's
// native picker. Either way the launch flags auto-pick the "Live Tutor Board" source (see
// bot/browser.js), so the "A tab" click is OPTIONAL — we never press Escape on the
// not-found path, since that would cancel an already-auto-accepted native share. Best-effort;
// must run on the MEET page (the gesture has to fire in Meet), which is kept in front so the
// Chrome window title isn't "Live Tutor Board" (which would get grabbed instead of the tab).
async function presentBoard(page) {
  await page.bringToFront().catch(() => {}); // present gesture fires on Meet; keeps it in front

  if (!(await clickIfPresent(page, S.presentNow, 6000))) {
    log("Present control not found — skipping board share (see selectors.js).");
    return false;
  }
  await page.waitForTimeout(600); // let the submenu / native picker come up

  // If Meet shows an in-page "A tab" option, choosing it narrows the picker to tabs. If it
  // doesn't appear, the native picker was already auto-resolved by the flags — leave it be.
  if (await clickIfPresent(page, S.presentTab, 2000)) {
    log("Chose 'A tab' from the present menu.");
  } else {
    log("No in-page 'A tab' option — relying on the launch-flag auto-select for the native picker.");
  }

  log("Presenting the board (auto-selecting source 'Live Tutor Board').");
  return true;
}

// Best-effort stop. Optional — leaving the call ends the share anyway.
async function stopPresenting(page) {
  return clickIfPresent(page, S.stopPresenting, 3000);
}

module.exports = { presentBoard, stopPresenting };
