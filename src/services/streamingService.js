const { exec } = require('child_process');
const https = require('https');
const db = require('../db/database');

class StreamingService {
  constructor() {
    this.memoryCache = new Map(); // query -> { url, expiresAt }
    this.searchCache = new Map(); // query -> results
    this.ytDlpPath = this.resolveYtDlp();
    this.prewarmQueue = [];
    this.isPrewarming = false;
  }

  resolveYtDlp() {
    try {
      const { execSync } = require('child_process');
      const found = execSync('which yt-dlp 2>/dev/null').toString().trim();
      if (found) return found;
    } catch (e) {}
    return 'yt-dlp';
  }

  async getStreamUrl(query) {
    if (!query) throw new Error('Query is required');

    const cleanQuery = query.trim();
    const cacheKey = cleanQuery.toLowerCase();

    // 1. Check in-memory cache
    const memCached = this.memoryCache.get(cacheKey);
    if (memCached && memCached.expiresAt > Date.now()) {
      return memCached.url;
    }

    // 2. Check persistent SQLite cache
    try {
      const row = db.prepare('SELECT url, expires_at FROM stream_cache WHERE query = ? AND expires_at > ?').get(cacheKey, Date.now());
      if (row && row.url) {
        this.memoryCache.set(cacheKey, { url: row.url, expiresAt: row.expires_at });
        return row.url;
      }
    } catch (e) {}

    // 3. Resolve stream via optimized yt-dlp
    return new Promise((resolve, reject) => {
      const target = cleanQuery.startsWith('http') ? cleanQuery : `ytsearch1:${cleanQuery} audio`;
      const cmd = `${this.ytDlpPath} -f "140/ba/b" --no-playlist --no-warnings --no-check-certificates --geo-bypass --extractor-args "youtube:player_client=android" -g "${target}"`;

      exec(cmd, { timeout: 25000 }, (error, stdout) => {
        if (error) {
          console.error('[StreamingService] yt-dlp error:', error.message);
          return reject(new Error('Failed to resolve audio stream'));
        }

        const lines = (stdout || '').trim().split('\n');
        const streamUrl = lines.map(l => l.trim()).find(l => l.startsWith('http'));

        if (!streamUrl) {
          console.error('[StreamingService] No stream URL in output:', stdout);
          return reject(new Error('No stream URL extracted'));
        }

        const expiresAt = Date.now() + 4 * 60 * 60 * 1000; // 4 hours

        // Store in memory
        this.memoryCache.set(cacheKey, { url: streamUrl, expiresAt });

        // Store in SQLite
        try {
          db.prepare(`
            INSERT OR REPLACE INTO stream_cache (query, url, expires_at)
            VALUES (?, ?, ?)
          `).run(cacheKey, streamUrl, expiresAt);
        } catch (e) {}

        resolve(streamUrl);
      });
    });
  }

  async searchTracks(query, limit = 10) {
    if (!query) return [];
    const cleanQuery = query.trim();
    const cacheKey = cleanQuery.toLowerCase();

    // 1. Check in-memory search cache
    if (this.searchCache.has(cacheKey)) {
      return this.searchCache.get(cacheKey);
    }

    const results = [];

    // 2. Match local SQLite database tracks first (< 1ms)
    try {
      const localTracks = db.prepare(`
        SELECT id, title, artist, album, duration, cover_art
        FROM tracks
        WHERE title LIKE ? OR artist LIKE ?
        LIMIT 5
      `).all(`%${cleanQuery}%`, `%${cleanQuery}%`);

      for (const t of localTracks) {
        results.push({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration,
          cover_art: t.cover_art,
          thumbnail: t.cover_art,
          isLocal: true
        });
      }
    } catch (e) {}

    // 3. Fast Music Catalog Search via iTunes API (takes ~1s vs 40s yt-dlp)
    try {
      const itunesResults = await this.fetchItunesSearch(cleanQuery, limit);
      for (const item of itunesResults) {
        // Avoid duplicates if already found in local DB
        const exists = results.some(r => r.title.toLowerCase() === item.title.toLowerCase() && r.artist.toLowerCase() === item.artist.toLowerCase());
        if (!exists) {
          results.push(item);
        }
      }
    } catch (e) {
      console.warn('[StreamingService] iTunes search error:', e.message);
    }

    // 4. If iTunes returned nothing, fallback to quick yt-dlp search
    if (results.length === 0) {
      try {
        const ytResults = await this.fetchYtDlpSearch(cleanQuery, Math.min(limit, 5));
        results.push(...ytResults);
      } catch (e) {}
    }

    // Cache results for 1 hour
    if (results.length > 0) {
      this.searchCache.set(cacheKey, results);
      // Auto-prewarm the top result in background for instantaneous play on tap
      const top = results[0];
      if (top) {
        this.queuePrewarm(`${top.artist} ${top.title}`);
      }
    }

    return results;
  }

