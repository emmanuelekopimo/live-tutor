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

const fs = require("fs");
const path = require("path");
const S = require("./selectors");
const tts = require("./tts");
const audioInject = require("./audio-inject");

const log = (...args) => console.log(`[moderator ${new Date().toISOString()}]`, ...args);

// BOT_DEBUG=1 logs scan summaries to the console; BOT_DEBUG_DOM=1 streams full DOM
// snapshots (listitems + relevant controls, with outerHTML) to bot/debug/ for inspection.
const DEBUG_DOM = /^(1|true|yes)$/i.test(process.env.BOT_DEBUG_DOM || "");
const DEBUG_DIR = path.join(__dirname, "debug");
const DEBUG_SESSION = new Date().toISOString().replace(/[:.]/g, "-");

// Append one labelled DOM snapshot (JSONL) so a whole session can be replayed/inspected.
// No-op unless BOT_DEBUG_DOM is set. Captures the People-panel rows and any mute/hand/host
// controls verbatim (outerHTML) — exactly what we need to fix drifting selectors.
async function writeDomSnapshot(page, label) {
  if (!DEBUG_DOM) return;
  try {
    const data = await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const pick = (el) => ({
        tag: el.tagName,
        role: el.getAttribute("role") || "",
        aria: el.getAttribute("aria-label") || "",
        text: norm(el.textContent).slice(0, 100),
        html: el.outerHTML.slice(0, 3000),
      });
      const listitems = Array.from(document.querySelectorAll('[role="listitem"]')).map(pick);
      const controls = Array.from(
        document.querySelectorAll('button,[role="button"],[role="switch"],[role="checkbox"],[role="menuitem"]'),
      )
        .filter((el) => /mute|hand|host|manage|lower/i.test((el.getAttribute("aria-label") || "") + " " + el.textContent))
        .map(pick);
      // Group every element carrying a data-participant-id (panel row AND video tile share
      // the id) — this confirms whether the tile's mic state is reachable by id, and what
      // muted/unmuted markers each surface exposes.
      const byParticipant = {};
      Array.from(document.querySelectorAll("[data-participant-id]")).forEach((el) => {
        const pid = el.getAttribute("data-participant-id");
        const labels = Array.from(el.querySelectorAll("*"))
          .map((c) => c.getAttribute && c.getAttribute("aria-label"))
          .filter(Boolean);
        (byParticipant[pid] = byParticipant[pid] || []).push({
          tag: el.tagName,
          role: el.getAttribute("role") || "",
          aria: el.getAttribute("aria-label") || "",
          text: norm(el.textContent).slice(0, 120),
          labels: labels.slice(0, 8),
        });
      });
      // Mic icon ligatures (mic / mic_off / mic_none) and which participant they belong to.
      const micIcons = Array.from(document.querySelectorAll("*"))
        .filter((el) => el.children.length === 0 && /^(mic|mic_off|mic_none|mic_external_on)$/.test(norm(el.textContent)))
        .map((el) => {
          const owner = el.closest("[data-participant-id]");
          return { ligature: norm(el.textContent), pid: owner ? owner.getAttribute("data-participant-id") : "" };
        });
      return { url: location.href, listitems, controls, byParticipant, micIcons };
    });
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const file = path.join(DEBUG_DIR, `dom-${DEBUG_SESSION}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), label, ...data }) + "\n");
  } catch (err) {
    log("DOM snapshot failed (continuing):", err.message);
  }
}

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

      // Debug payload: every short control mentioning "mute" — reveals the real "Mute all"
      // label/role so we can target it. Small/label-like only, to skip giant containers.
      const muteControls = nodes
        .filter((el) => {
          const blob = lc(ariaOf(el) + " " + el.textContent);
          return /mute/.test(blob) && el.children.length <= 4 && blob.length < 40;
        })
        .map((el) => ({ tag: el.tagName, role: roleOf(el) || "", aria: ariaOf(el), text: norm(el.textContent).slice(0, 40) }));

      return { open, sections: sections.map((s) => norm(s.textContent)), hands, listitems, muteControls };
    });
  } catch (err) {
    return { open: false, sections: [], hands: [], listitems: [], muteControls: [], error: err.message };
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
// Whether the bot can mute others. The host-only per-participant mic control ("Mute …
// microphone" / "You can't unmute someone else") and our own "Meeting host" tag only exist
// for a host/co-host, so their presence is the signal. Cached once definitively true.
let _hostRights = false;
async function hasHostRights(page) {
  if (_hostRights) return true;
  await openPeoplePanel(page);
  const scan = await scanPanel(page);
  const ownHostTag = scan.listitems.some((li) => /\(you\)/i.test(li.text) && /meeting host|co-?host/i.test(li.text));
  if (ownHostTag || scan.muteControls.length > 0) _hostRights = true;
  return _hostRights;
}

// Mute everyone in the room. Host management ("Mute all") is NOT required and often off, so
// we mute each participant individually via the host's per-row "Mute …'s microphone" button
// — repeatedly clicking the first available one until none remain (the list re-renders as
// each goes muted). Returns the number muted this pass (0 = already-muted or no rights).
async function muteAll(page) {
  await openPeoplePanel(page);
  let muted = 0;
  for (let i = 0; i < 25; i++) {
    // The clickable control is a <button> whose accessible name is "Mute <name>'s microphone".
    const btn = page.getByRole("button", { name: /mute\b.*microphone/i }).first();
    if (!(await btn.isVisible({ timeout: 600 }).catch(() => false))) break;
    await btn.click().catch(() => {});
    await clickIfPresent(page, { role: "button", name: /^mute$/i }, 600); // confirm dialog, if any
    muted += 1;
    await page.waitForTimeout(250); // let the row re-render to its muted state
  }
  if (muted === 0 && DEBUG) {
    const scan = await scanPanel(page);
    log("DEBUG mute controls:", JSON.stringify(scan.muteControls, null, 2));
  }
  return muted;
}

// Best-effort mute of one participant by name via the inline "Mute …'s microphone" button.
async function muteParticipant(page, name) {
  await openPeoplePanel(page);
  try {
    const rowSel = S.participantRow(name);
    const row = page.getByRole(rowSel.role, { name: rowSel.name }).first();
    await row.waitFor({ state: "visible", timeout: 2000 });
    await row.hover(); // control may only fully render on hover
    const btn = row.getByRole("button", { name: /mute\b.*microphone/i }).first();
    if (!(await btn.isVisible({ timeout: 1000 }).catch(() => false))) return false; // already muted / no rights
    await btn.click().catch(() => {});
    await clickIfPresent(page, { role: "button", name: /^mute$/i }, 800); // confirm dialog, if any
    return true;
  } catch (err) {
    log(`muteParticipant(${name}) failed (continuing):`, err.message);
    return false;
  }
}

// Best-effort read of a participant's mic state. The People-panel row's mute button is
// ALWAYS "Mute X's microphone" (useless as a state signal); the real signal is the icon
// ligature on the participant's VIDEO TILE — "mic_off" when muted, "mic_none" when unmuted.
// Row and tile share a stable data-participant-id, so we read EVERY element carrying that
// id (precisely, to avoid reading a neighbour tile's icon). Returns "muted" | "unmuted" |
// "unknown" — callers must treat "unknown" as no information, never as a state change.
async function participantMicState(page, name) {
  try {
    return await page.evaluate((target) => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const t = target.toLowerCase();
      const rows = Array.from(document.querySelectorAll('[role="listitem"]'));
      const row = rows.find((el) => norm(el.getAttribute("aria-label") || el.textContent).toLowerCase().startsWith(t));
      const pid = row && row.getAttribute("data-participant-id");
      if (!pid) return "unknown";
      const els = Array.from(document.querySelectorAll("[data-participant-id=" + JSON.stringify(pid) + "]"));
      const blob = els
        .map((el) => {
          const labels = Array.from(el.querySelectorAll("*"))
            .map((c) => c.getAttribute && c.getAttribute("aria-label"))
            .filter(Boolean)
            .join(" ");
          return el.textContent + " " + labels;
        })
        .join(" ")
        .toLowerCase();
      // Muted: the crossed-mic icon or the disabled-unmute tooltip.
      if (/mic_off|can'?t unmute|cannot unmute/.test(blob)) return "muted";
      // Unmuted: the live mic icon. (We deliberately do NOT use "Mute X's microphone" — it's
      // present in every state — so absence of a real mic icon stays "unknown".)
      if (/mic_none|mic_external_on|\bmic\b/.test(blob)) return "unmuted";
      return "unknown";
    }, name);
  } catch {
    return "unknown";
  }
}

// Best-effort lower of one participant's raised hand (host action). The Raised-hands row
// exposes a button with aria-label "Lower <name>'s hand" (text "Lower") — confirmed via
// BOT_DEBUG. All clicks use short, explicit timeouts and force:true so a not-yet-hovered
// (opacity:0) control never stalls the loop (a default-timeout hover previously hung 30s).
async function lowerHand(page, name) {
  await openPeoplePanel(page);
  // 1) The per-person lower-hand button (name in the accessible label → unambiguous).
  const direct = page.getByRole("button", { name: new RegExp(`lower ${escapeRe(name)}'?s hand`, "i") }).first();
  if ((await direct.count().catch(() => 0)) > 0) {
    if (await direct.click({ force: true, timeout: 2500 }).then(() => true).catch(() => false)) return true;
  }
  // 2) Last resort: "Lower all hands". Safe here because we run one speaker at a time and a
  // re-raised hand would simply be re-detected next poll.
  const all = page.getByRole("button", { name: /lower all hands?/i }).first();
  if ((await all.count().catch(() => 0)) > 0) {
    if (await all.click({ force: true, timeout: 2500 }).then(() => true).catch(() => false)) return true;
  }
  return false;
}

