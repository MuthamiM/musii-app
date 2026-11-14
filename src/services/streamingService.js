const { exec } = require('child_process');
const path = require('path');

class StreamingService {
  constructor() {
    this.cache = new Map(); // query/id -> { url, expiresAt }
    this.ytDlpPath = this.resolveYtDlp();
  }

  resolveYtDlp() {
    try {
      const { execSync } = require('child_process');
      const found = execSync('which yt-dlp 2>/dev/null').toString().trim();
      if (found) return found;
    } catch (e) {}
    return '/home/cantroll/.local/bin/yt-dlp';
  }

  async getStreamUrl(query) {
    if (!query) throw new Error('Query is required');

    const cacheKey = query.trim().toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    return new Promise((resolve, reject) => {
      // Use ytsearch if not a direct URL
      const target = query.startsWith('http') ? query : `ytsearch1:${query} audio`;
      const cmd = `${this.ytDlpPath} -f "ba/b" -g --no-playlist "${target}"`;

      exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          console.error('[StreamingService] yt-dlp error:', error.message);
          return reject(new Error('Failed to resolve audio stream'));
        }

        const lines = stdout.trim().split('\n');
        const streamUrl = lines[0] ? lines[0].trim() : null;

        if (!streamUrl || !streamUrl.startsWith('http')) {
          return reject(new Error('No stream URL extracted'));
        }

        // Cache for 3 hours (YouTube URLs typically valid 6 hours)
        this.cache.set(cacheKey, {
          url: streamUrl,
          expiresAt: Date.now() + 3 * 60 * 60 * 1000
        });

        resolve(streamUrl);
      });
    });
  }

  async searchTracks(query, limit = 5) {
    return new Promise((resolve) => {
      const cmd = `${this.ytDlpPath} --dump-json --flat-playlist --default-search "ytsearch${limit}" "${query}" 2>/dev/null`;
      exec(cmd, { timeout: 15000 }, (error, stdout) => {
        if (error || !stdout) {
          return resolve([]);
        }

        const results = [];
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            results.push({
              id: data.id,
              title: data.title,
              artist: data.uploader || data.channel || 'Unknown Artist',
              duration: Math.round(data.duration || 180),
              url: `https://www.youtube.com/watch?v=${data.id}`,
              thumbnail: data.thumbnails && data.thumbnails[0] ? data.thumbnails[0].url : ''
            });
          } catch (e) {}
        }
        resolve(results);
      });
    });
  }
}

module.exports = new StreamingService();
