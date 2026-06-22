// auth.js
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const TOKEN_PATH = path.join(__dirname, "tokens.json");

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "http://localhost:3000/auth/callback",
);

const SCOPES = ["https://www.googleapis.com/auth/meetings.space.created"];

// Reload saved tokens on startup so a server restart doesn't lose auth.
if (fs.existsSync(TOKEN_PATH)) {
  oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")));
}

// Persist refreshed tokens (the library emits this when it refreshes).
oauth2Client.on("tokens", (tokens) => {
  const merged = { ...oauth2Client.credentials, ...tokens };
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
});

function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token to be returned
    scope: SCOPES,
  });
}

async function getTokens(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return tokens;
}

function isAuthenticated() {
  const c = oauth2Client.credentials;
  return Boolean(c && (c.refresh_token || c.access_token));
}

module.exports = { oauth2Client, getAuthUrl, getTokens, isAuthenticated };
