// board-server.js
//
// Tiny static file server for the Tutor board page (bot/board/). The meet bot opens this in a
// second tab and screen-shares it. Serving over http (not file://) avoids ES-module/origin
// quirks with the import map + esm.sh imports. Uses Node's built-in http/fs — no extra
// dependency, and Express stays reserved for the control-plane process (server.js).

const http = require("http");
const fs = require("fs");
const path = require("path");

const BOARD_DIR = path.join(__dirname, "board");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

// Start the board server on an ephemeral loopback port. Resolves to { url, close }.
function start() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Map the request path to a file under BOARD_DIR (default index.html). Strip query/hash
      // and block traversal by confirming the resolved path stays inside BOARD_DIR.
      const rel = decodeURIComponent((req.url || "/").split(/[?#]/)[0]);
      const file = path.join(BOARD_DIR, rel === "/" ? "index.html" : rel);
      if (file !== BOARD_DIR && !file.startsWith(BOARD_DIR + path.sep)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      fs.readFile(file, (err, body) => {
        if (err) {
          res.writeHead(404).end("Not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        });
        res.end(body);
      });
    });

    server.on("error", reject);
    // Port 0 -> the OS picks a free port; bind to loopback so the board is never exposed off-box.
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

module.exports = { start, BOARD_DIR };
