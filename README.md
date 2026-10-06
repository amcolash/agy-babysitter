# agy-babysitter ⚡

A remote web babysitter and persistent terminal interface for [Antigravity](https://github.com/) (`agy`) with `zellij` session persistence, dynamic window resizing, interactive folder picker with scoped root directory tabs, automatic folder-based session naming, and mobile-friendly control actions.

---

## Features

- 🔌 **Zellij Session Persistence**: Sessions stay alive on the host even if you close the browser, lose network connection, or switch devices.
- 🏷️ **Smart Folder-Based Session Naming**:
  - Automatically names sessions after the directory folder they are started in.
  - Automatically hyphenates duplicate session names (`folder`, `folder-2`, `folder-3`, etc.).
- 🗂️ **Scoped Folder Picker**:
  - Configurable allowed directories array in `.env` (e.g. `~/Dev,~/Desktop,~/Github`).
  - Restricts session starting directories to direct 1-level non-hidden subfolders within the allowed roots.
  - Interactive UI with root tabs (`📁 ~/Github`, `📁 ~/Dev`, `📁 ~/Desktop`), search filtering, and instant folder selection.
- ❌ **Session Lifecycle Management**: Easily terminate/close sessions directly from the UI (`✕`) or CLI.
- 📐 **Automatic Wrapping & Dynamic Resizing**: Syncs browser dimensions (`xterm.js` + `FitAddon`) to `node-pty` and `zellij` on the fly.
- 🎮 **Babysitter Quick Actions**: Easy one-tap navigation controls with mobile-friendly floating speed dial (Escape, Up, Down, Enter).
- 🎨 **Doom One Color Theme**: Styled with the iconic Doom One dark palette (`#282c34`, `#21242b`, `#51afef`, `#98be65`, `#ff6c6b`, `#c678dd`, `#ECBE7B`).
- ⚡ **Vite + Tailwind CSS v4**: Fully self-hosted without external CDN dependencies, fast production bundling, and instant HMR development.
- 🔄 **Auto-Reconnect & Live Refresh**: Automatically attempts WebSocket reconnection every few seconds when disconnected, and auto-refreshes connected UI clients whenever frontend assets are changed.
- 📱 **Mobile & Desktop Responsive**: Clean dark theme optimized for both phone and desktop monitoring.

---

## Configuration (`.env`)

Configure your defaults and allowed directory roots in `.env`:

```env
PORT=8080
HOST=0.0.0.0
DEFAULT_SESSION=agy-main
DEFAULT_COMMAND=agy
ALLOWED_DIRECTORIES=~/Dev,~/Desktop,~/Github
DEFAULT_CWD=~/Github/my-project
```

---

## Available NPM Scripts

- `npm run dev` - Launches backend and dev server with instant watch mode.
- `npm run build` - Builds the production client assets into `dist/`.
- `npm start` - Runs the server locally.
- `npm run restart` - Restarts the background systemd service cleanly (or standalone if not using systemd).
- `npm run deploy` - One-step build and restart (`npm run build && npm run restart`).
- `npm run status` - Checks systemd service status.
- `npm run logs` - Streams live journal logs from systemd.
- `npm run session` - Attaches to (or creates) the default local zellij session.
- `npm run service:install` - Installs, enables, and starts the systemd user service.
- `npm run service:uninstall` - Disables and removes the systemd user service.

---

## Startup & Service Management

The server runs as a standard, minimal systemd user service (`agy-babysitter.service`):

1. **Install and Enable on Startup**:
   ```bash
   npm run service:install
   ```
   - Automatically starts on system boot (via `default.target` and `loginctl enable-linger`).
   - Restarts automatically if it crashes (`Restart=on-failure`).

2. **Deploying Changes**:
   Whenever you pull or update code, run:
   ```bash
   npm run deploy
   ```
   This compiles both frontend (`dist/client/`) and server backend (`dist/server/`) into `dist/`, locking the production build in place, and restarts the systemd service. Connected browser tabs automatically refresh without dropping active terminal sessions.

3. **Isolated Development**:
   Editing code in `src/` does not affect the running production daemon until you explicitly run `npm run deploy`. For active development with hot-reloading, run `npm run dev`.

4. **Service Controls**:
   - `npm run status` - View service health and memory usage.
   - `npm run logs` - Live log streaming.
   - `npm run restart` - Quick restart.

---

## Getting Started

1. **Install dependencies & build**:
   ```bash
   npm install
   npm run build
   npm start
   ```
2. Open `http://localhost:8080` (or `http://localhost:5173` if running `npm run dev`).
