# 🎵 BitChord — Minimalist Liquid Glass Music App (v1.9.1)

Pixel-perfect recreation of the **BitChord** mobile music interface featuring frosted glassmorphism, responsive OLED obsidian styling, tactile mobile haptics, Web Audio API procedural synthesis, and an ultra-fast `better-sqlite3` database engine.

---

## 🚀 One-Click Launch

### On Windows
- **Double click**: `start.bat`
- **Or in PowerShell**:
  ```powershell
  .\start.ps1
  ```
- **Or Standalone (No Node needed)**:
  ```powershell
  start index.html
  ```

### On Linux / macOS
```bash
./start.sh
```

---

## 🌟 Features

- **Pixel-Perfect Reference Match**:
  - **Top Picks for You**: Red/coral card with dashed heart motif, chevron gradient card.
  - **Software Update Modal**: Recreates the v1.9.1 Hotfix dialog with the golden-amber Coldplay lyrics showcase mockup, download button, and remind me later.
  - **Floating Mini Player**: Sits right above the bottom nav with live visualizer and disc spin.
  - **Centered Nav Bar**: Floating island with Home, Playlist, Profile, and quick search.
  - **System Toast Pill**: Recreates the charging notification pill from the reference screenshot.
- **Ultra-Fast Backend**:
  - Embedded `better-sqlite3` engine configured with **WAL** (Write-Ahead Logging) and a 64MB memory cache for sub-3ms query latency.
- **Web Audio API Synth**:
  - Built-in generative chord synthesizer so tapping songs plays real music without external broken MP3 links.
- **Cross-Platform Haptics**:
  - Real vibration on Android via `navigator.vibrate`, with synthesized tactile acoustic clicks for iPhone and desktop headphones.
- **PWA Ready**:
  - Offline Service Worker (`sw.js`) and Web Manifest (`manifest.json`) for installing to home screen on iOS and Android.

---

## 📡 API Endpoints

- `GET /api/health` — Server status & engine info
- `GET /api/music/feed` — Top picks, recently played, and all tracks
- `GET /api/music/track/:id` — Individual track metadata
- `GET /api/playlists` — List all user playlists
- `POST /api/playlists` — Create a new playlist
- `GET /api/user/profile` — User profile, audiophile stats & settings
- `PATCH /api/user/settings` — Update haptics & theme preferences

