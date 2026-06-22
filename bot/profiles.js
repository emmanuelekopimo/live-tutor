// profiles.js
//
// Lists the Chrome profiles on this machine and their directory names, so you know what
// to put in CHROME_PROFILE_DIRECTORY. The "directory" (e.g. "Profile 12") is what the
// bot needs — NOT the display name you see in Chrome.
//
//   node bot/profiles.js     (or: pnpm profiles)

const { listProfiles, USER_DATA_DIR } = require("./browser");

const rows = listProfiles();
console.log(`Chrome User Data dir: ${USER_DATA_DIR}\n`);
if (!rows.length) {
  console.log("No profiles found (is Chrome installed at the default location?).");
  process.exit(0);
}
for (const { dir, name, email } of rows) {
  console.log(`  CHROME_PROFILE_DIRECTORY="${dir}"   ${name}${email ? `  <${email}>` : ""}`);
}
