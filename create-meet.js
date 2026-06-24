// create-meet.js
//
// CLI counterpart to the server's GET /create-meet route: creates an OPEN Meet space and
// prints the join link, without running the HTTP server. Reuses the same OAuth client, so
// it relies on tokens.json already existing.
//
// Usage:
//   pnpm meet            # prints meetLink + details
//   node create-meet.js
//
// First time only: tokens are obtained through the browser consent flow, which needs the
// redirect server. If not authenticated yet, run `pnpm dev`, visit http://localhost:3000/auth
// once, then come back and run this.

require("dotenv").config();
const { SpacesServiceClient } = require("@google-apps/meet").v2;
const { oauth2Client, isAuthenticated } = require("./auth");

async function main() {
  if (!isAuthenticated()) {
    console.error(
      "Not authenticated yet — no tokens.json.\n" +
        "  1. pnpm dev\n" +
        "  2. open http://localhost:3000/auth and complete Google consent\n" +
        "  3. re-run: pnpm meet",
    );
    process.exit(1);
  }

  const meetClient = new SpacesServiceClient({ authClient: oauth2Client });

  const [space] = await meetClient.createSpace({
    space: {
      config: {
        accessType: "OPEN", // anyone with the link can join
        moderation: "ON", // host management on by default → the bot can "Mute all" on join
      },
    },
  });

  // Human-friendly summary, then the bare link last so it's easy to copy/pipe.
  console.log("spaceId:    ", space.name); // spaces/...
  console.log("meetingCode:", space.meetingCode); // xxx-xxxx-xxx
  console.log("meetLink:   ", space.meetingUri);
  console.log("\nSend the bot in with:\n  pnpm bot " + space.meetingUri);
}

main().catch((err) => {
  console.error("createSpace failed:", err.message);
  process.exit(1);
});