  fetchItunesSearch(query, limit = 10) {
    return new Promise((resolve) => {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}`;
      const req = https.get(url, { timeout: 4000 }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const items = (json.results || []).map(r => ({
              id: r.trackId,
              title: r.trackName,
              artist: r.artistName,
              album: r.collectionName || 'Single',
              duration: Math.round((r.trackTimeMillis || 180000) / 1000),
              cover_art: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
              thumbnail: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
              preview_url: r.previewUrl || ''
            }));
            resolve(items);
          } catch (e) {
            resolve([]);
          }
        });
      });

      req.on('error', () => resolve([]));
      req.on('timeout', () => {
        req.destroy();
        resolve([]);
      });
    });
  }

  fetchYtDlpSearch(query, limit = 5) {
    return new Promise((resolve) => {
      const cmd = `${this.ytDlpPath} --dump-json --flat-playlist --default-search "ytsearch${limit}" "${query}" 2>/dev/null`;
      exec(cmd, { timeout: 10000 }, (error, stdout) => {
        if (error || !stdout) return resolve([]);
        const results = [];
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            results.push({
              id: data.id,
              title: data.title,
              artist: data.uploader || data.channel || 'Artist',
              album: 'YouTube Stream',
              duration: Math.round(data.duration || 180),
              cover_art: data.thumbnails && data.thumbnails[0] ? data.thumbnails[0].url : '',
              thumbnail: data.thumbnails && data.thumbnails[0] ? data.thumbnails[0].url : ''
            });
          } catch (e) {}
        }
        resolve(results);
      });
    });
  }

  queuePrewarm(query) {
    if (!query) return;
    const clean = query.trim();
    if (!this.prewarmQueue.includes(clean)) {
      this.prewarmQueue.push(clean);
      this.processPrewarmQueue();
    }
  }

  async processPrewarmQueue() {
    if (this.isPrewarming || this.prewarmQueue.length === 0) return;
    this.isPrewarming = true;

    while (this.prewarmQueue.length > 0) {
      const nextQuery = this.prewarmQueue.shift();
      try {
        await this.getStreamUrl(nextQuery);
        console.log('[StreamingService] Pre-warmed audio cache for:', nextQuery);
      } catch (e) {}

      // Gentle delay between pre-warms so CPU remains totally free for user playback
      await new Promise(r => setTimeout(r, 600));
    }

    this.isPrewarming = false;
  }
}

const service = new StreamingService();

// Pre-warm default home tracks sequentially in background
setTimeout(() => {
  const defaultTracks = [
    'YoungBoy Never Broke Again Make No Sense',
    'YoungBoy Never Broke Again Lonely Child',
    'YoungBoy Never Broke Again Hot Now',
    'YoungBoy Never Broke Again Ranada',
    'Bob Marley & The Wailers Natural Mystic',
    'Drake God Plan'
  ];
  for (const t of defaultTracks) {
    service.queuePrewarm(t);
  }
}, 1500);

module.exports = service;
