const db = require('../db/database');
const { NotFoundError } = require('../errors');

class UserService {
  async getProfile() {
    const row = db.prepare('SELECT * FROM user_profile LIMIT 1').get();
    if (!row) {
      throw new NotFoundError('User Profile');
    }
    return {
      id: row.id,
      name: row.name,
      handle: row.handle,
      avatarInitial: row.avatar_initial,
      stats: {
        playlists: row.playlists_count,
        following: row.following_count,
        plays: row.plays_count
      },
      settings: {
        hapticsEnabled: Boolean(row.haptics_enabled),
        glassSheenLevel: row.glass_sheen_level,
        audioCodec: row.audio_codec,
        version: row.version
      }
    };
  }

  async updateSettings(newSettings) {
    const current = await this.getProfile();
    const updated = { ...current.settings, ...newSettings };

    db.prepare(`
      UPDATE user_profile SET
        haptics_enabled = ?,
        glass_sheen_level = ?,
        audio_codec = ?
      WHERE id = ?
    `).run(
      updated.hapticsEnabled ? 1 : 0,
      updated.glassSheenLevel,
      updated.audioCodec,
      current.id
    );

    return updated;
  }
}

module.exports = new UserService();
