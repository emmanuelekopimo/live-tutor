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

  // Join buttons. "Join now" appears for OPEN spaces / signed-in users;
  // "Ask to join" appears when the bot must be admitted by the host.
  joinNow: { role: "button", name: /join now/i },
  askToJoin: { role: "button", name: /ask to join/i },

  // In-call indicator — its presence confirms we actually got in.
  leaveCall: { role: "button", name: /leave call/i },

  // Occasional dismissible popups on the way in.
  dismissButtons: [
    { role: "button", name: /^got it$/i },
    { role: "button", name: /^dismiss$/i },
    { role: "button", name: /^close$/i },
    { role: "button", name: /continue without/i }, // "Continue without microphone and camera"
  ],
};
