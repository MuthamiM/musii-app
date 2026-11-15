const https = require('https');

class LyricsService {
  constructor() {
    this.cache = new Map();
  }

  async getLyrics({ title, artist, duration }) {
    if (!title) return { synced: false, plain: '', lines: [] };

    const cacheKey = `${artist || ''}-${title}`.toLowerCase();
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const cleanTitle = title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
      const cleanArtist = (artist || '').replace(/\(.*?\)|\[.*?\]/g, '').trim();

      const params = new URLSearchParams();
      params.append('track_name', cleanTitle);
      if (cleanArtist) params.append('artist_name', cleanArtist);
      if (duration) params.append('duration', Math.round(duration));

      let data = await this.fetchJson(`https://lrclib.net/api/get?${params.toString()}`);

      // If exact get failed, try search endpoint
      if (!data || !data.syncedLyrics) {
        const query = `${cleanArtist} ${cleanTitle}`.trim();
        const searchResults = await this.fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
        if (Array.isArray(searchResults) && searchResults.length > 0) {
          data = searchResults[0];
        }
      }

      const result = {
        synced: Boolean(data && data.syncedLyrics),
        plain: data ? (data.plainLyrics || '') : '',
        lines: data && data.syncedLyrics ? this.parseLrc(data.syncedLyrics) : []
      };

      this.cache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.warn('[LyricsService] Error fetching lyrics:', err.message);
      return { synced: false, plain: '', lines: [] };
    }
  }

  parseLrc(lrcText) {
    if (!lrcText) return [];
    const lines = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

    for (const rawLine of lrcText.split('\n')) {
      const match = timeRegex.exec(rawLine);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const ms = parseFloat('0.' + match[3]);
        const totalSec = min * 60 + sec + ms;
        const text = match[4].trim();

        if (text) {
          lines.push({
            time: Math.round(totalSec * 100) / 100,
            text
          });
        }
      }
    }

    return lines.sort((a, b) => a.time - b.time);
  }

  fetchJson(url) {
    return new Promise((resolve) => {
      const req = https.get(url, { family: 4, headers: { 'User-Agent': 'MUSII-Audio-App/1.9.1' } }, (res) => {
        if (res.statusCode !== 200) {
          return resolve(null);
        }
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.setTimeout(6000, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  async prewarm(tracks = []) {
    for (const t of tracks) {
      try {
        await this.getLyrics(t);
        console.log('[LyricsService] Pre-warmed lyrics cache for:', t.title);
      } catch (e) {}
    }
  }
}

const lyricsServiceInstance = new LyricsService();
// Pre-warm top lyrics in background for zero delay
setTimeout(() => {
  lyricsServiceInstance.prewarm([
    { title: 'Make No Sense', artist: 'YoungBoy Never Broke Again', duration: 148 },
    { title: 'Lonely Child', artist: 'YoungBoy Never Broke Again', duration: 217 },
    { title: 'Hot Now', artist: 'YoungBoy Never Broke Again', duration: 128 },
    { title: 'Natural Mystic', artist: 'Bob Marley & The Wailers', duration: 206 }
  ]).catch(() => {});
}, 1500);

module.exports = lyricsServiceInstance;