// Escape a participant name for safe inclusion in a RegExp.
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Start the floor-management loop. Non-blocking; returns a handle with .stop().
//
// State machine (one speaker at a time):
//   IDLE      -> a hand is up              -> CLAIMING
//   CLAIMING  -> mute room + call name     -> WAITING
//   WAITING   -> student unmutes           -> lower their hand -> SPEAKING
//             -> hand dropped / no unmute  -> RELEASING
//   SPEAKING  -> student re-mutes / timeout -> RELEASING
//   RELEASING -> re-mute room, clear       -> IDLE
// `degraded` is an overlay (no mute rights), not a state: same transitions, mutes skipped.
// Mic detection is best-effort: an "unknown" reading is never treated as a change, so if it
// fails the machine still advances via the hand-dropped / timeout paths.
function startHandWatch(page, opts = {}) {
  const cfg = {
    pollMs: 4000,
    unmuteTimeoutMs: 45000, // how long to wait for the called student to unmute
    speakerTimeoutMs: 120000, // max floor time once they're speaking
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
        // Best-effort floor clear. Host rights (not the mute count) decide degraded mode —
        // a count of 0 may just mean everyone was already muted.
        degraded = !(await hasHostRights(page));
        await muteAll(page);
        try {
          await cfg.speak(`I'll call on ${current.name}. Please unmute yourself and go ahead.`);
        } catch (err) {
          // Even if TTS/audio failed, the room may have gone quiet — advance so we don't wedge.
          log("Invite audio failed (continuing):", err.message);
        }
        current.since = Date.now(); // start the unmute clock after the invite is spoken
        state = "WAITING";
      } else if (state === "WAITING") {
        // Waiting for the called student to unmute. The moment they do, lower their hand and
        // hand them the floor. If they drop the hand without speaking, or never unmute,
        // release. (Check unmute FIRST so we lower the hand before Meet's own auto-lower.)
        const mic = await participantMicState(page, current.name);
        if (mic === "unmuted") {
          const lowered = await lowerHand(page, current.name);
          log(`${current.name} unmuted — ${lowered ? "lowered their hand." : "could not lower hand."}`);
          current.speakingSince = Date.now();
          state = "SPEAKING";
        } else if (!hands.includes(current.name)) {
          log(`${current.name} lowered their hand without speaking — releasing.`);
          state = "RELEASING";
        } else if (Date.now() - current.since > cfg.unmuteTimeoutMs) {
          log(`${current.name} never unmuted (timeout) — releasing.`);
          state = "RELEASING";
        }
      } else if (state === "SPEAKING") {
        // They have the floor (hand already lowered). Done when they re-mute or time out.
        // Only an explicit "muted" reading ends it — "unknown" must not, or we'd cut them off.
        const mic = await participantMicState(page, current.name);
        const timedOut = Date.now() - current.speakingSince > cfg.speakerTimeoutMs;
        if (mic === "muted" || timedOut) {
          log(timedOut ? `Floor timeout for ${current.name}.` : `${current.name} finished (re-muted).`);
          if (timedOut) {
            try {
              await cfg.speak(`Thank you, ${current.name}.`);
            } catch {
              /* non-fatal */
            }
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
      await writeDomSnapshot(page, state); // BOT_DEBUG_DOM only — stream DOM per tick
    } catch (err) {
      // A single DOM hiccup must never kill the loop.
      log("hand-watch tick error (continuing):", err.message);
    } finally {
      if (!stopped) timer = setTimeout(tick, cfg.pollMs);
    }
  }

  // Open the panel and mute the room ONCE on join, then start polling. As host we mute each
  // participant individually (Host management / "Mute all" not required). If we're not host,
  // hasHostRights() is false and we degrade to voice-only — the loop still runs.
  async function init() {
    await openPeoplePanel(page);
    await writeDomSnapshot(page, "join");
    degraded = !(await hasHostRights(page));
    const n = await muteAll(page);
    log(degraded ? "Not host — voice-only floor management." : `Muted the room on join (${n} muted).`);
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
  participantMicState,
  lowerHand,
  startHandWatch,
};
