# MUSII -- Minimalist Liquid Glass Music App (v1.9.2)

Pixel-perfect recreation of the MUSII mobile music interface featuring frosted glassmorphism, responsive OLED obsidian styling, tactile mobile haptics, real-time streaming audio, real album cover art, and an ultra-fast better-sqlite3 database engine.

---

## Launch

### Docker (Recommended)
```bash
docker compose up -d
```

### Local Node.js
```bash
npm install
npm start
```

---

## Features

- **Pixel-Perfect Reference Match**:
  - **Top Picks for You**: Real album artwork cards with NBA YoungBoy AI2 constant featured release, Bob Marley, ATC, Empire of the Sun.
  - **Dedicated Search View**: Real-time YouTube audio search, recent search history, clear search history, filter pills (YouTube, Library, Addons).
  - **Audio Settings View**: Matched settings screen with Dolby Atmos toggle, Direct Source Stream toggle, audio quality settings, and clean obsidian grouping.
  - **Floating Mini Player**: Sits right above the bottom nav with real album cover art, song info, play/pause and skip.
  - **Expanded Fullscreen Player**: Full album artwork, synchronized scrolling lyrics, scrub slider, and haptic playback controls.
  - **Centered Bottom Island Nav**: Floating island with Home, Explore, Library, and quick search.
- **Ultra-Fast Backend**:
  - Embedded better-sqlite3 engine configured with WAL (Write-Ahead Logging).
  - 3 edge streaming nodes (ports 5051, 5052, 5053) for zero-buffering distribution.
- **Real-Time Streaming Engine**:
  - yt-dlp integrated pipe for YouTube audio and Spotify import.
  - LRU memory and disk cache for instantaneous playback.
- **Synced Lyrics**:
  - LRCLIB synchronized LRC format parsing with auto-scrolling line highlight.
- **Cross-Platform Haptics & Native APK**:
  - Native Capacitor Android wrapper (com.musii.app) with hardware haptic feedback.
  - PWA offline caching via Service Worker.

---

## API Endpoints

- GET /api/health -- Server status and engine info
- GET /api/music/feed -- Top picks, recently played, and all tracks
- GET /api/music/track/:id -- Individual track metadata
- GET /api/stream/search?q= -- YouTube search
- GET /api/stream/audio/:id -- Real-time high-fidelity audio stream
- GET /api/lyrics/sync/:id -- Synced LRC lyrics
- POST /api/spotify/import -- Import Spotify track/playlist metadata
