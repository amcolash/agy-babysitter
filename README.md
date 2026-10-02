# agy-babysitter ⚡

A remote web babysitter and persistent terminal interface for [Antigravity](https://github.com/) (`agy`) with `tmux` session persistence, dynamic window resizing, interactive folder picker with scoped root directory tabs, automatic folder-based session naming, and mobile-friendly control actions.

---

## Features

- 🔌 **Tmux Session Persistence**: Sessions stay alive on the host even if you close the browser, lose network connection, or switch devices.
- 🏷️ **Smart Folder-Based Session Naming**:
  - Automatically names sessions after the directory folder they are started in.
  - Automatically hyphenates duplicate session names (`folder`, `folder-2`, `folder-3`, etc.).
- 🗂️ **Scoped Folder Picker**:
  - Configurable allowed directories array in `.env` (e.g. `~/Dev,~/Desktop,~/Github`).
  - Restricts session starting directories to direct 1-level non-hidden subfolders within the allowed roots.
  - Interactive UI with root tabs (`📁 ~/Github`, `📁 ~/Dev`, `📁 ~/Desktop`), search filtering, and instant folder selection.
- ❌ **Session Lifecycle Management**: Easily terminate/close sessions directly from the UI (`✕`) or CLI.
- 📐 **Automatic Wrapping & Dynamic Resizing**: Syncs browser dimensions (`xterm.js` + `FitAddon`) to `node-pty` and `tmux` on the fly.
- 🎮 **Babysitter Quick Actions**: Easy one-tap buttons for approval (`y`), denial (`n`), enter, and interrupt (`Ctrl + C`).
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

- `npm run dev` - Launches both the Express backend and Vite dev server with instant HMR.
- `npm run build` - Builds the frontend assets via Vite and Tailwind CSS v4 into `dist/`.
- `npm start` - Launches the production server serving the built `dist/` bundle.
- `npm run session` - Attaches to (or starts) a dedicated local `agy-main` tmux session from your terminal.

---

## Getting Started

1. **Install dependencies & build**:
   ```bash
   npm install
   npm run build
   npm start
   ```
2. Open `http://localhost:8080` (or `http://localhost:5173` if running `npm run dev`).
