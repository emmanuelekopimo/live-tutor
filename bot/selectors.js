// selectors.js
//
// Google Meet's DOM changes frequently. Keep every Meet-specific locator HERE so
// there is one place to update when the join flow breaks. Prefer accessible-name /
// aria-label matching (role + name) over CSS classes — names are far more stable.

module.exports = {
  // Pre-join screen: guest name field (only shown when signed out).
  nameInput: { role: "textbox", name: /your name/i },

  // Pre-join toggles. The aria-label says "Turn off ..." while the device is ON,
  // so clicking it mutes / disables the camera before we join.
  micToggleOff: { role: "button", name: /turn off microphone/i },
  camToggleOff: { role: "button", name: /turn off camera/i },

  // In-call unmute. The aria-label says "Turn on microphone" while muted — used to go live
  // just before the bot speaks, then we re-mute with micToggleOff.
  micToggleOn: { role: "button", name: /turn on microphone/i },

  // Join buttons. "Join now" appears for OPEN spaces / signed-in users;
  // "Ask to join" appears when the bot must be admitted by the host.
  joinNow: { role: "button", name: /join now/i },
  askToJoin: { role: "button", name: /ask to join/i },

  // In-call indicator — its presence confirms we actually got in.
  leaveCall: { role: "button", name: /leave call/i },

  // Bad/expired/unstarted link: Meet redirects to "/_meet/whoops" and shows a reason
  // heading ("Invalid video call name", "You can't join this video call", …). Detected
  // by URL so we can fail fast instead of grinding into a join timeout.
  errorPageUrl: /\/_meet\/whoops/,

  // Occasional dismissible popups on the way in.
  dismissButtons: [
    { role: "button", name: /^got it$/i },
    { role: "button", name: /^dismiss$/i },
    { role: "button", name: /^close$/i },
    { role: "button", name: /continue without/i }, // "Continue without microphone and camera"
  ],

  // --- People panel + moderation (Milestone 2: floor management) ---
  // Meet's people/hand-raise DOM is obfuscated and changes often. Everything below is
  // [VERIFY] — confirm against a LIVE call (role + accessible name vary by account/locale),
  // then tighten the regex and drop the flag. A stale selector here must only degrade the
  // bot to a passive participant, never crash it (the moderator treats all of these as
  // best-effort). The "Raised hands" section of the People panel is the one reliable,
  // ORDERED source of who has their hand up.

  // Toolbar control that opens the People panel. Name has varied between "People",
  // "Show everyone", and "People (N)". [VERIFY]
  peopleToggle: { role: "button", name: /people|show everyone/i },

  // The opened panel itself — used to confirm the toggle worked. Role is uncertain:
  // may be "dialog", "region", or "complementary". [VERIFY]
  peoplePanel: { role: "dialog", name: /people|participants/i },

  // "Raised hands" section header inside the panel. Its presence means >=1 hand is up;
  // the participant rows BELOW it are in raise order. [VERIFY]
  raisedHandsSection: { role: "heading", name: /raised hands?/i },

  // Host-only bulk control. Its ABSENCE is our signal that the bot has no mute rights. [VERIFY]
  muteAllButton: { role: "button", name: /mute all/i },

  // Per-row "More actions" kebab that reveals Mute / Lower hand for one participant. [VERIFY]
  moreActions: { role: "button", name: /more actions|more options/i },

  // Per-participant mute. May render as an inline "button" or a popup "menuitem". [VERIFY]
  muteParticipant: { role: "menuitem", name: /^mute/i },

  // Lower another participant's hand (host cleanup; optional). [VERIFY]
  lowerHand: { role: "menuitem", name: /lower hand/i },

  // A single participant row, addressed by the participant's name. This is a FUNCTION
  // (not a static object) because the accessible name is per-participant — a small,
  // deliberate deviation from the shape above. `name` may be a string or RegExp. [VERIFY]
  participantRow: (name) => ({ role: "listitem", name }),
};
