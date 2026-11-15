const https = require('https');
const db = require('../db/database');
const streamingService = require('./streamingService');

class SpotifyService {
  async importFromUrl(url) {
    if (!url || !url.includes('spotify.com')) {
      throw new Error('Please provide a valid open.spotify.com link');
    }

    const cleanUrl = url.trim();

    if (cleanUrl.includes('/track/')) {
      return this.importTrack(cleanUrl);
    } else if (cleanUrl.includes('/playlist/') || cleanUrl.includes('/album/')) {
      return this.importCollection(cleanUrl);
    } else {
      throw new Error('Unsupported Spotify link type. Please use track, album, or playlist links.');
    }
  }

  async importTrack(trackUrl) {
    const oembedData = await this.fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`);
    const pageHtml = await this.fetchHtml(trackUrl);

    let title = oembedData?.title || 'Unknown Track';
    let artist = 'Various Artists';
    let album = 'Single';
    let coverArt = oembedData?.thumbnail_url || '';

    // Extract detailed artist & album from OpenGraph metadata
    if (pageHtml) {
      const descMatch = pageHtml.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
      if (descMatch && descMatch[1]) {
        // e.g. "Coldplay · Parachutes · Song · 2000"
        const parts = descMatch[1].split('·').map(s => s.trim());
        if (parts.length >= 2) {
          artist = parts[0];
          album = parts[1];
        }
      }

      const imgMatch = pageHtml.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
      if (imgMatch && imgMatch[1]) {
        coverArt = imgMatch[1];
      }
    }

    // Try to resolve YouTube stream audio
    let streamUrl = null;
    try {
      streamUrl = await streamingService.getStreamUrl(`${artist} ${title}`);
    } catch (e) {}

    // Save into SQLite tracks table
    const gradient = 'linear-gradient(135deg, #1db954 0%, #191414 100%)';
    const insert = db.prepare(`
      INSERT INTO tracks (title, artist, album, duration, root_freq, gradient, category, cover_art, lyrics_snippet, plays_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const res = insert.run(
      title,
      artist,
      album,
      210,
      220.0,
      gradient,
      'Spotify Imports',
      coverArt,
      `Imported from Spotify: ${title} by ${artist}`
    );

    const trackId = res.lastInsertRowid;
    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);

    return {
      type: 'track',
      track,
      streamUrl
    };
  }

  async importCollection(collectionUrl) {
    const oembedData = await this.fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(collectionUrl)}`);
    let title = oembedData?.title || 'Imported Spotify Playlist';
    let coverArt = oembedData?.thumbnail_url || '';

    // Convert standard open.spotify.com/playlist/xxx to embed URL
    const embedUrl = collectionUrl.replace('open.spotify.com/playlist/', 'open.spotify.com/embed/playlist/')
                                  .replace('open.spotify.com/album/', 'open.spotify.com/embed/album/');
    const embedHtml = await this.fetchHtml(embedUrl);

    let extractedTracks = [];
    if (embedHtml) {
      try {
        const match = embedHtml.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
        if (match && match[1]) {
          const nextData = JSON.parse(match[1]);
          const entity = nextData?.props?.pageProps?.state?.data?.entity;
          if (entity) {
            if (entity.name) title = entity.name;
            if (entity.coverArt?.sources?.[0]?.url) coverArt = entity.coverArt.sources[0].url;
            const list = entity.trackList || [];
            extractedTracks = list.map(item => ({
              title: item.title || item.name || 'Unknown Track',
              artist: item.subtitle || item.artists?.[0]?.name || 'Various Artists',
              duration: item.duration ? Math.round(item.duration / 1000) : 210,
              cover_art: coverArt,
              category: 'Spotify Import'
            }));
          }
        }
      } catch (e) {
        console.warn('[SpotifyService] Failed to parse embed trackList:', e.message);
      }
    }

    const playlistId = `pl-spot-${Date.now()}`;
    const gradient = 'linear-gradient(135deg, #1db954 0%, #121212 100%)';

    db.prepare(`
      INSERT INTO playlists (id, name, song_count, is_favorite, is_cache_playlist, gradient)
      VALUES (?, ?, 0, 0, 0, ?)
    `).run(playlistId, title, gradient);

    // Add extracted tracks to the playlist
    const playlistService = require('./playlistService');
    for (const track of extractedTracks) {
      try {
        await playlistService.addTrackToPlaylist(playlistId, track);
      } catch (err) {}
    }

    const playlist = await playlistService.getPlaylistById(playlistId);

    return {
      type: 'playlist',
      playlist,
      message: `Imported playlist "${title}" with ${extractedTracks.length} tracks`
    };
  }

  fetchJson(url) {
    return new Promise((resolve) => {
      const req = https.get(url, { family: 4, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode !== 200) return resolve(null);
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

  fetchHtml(url) {
    return new Promise((resolve) => {
      const req = https.get(url, { family: 4, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
        let body = '';
        res.on('data', chunk => {
          if (body.length < 500000) body += chunk;
        });
        res.on('end', () => resolve(body));
      });
      req.on('error', () => resolve(''));
      req.setTimeout(6000, () => {
        req.destroy();
        resolve('');
      });
    });
  }
}

module.exports = new SpotifyService();

