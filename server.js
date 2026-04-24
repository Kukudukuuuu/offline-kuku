const http = require("http");
const WebSocket = require("ws");
const os = require("os");

const PORT = process.env.PORT || 4242;
const HISTORY_SIZE = 80;
const PING_INTERVAL = 25_000;
const PING_TIMEOUT  = 10_000;
const RATE_LIMIT    = 5;
const RATE_WINDOW   = 1_000;
const TYPING_TTL    = 4_000;

// ── helpers ──────────────────────────────────────────────────────────────────

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ── state ────────────────────────────────────────────────────────────────────

const clients      = new Map();   // ws -> info
const history      = [];          // recent message ring buffer
const typingTimers = new Map();   // username -> timeout

const COLORS = [
  "#7fdbca","#f9a875","#ff7eb6","#b8cc52",
  "#6fc3df","#e0c06e","#c586c0","#4ec9b0",
  "#f78c6c","#a9dc76","#ffd866","#78dce8",
];
let colorIdx = 0;

function usernameInUse(name) {
  for (const info of clients.values()) {
    if (info.username && info.username.toLowerCase() === name.toLowerCase()) return true;
  }
  return false;
}

// ── broadcast ────────────────────────────────────────────────────────────────

function broadcast(data, exclude = null) {
  const raw = JSON.stringify(data);
  for (const ws of clients.keys()) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) ws.send(raw);
  }
}

function sendUserList() {
  const users = [...clients.values()]
    .filter(c => c.username)
    .map(c => ({ username: c.username, color: c.color }));
  broadcast({ type: "userlist", users });
}

function sendTypingList() {
  const typing = [...clients.values()]
    .filter(c => c.username && c.isTyping)
    .map(c => c.username);
  broadcast({ type: "typing", users: typing });
}

// ── connection handler ───────────────────────────────────────────────────────

const server = http.createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("KUKU Chat Server\n");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress || "?";

  const info = {
    username:  null,
    color:     COLORS[colorIdx++ % COLORS.length],
    isTyping:  false,
    msgCount:  0,
    rateReset: Date.now() + RATE_WINDOW,
    pingTimer: null,
    pongTimer: null,
    alive:     true,
  };
  clients.set(ws, info);

  // heartbeat
  function schedulePing() {
    info.pingTimer = setTimeout(() => {
      if (!info.alive) { ws.terminate(); return; }
      info.alive = false;
      ws.ping();
      info.pongTimer = setTimeout(() => ws.terminate(), PING_TIMEOUT);
    }, PING_INTERVAL);
  }

  ws.on("pong", () => {
    info.alive = true;
    clearTimeout(info.pongTimer);
    schedulePing();
  });
  schedulePing();

  // rate limiter
  function rateOk() {
    const now = Date.now();
    if (now > info.rateReset) { info.msgCount = 0; info.rateReset = now + RATE_WINDOW; }
    return ++info.msgCount <= RATE_LIMIT;
  }

  // typing helpers
  function startTyping() {
    if (!info.isTyping) { info.isTyping = true; sendTypingList(); }
    clearTimeout(typingTimers.get(info.username));
    typingTimers.set(info.username, setTimeout(stopTyping, TYPING_TTL));
  }

  function stopTyping() {
    if (!info.isTyping) return;
    info.isTyping = false;
    clearTimeout(typingTimers.get(info.username));
    typingTimers.delete(info.username);
    sendTypingList();
  }

  // cleanup
  function cleanup() {
    clearTimeout(info.pingTimer);
    clearTimeout(info.pongTimer);
    clients.delete(ws);
    if (info.username) {
      stopTyping();
      broadcast({ type: "system", text: `${info.username} left`, ts: Date.now() });
      sendUserList();
      console.log(`[-] ${info.username} (${ip})`);
    }
  }

  ws.on("close", cleanup);
  ws.on("error", (err) => { console.error(`[err] ${info.username || ip}: ${err.message}`); cleanup(); });

  // messages
  ws.on("message", (raw) => {
    if (!rateOk()) {
      safeSend(ws, { type: "error", text: "You're sending too fast — slow down." });
      return;
    }

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── JOIN ──
    if (msg.type === "join") {
      if (info.username) return;

      let name = String(msg.username || "anon")
        .trim().slice(0, 24)
        .replace(/[<>"'\\]/g, "")
        .replace(/\s+/g, "_") || "anon";

      // deduplicate
      if (usernameInUse(name)) {
        let n = 2;
        while (usernameInUse(`${name}${n}`)) n++;
        name = `${name}${n}`;
      }

      info.username = name;
      safeSend(ws, { type: "welcome", color: info.color, username: name, history: [...history] });
      broadcast({ type: "system", text: `${name} joined`, ts: Date.now() }, ws);
      sendUserList();
      console.log(`[+] ${name} (${ip})`);
      return;
    }

    // must be joined for everything else
    if (!info.username) { safeSend(ws, { type: "error", text: "Not joined yet." }); return; }

    // ── MESSAGE ──
    if (msg.type === "message") {
      const text = String(msg.text || "").slice(0, 2000).trim();
      if (!text) return;
      stopTyping();
      const packet = { type: "message", username: info.username, color: info.color, text, ts: Date.now() };
      broadcast(packet);
      history.push(packet);
      if (history.length > HISTORY_SIZE) history.shift();
      console.log(`[msg] ${info.username}: ${text.slice(0, 80)}`);
      return;
    }

    // ── TYPING ──
    if (msg.type === "typing") { startTyping(); return; }

    // ── NICK ──
    if (msg.type === "nick") {
      let newName = String(msg.username || "").trim().slice(0, 24)
        .replace(/[<>"'\\]/g, "").replace(/\s+/g, "_");
      if (!newName) { safeSend(ws, { type: "error", text: "Name can't be empty." }); return; }
      if (newName.toLowerCase() === info.username.toLowerCase()) return;
      if (usernameInUse(newName)) { safeSend(ws, { type: "error", text: `"${newName}" is taken.` }); return; }

      const old = info.username;
      info.username = newName;
      safeSend(ws, { type: "nick_ok", username: newName, color: info.color });
      broadcast({ type: "system", text: `${old} renamed to ${newName}`, ts: Date.now() });
      sendUserList();
      console.log(`[nick] ${old} → ${newName}`);
      return;
    }
  });
});

// ── graceful shutdown ────────────────────────────────────────────────────────
function shutdown(sig) {
  console.log(`\n[${sig}] shutting down…`);
  broadcast({ type: "system", text: "Server is shutting down.", ts: Date.now() });
  setTimeout(() => wss.close(() => server.close(() => process.exit(0))), 600);
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── start ────────────────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  const ips = getLocalIPs();
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║      KUKU Chat SERVER  —  online           ║");
  console.log("╠════════════════════════════════════════════╣");
  const addrs = ips.length ? ips.map(a => `ws://${a}:${PORT}`) : [`ws://localhost:${PORT}`];
  for (const a of addrs) console.log(`║  ${pad(a, 42)} ║`);
  console.log("╠════════════════════════════════════════════╣");
  console.log(`║  history ${HISTORY_SIZE} msgs · ping ${PING_INTERVAL/1000}s · rate ${RATE_LIMIT}/s      ║`);
  console.log("╚════════════════════════════════════════════╝\n");
});