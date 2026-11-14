const db = require('../db/database');
const { NotFoundError, ValidationError } = require('../errors');

class PlaylistService {
  async getAllPlaylists() {
    return db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all();
  }

  async getPlaylistById(id) {
    const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!pl) {
      throw new NotFoundError('Playlist', id);
    }
    const tracks = db.prepare(`
      SELECT t.* FROM tracks t
      JOIN playlist_tracks pt ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
    `).all(id);
    return { ...pl, tracks };
  }

  async createPlaylist(name) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('Playlist name cannot be empty', ['name is required']);
    }

    const gradientsList = [
      'linear-gradient(135deg, #f0443a, #a80f2a)',
      'linear-gradient(135deg, #5b6cff, #2a2f9e)',
      'linear-gradient(135deg, #ee7a2b, #b8420f)',
      'linear-gradient(135deg, #16a58c, #0a5e5a)',
      'linear-gradient(135deg, #e8508f, #9c2670)'
    ];

    const currentCount = db.prepare('SELECT COUNT(*) as count FROM playlists').get().count;
    const gradient = gradientsList[currentCount % gradientsList.length];
    const id = `pl-${Date.now()}`;
    const cleanName = name.trim();

    db.prepare(`
      INSERT INTO playlists (id, name, song_count, is_favorite, gradient)
      VALUES (?, ?, 0, 0, ?)
    `).run(id, cleanName, gradient);

    return db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  }
}

module.exports = new PlaylistService();
