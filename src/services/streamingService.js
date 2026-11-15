const { exec } = require('child_process');
const https = require('https');
const db = require('../db/database');

class StreamingService {
  constructor() {
    this.memoryCache = new Map(); // query -> { url, expiresAt }
    this.searchCache = new Map(); // query -> results
    this.inFlightResolutions = new Map(); // query -> Promise<url>
    this.ytDlpPath = this.resolveYtDlp();
    this.prewarmQueue = [];
    this.isPrewarming = false;
    this.activeResolutions = 0;
    this.maxConcurrentResolutions = 3;
    this.waitQueue = [];
  }

  resolveYtDlp() {
    try {
      const { execSync } = require('child_process');
      const found = execSync('which yt-dlp 2>/dev/null').toString().trim();
      if (found) return found;
    } catch (e) {}
    return 'yt-dlp';
  }

  async acquireResolutionSlot() {
    if (this.activeResolutions < this.maxConcurrentResolutions) {
      this.activeResolutions++;
      return;
    }
    await new Promise(resolve => this.waitQueue.push(resolve));
    this.activeResolutions++;
  }

  releaseResolutionSlot() {
    this.activeResolutions--;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      next();
    }
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

    // 3. Deduplicate in-flight requests for the exact same query
    if (this.inFlightResolutions.has(cacheKey)) {
      return this.inFlightResolutions.get(cacheKey);
    }

    const resolutionPromise = (async () => {
      await this.acquireResolutionSlot();
      try {
        const target = cleanQuery.startsWith('http') ? cleanQuery : `ytsearch1:${cleanQuery} audio`;
        const cmd = `${this.ytDlpPath} -f "140/ba/b" --no-playlist --no-warnings --no-check-certificates --geo-bypass --socket-timeout 8 --retries 2 --extractor-args "youtube:player_client=android" -g "${target}"`;

        return await new Promise((resolve, reject) => {
          exec(cmd, { timeout: 15000 }, (error, stdout) => {
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
      } finally {
        this.releaseResolutionSlot();
        this.inFlightResolutions.delete(cacheKey);
      }
    })();

    this.inFlightResolutions.set(cacheKey, resolutionPromise);
    return resolutionPromise;
  }

  // Feature 1 & 2: Predictive Prefetch for multiple tracks in parallel
  async prefetchUrls(queries = []) {
    if (!Array.isArray(queries) || queries.length === 0) return [];
    const validQueries = queries.filter(q => typeof q === 'string' && q.trim()).map(q => q.trim());

    const results = await Promise.allSettled(
      validQueries.map(async (query) => {
        try {
          const url = await this.getStreamUrl(query);
          return { query, url, success: true };
        } catch (err) {
          return { query, error: err.message, success: false };
        }
      })
    );

    return results.map(r => r.status === 'fulfilled' ? r.value : { success: false });
  }

  // Feature 3: Parallel search across SQLite, iTunes and YouTube
  async searchTracksParallel(query, limit = 10) {
    if (!query) return [];
    const cleanQuery = query.trim();
    const cacheKey = cleanQuery.toLowerCase();

    if (this.searchCache.has(cacheKey)) {
      return this.searchCache.get(cacheKey);
    }

    const localPromise = (async () => {
      try {
        const rows = db.prepare(`
          SELECT id, title, artist, album, duration, cover_art
          FROM tracks
          WHERE title LIKE ? OR artist LIKE ?
          LIMIT 5
        `).all(`%${cleanQuery}%`, `%${cleanQuery}%`);

        return rows.map(t => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration,
          cover_art: t.cover_art,
          thumbnail: t.cover_art,
          isLocal: true
        }));
      } catch (e) {
        return [];
      }
    })();

    const itunesPromise = this.fetchItunesSearch(cleanQuery, limit);

    const [localRes, itunesRes] = await Promise.allSettled([localPromise, itunesPromise]);

    const results = [];
    if (localRes.status === 'fulfilled' && Array.isArray(localRes.value)) {
      results.push(...localRes.value);
    }

    if (itunesRes.status === 'fulfilled' && Array.isArray(itunesRes.value)) {
      for (const item of itunesRes.value) {
        const exists = results.some(r =>
          r.title.toLowerCase() === item.title.toLowerCase() &&
          r.artist.toLowerCase() === item.artist.toLowerCase()
        );
        if (!exists) {
          results.push(item);
        }
      }
    }

    // Fallback to yt-dlp only if zero results
    if (results.length === 0) {
      try {
        const ytResults = await this.fetchYtDlpSearch(cleanQuery, Math.min(limit, 5));
        results.push(...ytResults);
      } catch (e) {}
    }

    if (results.length > 0) {
      this.searchCache.set(cacheKey, results);
      const top = results[0];
      if (top) {
        this.queuePrewarm(`${top.artist} ${top.title}`);
      }
    }

    return results;
  }

  async searchTracks(query, limit = 10) {
    return this.searchTracksParallel(query, limit);
  }

  fetchItunesSearch(query, limit = 10) {
    return new Promise((resolve) => {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}`;
      const req = https.get(url, { timeout: 3500 }, (res) => {
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
      exec(cmd, { timeout: 8000 }, (error, stdout) => {
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
      } catch (e) {}
      await new Promise(r => setTimeout(r, 400));
    }

    this.isPrewarming = false;
  }
}

const service = new StreamingService();

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
}, 1000);

module.exports = service;
