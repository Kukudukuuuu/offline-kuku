# 📡 offline-kuku

> Offline real-time chat for devices on the same local network. No internet, no accounts, no cloud.

![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=node.js&logoColor=white)
![WebSockets](https://img.shields.io/badge/transport-websockets-4ec9b0?style=flat-square)
![zero deps](https://img.shields.io/badge/deps-1%20(ws)-b8cc52?style=flat-square)
![no internet](https://img.shields.io/badge/internet-not%20required-ff7eb6?style=flat-square)

---

## What is this

Two files. One Node.js server, one HTML client. One person starts the server, everyone on the same Wi-Fi opens `client.html` in a browser and connects. That's the whole thing.

Built with IBM Plex Mono and a terminal aesthetic. No frameworks, no build step, no accounts.

---

## Features

- **Real-time messaging** via WebSockets — near-instant delivery on LAN
- **Message history** — new joiners get the last 80 messages on connect
- **Typing indicators** — see who's composing in real time
- **Auto-reconnect** — exponential backoff reconnect when the connection drops
- **Message grouping** — consecutive messages from the same person stack cleanly
- **Sound notifications** — soft beep on incoming messages (toggleable)
- **Unread badge** — tab title shows `(3) LAN Chat` when the tab is in the background
- **Scroll-to-bottom button** — appears when you're scrolled up and new messages arrive
- **Username deduplication** — if `kuku` is taken, server assigns `kuku2` automatically
- **Rate limiting** — 5 messages/second per client
- **Ping/pong heartbeat** — dead connections get cleaned up after 25s
- **Commands** — `/nick <name>` to rename, `/clear` to wipe your local view
- **Graceful shutdown** — `Ctrl+C` broadcasts a warning before the server closes

---

## Requirements

- [Node.js](https://nodejs.org) ≥ 18
- A local network (same Wi-Fi or LAN)
- Any modern browser on the client devices

---

## Setup

```bash
git clone https://github.com/kukudukuuuu/offline-kuku
cd offline-kuku
npm install
```

---

## Usage

### 1 — Start the server (one machine only)

```bash
npm start
```

The terminal prints your local IP:

```
╔════════════════════════════════════════════╗
║      LAN CHAT SERVER  —  online            ║
╠════════════════════════════════════════════╣
║  ws://192.168.1.42:4242                    ║
╠════════════════════════════════════════════╣
║  history 80 msgs · ping 25s · rate 5/s     ║
╚════════════════════════════════════════════╝
```

Keep this terminal open.

### 2 — Connect (all devices)

Open `client.html` in a browser. No server required — it's a plain HTML file.

- **Server address** → paste the `ws://` address from step 1
- **Your name** → whatever you want
- Hit **Connect**

Repeat on every device. Done.

---

## Commands

Type these in the message bar:

| Command | What it does |
|---|---|
| `/nick <name>` | Change your display name |
| `/clear` | Clear the chat on your screen |

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4242` | Port the server listens on |

```bash
PORT=5000 npm start
```

---

## Firewall

The server machine may need to allow the port through its firewall.

**Windows** — Node.js will prompt automatically on first run. Click "Allow".

**Linux (ufw)**
```bash
sudo ufw allow 4242
```

**macOS** — usually works out of the box. If not, go to System Settings → Network → Firewall.

---

## File structure

```
offline-kuku/
├── server.js     # Node.js WebSocket server
├── client.html   # Standalone browser client (no build needed)
├── package.json
└── README.md
```

---

## How it works

The server is a plain Node.js HTTP + WebSocket (`ws`) server. On connection, it assigns the client a color, sends them the message history, and broadcasts their messages to all other connected clients. It runs a ping/pong heartbeat every 25 seconds to detect and clean up dead connections.

The client is a single self-contained HTML file with no external dependencies (except the IBM Plex Mono font from Google Fonts, which loads on first open if you have internet — falls back to monospace otherwise). It connects to the server via the browser's native `WebSocket` API, handles auto-reconnect with exponential backoff, and plays notification sounds via the Web Audio API.

---

## License

MIT
