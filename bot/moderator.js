// moderator.js
//
// Milestone 2: the bot manages the meeting. It watches the People panel for raised
// hands and gives the floor to ONE student at a time, classroom-style.
//
// Hard constraint that shapes everything here: Google Meet does NOT let a host unmute
// another participant (blocked by design for privacy). So "giving the floor" can't mean
// force-unmuting — it means *floor-clearing*: mute everyone else (best-effort) and
// verbally call the student by name so they unmute themselves.
//
// Two failure realities are designed around, not against:
//   1. The bot may join as a plain participant with NO mute rights. Every mute call is
//      best-effort and returns a boolean; when muting isn't available the machine runs
//      the same flow minus the mutes ("degraded" / voice-only) — it never wedges.
//   2. Meet's people/hand-raise DOM is obfuscated and drifts. Selectors live in
//      selectors.js and are all [VERIFY]; a stale one here degrades the bot to a passive
//      participant (readRaisedHands -> []), never a crash.

const S = require("./selectors");
const tts = require("./tts");
const audioInject = require("./audio-inject");

const log = (...args) => console.log(`[moderator ${new Date().toISOString()}]`, ...args);

// Click a role+name control if it shows up in time; never throw. Mirrors the
// clickIfPresent/clickMic helpers already used in meet-bot.js and audio-inject.js.
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

// Is a role+name control currently visible? Used for host-rights probes and panel checks.
async function isVisible(page, sel, timeout = 2000) {
  try {
    const loc = page.getByRole(sel.role, { name: sel.name }).first();
    await loc.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

const DEBUG = /^(1|true|yes)$/i.test(process.env.BOT_DEBUG || "");

// One structured read of the People panel, role-agnostic and done in a single evaluate so
// we get a consistent snapshot. Meet's panel markup is obfuscated and drifts, so we anchor
// on stable visible TEXT ("Raised hands", "Add people", "Contributors") rather than on
// roles/classes. Returns { open, sections, hands, listitems } — hands is in raise order.
async function scanPanel(page) {
  try {
    return await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const lc = (s) => norm(s).toLowerCase();
      const nodes = Array.from(document.querySelectorAll("body *"));
      const pos = new Map(nodes.map((el, i) => [el, i]));
      const roleOf = (el) => el.getAttribute && el.getAttribute("role");
      const ariaOf = (el) => (el.getAttribute && el.getAttribute("aria-label")) || "";

      // A short element whose own text is just a label (not a big container).
      const isLabel = (el, re) => {
        const t = lc(el.textContent);
        return el.children.length <= 4 && t.length < 30 && re.test(t);
      };

      // Known section labels inside the panel, in document order. These only render while
      // the panel is open, so they double as an open-signal.
      const sectionRe = /^(raised hands?|contributors|in the meeting|viewers|on this call|invited)\b/;
      const sections = nodes
        .filter((el) => isLabel(el, sectionRe))
        .sort((a, b) => pos.get(a) - pos.get(b));

      // Panel open? "Add people" / "Search for people" are panel-only, as are the section
      // labels above — any of them present means the panel is showing.
      const open =
        sections.length > 0 ||
        nodes.some(
          (el) => el.children.length <= 3 && /^(add people|search for people)$/.test(lc(el.textContent)),
        );

      // The "Raised hands" section, if present, bounds the raised-hand rows.
      const rh = sections.find((el) => /^raised hands?\b/.test(lc(el.textContent)));
      const hands = [];
      if (rh) {
        const start = pos.get(rh);
        const next = sections.map((s) => pos.get(s)).filter((i) => i > start);
        const end = next.length ? Math.min(...next) : nodes.length;
        const seen = new Set();
        const stripControls = (s) =>
          norm(s).replace(/\s*(lower hand|raise hand|more (actions|options)|pin|mute|unmute|hand raised).*/i, "").trim();
        const controlRe = /(lower all|lower hand|raise hand|raised hand|more (actions|options)|^pin\b|^mute\b|^unmute\b)/i;

        // Primary: rows exposed as listitems — aria-label is the cleanest name.
        for (const el of nodes) {
          const i = pos.get(el);
          if (i <= start || i >= end) continue;
          if (roleOf(el) !== "listitem") continue;
          const name = stripControls(ariaOf(el) || el.textContent);
          if (name && !seen.has(name)) {
            seen.add(name);
            hands.push(name);
          }
        }

        // Fallback: panel rows aren't listitems — collect leaf text that looks like a name
        // (2–40 chars, not a number, not a control label) within the raised-hands range.
        if (hands.length === 0) {
          for (const el of nodes) {
            const i = pos.get(el);
            if (i <= start || i >= end) continue;
            if (el.children.length !== 0) continue; // leaf nodes only
            const t = norm(el.textContent);
            if (t.length < 2 || t.length > 40 || /^\d+$/.test(t) || controlRe.test(t)) continue;
            if (!seen.has(t)) {
              seen.add(t);
              hands.push(t);
            }
          }
        }
      }

      // Debug payload: every listitem's aria/text so we can see the real structure.
      const listitems = nodes
        .filter((el) => roleOf(el) === "listitem")
        .map((el) => ({ aria: ariaOf(el), text: norm(el.textContent).slice(0, 60) }));

      return { open, sections: sections.map((s) => norm(s.textContent)), hands, listitems };
    });
  } catch (err) {
    return { open: false, sections: [], hands: [], listitems: [], error: err.message };
  }
}

