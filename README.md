# Office Layout Viewer

An interactive office floor plan viewer with live asset overlays. Visualize the physical location of workstations, phones, printers, network drops, and security cameras — layered on top of your building map like transparent pages in an anatomy book.

Built with a **wayfinding kiosk** aesthetic: high-contrast dark theme, glowing cyan accents, touch-friendly controls, and a live clock status bar.

![Office Layout Viewer](https://raw.githubusercontent.com/yourusername/office-layout-viewer/main/docs/screenshot.png)

---

## Features

- **3/4 birds-eye perspective** floor plan with animated layer drop effect
- **6 overlay layers** — toggle on/off independently, each drops onto the map like a transparent sheet:
  - User Desks (name labels)
  - PCs / Workstations (asset tags)
  - Desk Phones (extensions)
  - Printers (model info)
  - Network Drops (wall, floor, patch panel)
  - Security Cameras (field-of-view indicators)
- **Multi-floor support** — add unlimited floors, each with its own map and asset data
- **Floor plan upload** — load any PNG, JPG, or SVG as the base map with adjustable opacity
- **Edit mode** — drag items to reposition, right-click to delete, click-to-place new items
- **Lansweeper sync** — pull live asset data from Lansweeper on-premise via GraphQL API
- **Unpositioned asset dock** — newly synced assets queue at the bottom until placed on the map
- **Import / Export** — full JSON state, or CSV for per-floor item lists
- **Persists to localStorage** — layout and positions survive page reloads and re-syncs
- **Kiosk-ready UI** — large touch targets, scanline grid animation, live clock, layer status bar

---

## Quick Start (standalone, no Lansweeper)

Just open `index.html` in a browser. No build step, no server required. The app comes pre-loaded with a sample Floor 1 layout.

---

## Quick Start (with Lansweeper sync)

Lansweeper sync requires the included Node.js proxy server (handles auth and CORS).

**Prerequisites:** Node.js 18+

```bash
# 1. Install dependencies
npm install

# 2. Configure Lansweeper connection
cp lansweeper.config.example.json lansweeper.config.json
# Edit lansweeper.config.json — fill in your token and siteId

# 3. Start the server
npm start

# 4. Open the app
# http://localhost:3000
```

---

## Lansweeper Configuration

Copy `lansweeper.config.example.json` to `lansweeper.config.json` and fill in your credentials.

> **Note:** `lansweeper.config.json` is gitignored — your token will never be committed.

```json
{
  "port": 3000,
  "lansweeper": {
    "apiUrl": "https://api.lansweeper.com/api/v2/graphql",
    "token": "your-personal-access-token",
    "siteId": "your-site-id"
  }
}
```

**Getting your token and site ID:**
1. Log in to Lansweeper
2. Go to **My Profile → Personal Access Tokens → Create token**
3. Your Site ID is in **Sites → [your site] → Settings → Site ID**

### Asset Type Mapping

Lansweeper reports assets with a `type` field. The `typeMapping` section in the config maps those strings to the viewer's categories. Adjust to match your Lansweeper scan results:

```json
"typeMapping": {
  "windows": "pc",
  "linux": "pc",
  "printer": "printer",
  "ip phone": "phone",
  "network camera": "camera"
}
```

After your first sync, check `GET /api/sync` — the response includes an `unknown` array listing any asset types that didn't match a mapping rule.

---

## Placing Synced Assets

When Lansweeper sync runs, new assets are queued in the **Unpositioned Assets** dock at the bottom of the screen. To place them on the map:

1. Click **Edit Mode** in the toolbar
2. Click **PLACE** on any asset chip in the dock — it drops at the map center
3. Drag it to the correct position
4. Click **Exit Edit** when done

Positions are saved to `localStorage` keyed by Lansweeper asset ID, so they survive future syncs.

---

## CSV Import Format

```
type,name,x,y,extra1,extra2
desk,Alice Johnson,22,218,,
printer,PRN-005,400,300,HP LaserJet,
network,,150,200,wall,
camera,,660,18,,
```

Download a pre-filled template from the Import menu in the app.

---

## API Endpoints (when running server.js)

| Endpoint | Description |
|---|---|
| `GET /api/status` | Connection health check |
| `GET /api/config` | Current config (token redacted) |
| `GET /api/sync` | Return cached assets (or trigger fresh sync) |
| `POST /api/sync` | Force a fresh sync from Lansweeper |

---

## Project Structure

```
office-layout-viewer/
├── index.html                    # Single-file app (works standalone)
├── server.js                     # Node.js proxy for Lansweeper API
├── package.json
├── lansweeper.config.example.json  # Config template (copy → .json and fill in)
├── lansweeper.config.json          # Your credentials (gitignored)
└── LICENSE
```

---

## Contributing

Pull requests welcome. For major changes, open an issue first.

Areas where contributions would be especially useful:
- Additional Lansweeper asset type mappings
- Support for other IT asset management platforms (Snipe-IT, Device42, etc.)
- Floor plan auto-scaling when uploading an image
- Zoom and pan on the map
- Multi-user / shared layout via a backend

---

## License

MIT — see [LICENSE](LICENSE).
