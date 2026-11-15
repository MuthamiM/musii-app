const db = require('../db/database');

class HistoryService {
  recordListen(trackId, title, artist, durationListened = 0) {
    if (!title || !artist) return null;
    const dur = Math.max(0, Math.floor(durationListened));

    try {
      const stmt = db.prepare(`
        INSERT INTO listening_history (track_id, title, artist, duration_listened, played_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const result = stmt.run(trackId || null, title.trim(), artist.trim(), dur);

      // Also increment plays_count in tracks table if matching
      try {
        if (trackId) {
          db.prepare('UPDATE tracks SET plays_count = plays_count + 1 WHERE id = ?').run(trackId);
        } else {
          db.prepare('UPDATE tracks SET plays_count = plays_count + 1 WHERE title = ? AND artist = ?').run(title.trim(), artist.trim());
        }
      } catch (e) {}

      return { id: result.lastInsertRowid, success: true };
    } catch (err) {
      console.error('[HistoryService] recordListen error:', err.message);
      return null;
    }
  }

  getRecentHistory(limit = 20) {
    try {
      const rows = db.prepare(`
        SELECT h.id, h.track_id, h.title, h.artist, h.duration_listened, h.played_at,
               t.cover_art, t.album, t.duration
        FROM listening_history h
        LEFT JOIN tracks t ON h.track_id = t.id OR (h.title = t.title AND h.artist = t.artist)
        ORDER BY h.played_at DESC
        LIMIT ?
      `).all(Math.min(100, Math.max(1, limit)));

      return rows.map(r => ({
        id: r.id,
        trackId: r.track_id,
        title: r.title,
        artist: r.artist,
        album: r.album || 'Single',
        cover_art: r.cover_art || 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg',
        durationListened: r.duration_listened,
        duration: r.duration || 180,
        playedAt: r.played_at
      }));
    } catch (err) {
      console.error('[HistoryService] getRecentHistory error:', err.message);
      return [];
    }
  }

  getStats() {
    try {
      // 1. Total plays and minutes
      const totalRow = db.prepare(`
        SELECT COUNT(*) as total_plays,
               COALESCE(SUM(duration_listened), 0) as total_seconds
        FROM listening_history
      `).get() || { total_plays: 0, total_seconds: 0 };

      // 2. This week / this month minutes
      const weekRow = db.prepare(`
        SELECT COALESCE(SUM(duration_listened), 0) as week_seconds
        FROM listening_history
        WHERE played_at >= datetime('now', '-7 days')
      `).get() || { week_seconds: 0 };

      const monthRow = db.prepare(`
        SELECT COALESCE(SUM(duration_listened), 0) as month_seconds
        FROM listening_history
        WHERE played_at >= datetime('now', '-30 days')
      `).get() || { month_seconds: 0 };

      // 3. Top 10 Artists
      const topArtists = db.prepare(`
        SELECT artist,
               COUNT(*) as play_count,
               ROUND(SUM(duration_listened) / 60.0, 1) as minutes_listened
        FROM listening_history
        GROUP BY artist
        ORDER BY play_count DESC
        LIMIT 10
      `).all();

      // 4. Top 10 Tracks
      const topTracks = db.prepare(`
        SELECT title, artist,
               COUNT(*) as play_count,
               MAX(played_at) as last_played
        FROM listening_history
        GROUP BY title, artist
        ORDER BY play_count DESC
        LIMIT 10
      `).all();

      // 5. Daily trend (past 7 days)
      const dailyTrend = db.prepare(`
        SELECT date(played_at) as day,
               COUNT(*) as plays,
               ROUND(SUM(duration_listened) / 60.0, 1) as minutes
        FROM listening_history
        WHERE played_at >= datetime('now', '-7 days')
        GROUP BY date(played_at)
        ORDER BY day ASC
      `).all();

      return {
        totalPlays: totalRow.total_plays,
        totalHours: Math.round((totalRow.total_seconds / 3600) * 10) / 10,
        minutesThisWeek: Math.round(weekRow.week_seconds / 60),
        minutesThisMonth: Math.round(monthRow.month_seconds / 60),
        topArtists,
        topTracks,
        dailyTrend
      };
    } catch (err) {
      console.error('[HistoryService] getStats error:', err.message);
      return {
        totalPlays: 0,
        totalHours: 0,
        minutesThisWeek: 0,
        minutesThisMonth: 0,
        topArtists: [],
        topTracks: [],
        dailyTrend: []
      };
    }
  }

  clearHistory() {
    try {
      db.prepare('DELETE FROM listening_history').run();
      return { success: true };
    } catch (err) {
      console.error('[HistoryService] clearHistory error:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new HistoryService();

