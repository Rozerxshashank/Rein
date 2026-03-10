# Rein — Low-Latency Remote Input & Screen Mirror

Turn your phone into a wireless trackpad, keyboard, and screen viewer for your computer. Works on **Windows**, **Linux (including Wayland)**, and **macOS**.

## Features

- 🖱️ **Trackpad** — Move cursor, click, scroll, and zoom from your phone
- ⌨️ **Keyboard** — Type text and send key shortcuts remotely
- 🖥️ **Screen Mirror** — See your computer screen on your phone in real-time
- 🔒 **Token Auth** — Secure connections with auto-generated tokens
- 📱 **PWA Ready** — Install as an app on your phone via the browser

## Architecture

```
Phone (Browser)                     Host Computer (Node.js)
┌──────────────┐                    ┌──────────────────────┐
│  Trackpad UI │──── WebSocket ────▶│  InputHandler        │
│  Keyboard UI │    (JSON msgs)     │    ↓                 │
│              │                    │  NativeDriver (koffi)│
│  Mirror View │◀── WebSocket ─────│    ↓                 │
│  (Canvas)    │   (binary blobs)   │  OS API calls        │
└──────────────┘                    └──────────────────────┘
```

**Input:** Phone → WebSocket → InputHandler → NativeDriver (koffi FFI) → OS  
**Mirror:** OS Screen → Browser getDisplayMedia → WebSocket → Phone Canvas

## Prerequisites

| Requirement | Windows | Linux | macOS |
|---|---|---|---|
| **Node.js** | ≥ 18 | ≥ 18 | ≥ 18 |
| **npm** | ✅ bundled | ✅ bundled | ✅ bundled |
| **Permissions** | None | `input` group for `/dev/uinput` | Accessibility permission |

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/Rozerxshashank/reinimprovevd.git
cd reinimprovevd
npm install
```

### 2. Platform-Specific Setup

#### Windows
No extra setup needed. `koffi` loads `user32.dll` automatically.

#### Linux (X11 & Wayland)
Add your user to the `input` group for cursor/keyboard injection:

```bash
sudo usermod -aG input $USER
# Log out and log back in for this to take effect
```

Verify access:
```bash
ls -la /dev/uinput
# Should show: crw-rw---- 1 root input ...
```

#### macOS
Grant **Accessibility** permission to your terminal/IDE:

1. Go to **System Settings → Privacy & Security → Accessibility**
2. Add **Terminal** (or your IDE) to the allowed list

For screen mirroring, also grant **Screen Recording** permission:

1. Go to **System Settings → Privacy & Security → Screen Recording**
2. Add your **browser** (Chrome/Safari/Firefox)

## Running

### Development (recommended)

```bash
npm run dev
```

This starts the Vite dev server with hot-reload. Open `http://localhost:3000` on your computer.

### Using from your Phone

1. Make sure your phone and computer are on the **same WiFi network**
2. On your computer, open `http://localhost:3000/settings`
3. Note the **Server IP** shown (e.g., `192.168.1.42`)
4. On your phone browser, go to `http://<server-ip>:3000/trackpad`
5. The screen share popup will appear on your computer — select your screen
6. Start using the trackpad on your phone!

### Electron App (optional)

```bash
npm run electron-dev
```

### Production Build

```bash
npm run build
```

## Configuration

Edit `src/server-config.json`:

```json
{
  "host": "0.0.0.0",
  "frontendPort": 3000,
  "inputThrottleMs": 8
}
```

| Key | Description | Default |
|---|---|---|
| `host` | Bind address (`0.0.0.0` = all interfaces) | `0.0.0.0` |
| `frontendPort` | HTTP/WebSocket port | `3000` |
| `inputThrottleMs` | Min ms between input events | `8` |

## Project Structure

```
src/
├── server/
│   ├── websocket.ts        # WebSocket server & message routing
│   ├── NativeDriver.ts     # Koffi FFI input drivers (Win/Linux/macOS)
│   ├── InputHandler.ts     # Input throttling & dispatch
│   ├── KeyMap.ts           # Platform-specific key code maps
│   ├── getLocalIp.ts       # LAN IP resolution
│   └── tokenStore.ts       # Auth token management
├── hooks/
│   ├── useCaptureProvider.ts  # Screen capture (Worker-based timer)
│   └── useMirrorStream.ts    # Mirror frame consumer
├── components/
│   └── Trackpad/
│       └── ScreenMirror.tsx   # Mirror canvas UI
└── routes/
    ├── __root.tsx           # App root with auto-capture
    ├── trackpad.tsx         # Trackpad page
    └── settings.tsx         # Settings page
```

## Troubleshooting

| Issue | Solution |
|---|---|
| **Input not working (Linux)** | Run `sudo usermod -aG input $USER` and re-login |
| **Input not working (macOS)** | Grant Accessibility permission in System Settings |
| **Screen mirror black** | Grant Screen Recording permission to your browser |
| **Port already in use** | Kill zombie processes: `taskkill /F /IM node.exe /T` (Win) or `killall node` (Linux/macOS) |
| **High latency on tab switch** | This is expected — frame capture runs in a Web Worker to minimize throttling |

## License

See [LICENSE](./LICENSE) for details.
