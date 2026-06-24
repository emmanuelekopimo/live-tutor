require("dotenv").config();
const express = require("express");
const { SpacesServiceClient } = require("@google-apps/meet").v2;
const { oauth2Client, getAuthUrl, getTokens, isAuthenticated } = require("./auth");

const app = express();

// Auth routes
app.get("/auth", (req, res) => {
  res.redirect(getAuthUrl());
});

app.get("/auth/callback", async (req, res) => {
  await getTokens(req.query.code);
  res.send("Authenticated. You can close this tab.");
});

// Create Meet — immediately joinable
app.get("/create-meet", async (req, res) => {
  // Guard: if we have no credentials yet, send the user through OAuth first.
  if (!isAuthenticated()) {
    return res.redirect("/auth");
  }

  try {
    const meetClient = new SpacesServiceClient({
      authClient: oauth2Client,
    });

    const [space] = await meetClient.createSpace({
      space: {
        config: {
          accessType: "OPEN", // anyone with the link can join
          moderation: "ON", // host management on by default → the bot can "Mute all" on join
        },
      },
    });

    res.json({
      meetLink: space.meetingUri, // https://meet.google.com/xxx-xxxx-xxx
      spaceId: space.name, // spaces/jQCFfuBOdN5z (save this for later)
      meetingCode: space.meetingCode, // xxx-xxxx-xxx
    });
  } catch (err) {
    console.error("createSpace failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Running on http://localhost:3000"));
