const db = require('../db/database');
const { NotFoundError } = require('../errors');

class MusicService {
  async getAllTracks() {
    return db.prepare('SELECT * FROM tracks ORDER BY id ASC').all();
  }

  async getTrackById(id) {
    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    if (!track) {
      throw new NotFoundError('Track', id);
    }
    return track;
  }

  async getTopPicks() {
    return db.prepare('SELECT * FROM picks ORDER BY rowid ASC').all();
  }

  async getRecentlyPlayed() {
    return db.prepare('SELECT * FROM tracks ORDER BY plays_count DESC LIMIT 5').all();
  }

  async recordPlay(trackId) {
    db.prepare('UPDATE tracks SET plays_count = plays_count + 1 WHERE id = ?').run(trackId);
    db.prepare('INSERT INTO play_history (track_id) VALUES (?)').run(trackId);
    
    // Auto-cache played song if auto-cache enabled
    const track = await this.getTrackById(trackId);
    if (track) {
      await this.cacheTrack(track);
    }
    return track;
  }

  async cacheTrack(track) {
    const fileSize = (Math.random() * (5.5 - 3.8) + 3.8).toFixed(1);
    db.prepare(`
      INSERT OR REPLACE INTO cached_songs (track_id, title, artist, album, duration, gradient, file_size_mb)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(track.id, track.title, track.artist, track.album, track.duration, track.gradient, parseFloat(fileSize));
  }

  async getCachedSongs() {
    return db.prepare('SELECT * FROM cached_songs ORDER BY cached_at DESC').all();
  }

  async clearCache() {
    db.prepare('DELETE FROM cached_songs').run();
    return { success: true, message: 'Audio cache cleared' };
  }
}

module.exports = new MusicService();