// Open the People panel and keep it open. We never click the toggle while it's already
// open (the toggle toggles — a stale "closed" reading would flap it shut every tick).
async function openPeoplePanel(page) {
  if ((await scanPanel(page)).open) return true;
  await clickIfPresent(page, S.peopleToggle, 3000);
  await page.waitForTimeout(800);
  return (await scanPanel(page)).open;
}

let _debugDumped = false;
function maybeDump(scan) {
  if (!DEBUG || _debugDumped) return;
  _debugDumped = true; // dump once — enough to read the structure
  log("DEBUG panel scan:", JSON.stringify({ open: scan.open, sections: scan.sections, hands: scan.hands }, null, 2));
  log("DEBUG listitems:", JSON.stringify(scan.listitems, null, 2));
}

// Read raised hands in raise order. [] when none are up or the panel can't be opened.
async function readRaisedHands(page) {
  if (!(await openPeoplePanel(page))) {
    if (DEBUG && !_debugDumped) log("DEBUG: People panel did not open — check S.peopleToggle.");
    return [];
  }
  const scan = await scanPanel(page);
  if (DEBUG && scan.hands.length === 0) maybeDump(scan);
  return scan.hands;
}

// Probe whether the bot can mute others. True iff a mute control is reachable
// (Mute all, or a per-row More-actions kebab). Cached once definitively true — rights
// don't get revoked mid-call, but absence is re-probed in case the bot is promoted.
let _hostRights = false;
async function hasHostRights(page) {
  if (_hostRights) return true;
  await openPeoplePanel(page);
  if ((await isVisible(page, S.muteAllButton, 800)) || (await isVisible(page, S.moreActions, 800))) {
    _hostRights = true;
  }
  return _hostRights;
}

// Best-effort mute-all. Returns false (and logs) when the control is absent (no rights).
// Meet usually pops a confirmation after "Mute all" — accept it if it appears.
async function muteAll(page) {
  await openPeoplePanel(page);
  if (!(await clickIfPresent(page, S.muteAllButton, 2500))) {
    log("Mute all unavailable — no host rights (voice-only).");
    return false;
  }
  // Confirmation dialog button is also "Mute all" (or just "Mute"); click it if present.
  await clickIfPresent(page, { role: "button", name: /^mute( all)?$/i }, 2500);
  return true;
}

