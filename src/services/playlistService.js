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
      ORDER BY pt.added_at DESC
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

  async renamePlaylist(id, newName) {
    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      throw new ValidationError('Playlist name cannot be empty', ['name is required']);
    }

    const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!pl) {
      throw new NotFoundError('Playlist', id);
    }

    const cleanName = newName.trim();
    db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(cleanName, id);
    return db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  }

  async deletePlaylist(id) {
    const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!pl) {
      throw new NotFoundError('Playlist', id);
    }

    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(id);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    return { success: true, id };
  }

  async addTrackToPlaylist(playlistId, track) {
    const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId);
    if (!pl) throw new NotFoundError('Playlist', playlistId);

    let trackId = track.id;
    const existingTrack = trackId ? db.prepare('SELECT id FROM tracks WHERE id = ?').get(trackId) : null;

    if (!existingTrack) {
      // Find by title and artist or insert
      const match = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = LOWER(?) AND LOWER(artist) = LOWER(?)')
        .get(track.title || '', track.artist || '');
      if (match) {
        trackId = match.id;
      } else {
        const info = db.prepare(`
          INSERT INTO tracks (title, artist, album, duration, root_freq, gradient, category, cover_art, lyrics_snippet)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          track.title || 'Unknown Title',
          track.artist || 'Unknown Artist',
          track.album || 'Single',
          track.duration || 210,
          220,
          track.gradient || 'linear-gradient(135deg, #5b6cff, #2a2f9e)',
          track.category || 'Imported',
          track.cover_art || track.thumbnail || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg',
          track.lyricsSnippet || track.lyrics_snippet || ''
        );
        trackId = info.lastInsertRowid;
      }
    }

    try {
      db.prepare(`
        INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id)
        VALUES (?, ?)
      `).run(playlistId, trackId);
    } catch (e) {}

    const count = db.prepare('SELECT COUNT(*) as count FROM playlist_tracks WHERE playlist_id = ?').get(playlistId).count;
    db.prepare('UPDATE playlists SET song_count = ? WHERE id = ?').run(count, playlistId);

    return this.getPlaylistById(playlistId);
  }

  async removeTrackFromPlaylist(playlistId, trackId) {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId);
    const count = db.prepare('SELECT COUNT(*) as count FROM playlist_tracks WHERE playlist_id = ?').get(playlistId).count;
    db.prepare('UPDATE playlists SET song_count = ? WHERE id = ?').run(count, playlistId);
    return this.getPlaylistById(playlistId);
  }

  async importPlaylist(name, tracks) {
    const pl = await this.createPlaylist(name);
    if (Array.isArray(tracks)) {
      for (const track of tracks) {
        await this.addTrackToPlaylist(pl.id, track);
      }
    }
    return this.getPlaylistById(pl.id);
  }
}

module.exports = new PlaylistService();
