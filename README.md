# agy-babysitter ⚡

A remote web babysitter and persistent terminal interface for [Antigravity](https://github.com/) (`agy`) with tmux session persistence, native CLI helper (`agyh`), dynamic window resizing, interactive folder picker with scoped root directory tabs, automatic folder-based session naming, and mobile-friendly control actions.

---

## Features

- 🔌 **Tmux Session Persistence**: Sessions stay alive 24/7 on the host under systemd even if you close the browser, lose network connection, or switch devices.
- ⚡ **Zero-Lag Native CLI (`agyh`)**: Direct native terminal attachment in Kitty/Konsole/Alacritty with full TUI navigation and `Ctrl+b d` detach.
- 🔔 **Deterministic Lifecycle Hooks**: Instant prompt detection and completion chimes via Antigravity's global hooks (`~/.gemini/config/hooks.json`).
- 🏷️ **Smart Folder-Based Session Naming**:
  - Automatically names sessions after the directory folder they are started in.
  - Automatically hyphenates duplicate session names (`folder`, `folder-2`, `folder-3`, etc.).
- 🗂️ **Scoped Folder Picker**:
  - Configurable allowed directories array in `.env` (e.g. `~/Dev,~/Desktop,~/Github`).
  - Restricts session starting directories to direct 1-level non-hidden subfolders within the allowed roots.
  - Interactive UI with root tabs (`📁 ~/Github`, `📁 ~/Dev`, `📁 ~/Desktop`), search filtering, and instant folder selection.
- ❌ **Session Lifecycle Management**: Easily terminate/close sessions directly from the UI (`✕`) or CLI.
- 📐 **Automatic Wrapping & Dynamic Resizing**: Syncs browser dimensions (`xterm.js` + `FitAddon`) to `node-pty` and `tmux` on the fly.
- 🎮 **Babysitter Quick Actions**: Easy one-tap navigation controls with mobile-friendly floating speed dial (Approve, Deny, Interrupt, Enter).
- 🎨 **Doom One Color Theme**: Styled with the iconic Doom One dark palette (`#282c34`, `#21242b`, `#51afef`, `#98be65`, `#ff6c6b`, `#c678dd`, `#ECBE7B`).
- ⚡ **Vite + Tailwind CSS v4**: Fully self-hosted without external CDN dependencies, fast production bundling, and instant HMR development.
- 🔄 **Auto-Reconnect & Live Refresh**: Automatically attempts WebSocket reconnection every few seconds when disconnected, and auto-refreshes connected UI clients whenever frontend assets are changed.
- 📱 **Mobile & Desktop Responsive**: Clean dark theme optimized for both phone and desktop monitoring.

---

## Prerequisites

- **Linux** (systemd user services recommended)
- **Node.js** >= 18.0.0
- **tmux** (for background session persistence)
- **Antigravity CLI** (`agy`)

---

## Quick Start

1. **Clone the repository and install dependencies**:
   ```bash
   git clone https://github.com/amcolash/agy-babysitter.git
   cd agy-babysitter
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your preferred allowed directories and defaults
   ```

3. **Build and start**:
   ```bash
   npm run build
   npm start
   ```

4. **Access the Web UI**:
   Open `http://localhost:8080` (or `http://localhost:5173` if running `npm run dev`).

---

## Native CLI Helper (`agyh`)

`agyh` provides an interactive terminal UI and direct session attachment inside your favorite native terminal emulator (Kitty, Alacritty, Konsole, etc.).

### Installation

```bash
npm run cli:install
```

This creates a symlink at `~/.local/bin/agyh` and registers Antigravity lifecycle hooks automatically.

### Usage

```bash
# Interactive TUI session selector
agyh

# Open or create a session for a specific directory
agyh ~/Github/my-repo

# Attach to or create a named session
agyh my-session

# Service controls
agyh --status     # Check systemd service status
agyh --restart    # Restart agy-babysitter service
agyh --stop       # Stop agy-babysitter service
agyh --logs       # Follow live systemd journal logs
agyh --help       # Show help message
```

> **Tip**: Press `Ctrl+b d` inside any session to detach cleanly without stopping the session.

---

## Antigravity Lifecycle Hooks

`agy-babysitter` integrates with Antigravity's lifecycle hooks to notify the web UI and trigger audio chimes when user attention is needed or commands complete.

Install or update the hooks:
```bash
npm run hooks:install
```

Uninstall hooks:
```bash
npm run hooks:uninstall
```

---

## Configuration (`.env`)

Configure defaults and allowed directory roots in `.env`:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` | Port for the web interface and WebSocket server |
| `HOST` | `0.0.0.0` | Host interface to bind on |
| `DEFAULT_SESSION` | `agy-main` | Fallback session name if none provided |
| `DEFAULT_COMMAND` | `agy` | Default shell command executed in new sessions |
| `ALLOWED_DIRECTORIES` | `~/Dev,~/Desktop,~/Github` | Comma-separated root directory paths for the folder picker |
| `DEFAULT_CWD` | `~/Github/my-project` | Default working directory for the fallback session |

Example `.env`:
```env
PORT=8080
HOST=0.0.0.0
DEFAULT_SESSION=agy-main
DEFAULT_COMMAND=agy
ALLOWED_DIRECTORIES=~/Dev,~/Desktop,~/Github
DEFAULT_CWD=~/Github/my-project
```

---

## Startup & Service Management

`agy-babysitter` can run as a background systemd user service (`agy-babysitter.service`):

1. **Install and Enable on Startup**:
   ```bash
   npm run service:install
   ```
   - Automatically starts on system boot (via `default.target` and `loginctl enable-linger`).
   - Restarts automatically if it crashes (`Restart=on-failure`).

2. **Deploying Updates**:
   Whenever code changes or dependencies update:
   ```bash
   npm run deploy
   ```
   This compiles both frontend and server backend into `dist/`, locking the production build in place, and restarts the systemd service. Connected browser tabs automatically refresh without dropping active terminal sessions.

3. **Service Controls**:
   - `npm run status` - View service health and memory usage.
   - `npm run logs` - Live log streaming via `journalctl`.
   - `npm run restart` - Quick restart service.
   - `npm run stop` - Stop the service.
   - `npm run service:uninstall` - Disables and removes the systemd user service.

---

## Available NPM Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Launches backend with file watching and Vite dev server |
| `npm run build` | Builds production client (`dist/client`) and server (`dist/server`) |
| `npm start` | Runs the compiled production server |
| `npm run deploy` | Compiles production assets and restarts background service (`npm run build && npm run restart`) |
| `npm run restart` | Restarts the background systemd service cleanly |
| `npm run status` | Checks systemd service status |
| `npm run logs` | Streams live journal logs from systemd |
| `npm run session` | Launches interactive `agyh` CLI selector |
| `npm run cli:install` | Symlinks `agyh` to `~/.local/bin/` and configures hooks |
| `npm run cli:uninstall` | Removes `agyh` symlink from `~/.local/bin/` |
| `npm run hooks:install` | Configures Antigravity global lifecycle hooks |
| `npm run hooks:uninstall` | Removes Antigravity global lifecycle hooks |
| `npm run service:install` | Installs, enables, and starts the systemd user service |
| `npm run service:uninstall` | Disables and removes the systemd user service |

---

## License

[MIT](LICENSE) © 2026 Andrew McOlash