// Best-effort mute of one participant by name: open their row's kebab, click Mute.
// Closes any opened menu (Escape) on failure so the panel isn't left in a bad state.
async function muteParticipant(page, name) {
  await openPeoplePanel(page);
  try {
    const rowSel = S.participantRow(name);
    const row = page.getByRole(rowSel.role, { name: rowSel.name }).first();
    await row.waitFor({ state: "visible", timeout: 2000 });
    await row.hover(); // some controls only appear on hover
    const kebab = row.getByRole(S.moreActions.role, { name: S.moreActions.name }).first();
    await kebab.click({ timeout: 2000 });
    const ok = await clickIfPresent(page, S.muteParticipant, 2000);
    if (!ok) await page.keyboard.press("Escape"); // no Mute item -> not host; close menu
    return ok;
  } catch (err) {
    log(`muteParticipant(${name}) failed (continuing):`, err.message);
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
}

// Start the floor-management loop. Non-blocking; returns a handle with .stop().
//
// State machine (one speaker at a time):
//   IDLE      -> a hand is up           -> CLAIMING
//   CLAIMING  -> mute room + call name  -> SPEAKING
//   SPEAKING  -> hand lowered / timeout -> RELEASING
//   RELEASING -> re-mute room, clear    -> IDLE
// `degraded` is an overlay (no mute rights), not a state: same transitions, mutes skipped.
function startHandWatch(page, opts = {}) {
  const cfg = {
    pollMs: 4000,
    speakerTimeoutMs: 120000,
    // Default voice path reuses the committed TTS + mic-injection pipeline.
    speak: async (text) => audioInject.speak(page, await tts.synthesize(text)),
    onState: null,
    ...opts,
  };

  let state = "IDLE";
  let current = null; // { name, since }
  let degraded = false;
  let stopped = false;
  let timer = null;

  const emit = (hands) => {
    if (cfg.onState) cfg.onState({ state, current, degraded, hands });
  };

  async function tick() {
    if (stopped) return;
    try {
      // Liveness, folded in so there's a single loop: if the Leave-call control is gone,
      // we've been dropped — nothing to moderate.
      const stillIn = await page
        .getByRole(S.leaveCall.role, { name: S.leaveCall.name })
        .first()
        .isVisible()
        .catch(() => false);
      if (!stillIn) {
        log("⚠️ No longer in the call — moderation idle.");
        emit([]);
        return;
      }

      const hands = await readRaisedHands(page);

      if (state === "IDLE") {
        if (hands.length > 0) {
          const next = hands[0];
          current = { name: next, since: Date.now() };
          state = "CLAIMING";
          log(`Hand up: ${next}. Clearing the floor.`);
        }
      }

      if (state === "CLAIMING") {
        // Best-effort floor clear. muteAll() result tells us if we have rights this run.
        const muted = await muteAll(page);
        degraded = !muted;
        try {
          await cfg.speak(`I'll call on ${current.name}. Please unmute yourself and go ahead.`);
        } catch (err) {
          // Even if TTS/audio failed, the room may have gone quiet — advance so we don't wedge.
          log("Invite audio failed (continuing):", err.message);
        }
        state = "SPEAKING";
      } else if (state === "SPEAKING") {
        const stillUp = hands.includes(current.name);
        const timedOut = Date.now() - current.since > cfg.speakerTimeoutMs;
        if (!stillUp || timedOut) {
          if (timedOut) {
            log(`Floor timeout for ${current.name}.`);
            try {
              await cfg.speak(`Thank you, ${current.name}.`);
            } catch {
              /* non-fatal */
            }
          } else {
            log(`${current.name} finished (hand lowered).`);
          }
          state = "RELEASING";
        }
      }

      if (state === "RELEASING") {
        await muteAll(page); // re-secure the room, best-effort
        current = null;
        state = "IDLE";
      }

      emit(hands);
    } catch (err) {
      // A single DOM hiccup must never kill the loop.
      log("hand-watch tick error (continuing):", err.message);
    } finally {
      if (!stopped) timer = setTimeout(tick, cfg.pollMs);
    }
  }

  // Open the panel and mute the room ONCE on join, then start polling. Muting needs host
  // rights; if absent it degrades to voice-only and the loop still runs.
  async function init() {
    await openPeoplePanel(page);
    const muted = await muteAll(page);
    degraded = !muted;
    log(muted ? "Muted the room on join." : "Join-mute unavailable (no host rights) — voice-only.");
  }

  init()
    .catch((err) => log("init error (continuing):", err.message))
    .finally(() => {
      if (!stopped) timer = setTimeout(tick, 500);
    });
  log("Floor management started.");
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      log("Floor management stopped.");
    },
  };
}

module.exports = {
  openPeoplePanel,
  readRaisedHands,
  hasHostRights,
  muteAll,
  muteParticipant,
  startHandWatch,
};
