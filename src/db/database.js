const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'bitchord.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -64000');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      duration INTEGER NOT NULL,
      root_freq REAL NOT NULL,
      gradient TEXT NOT NULL,
      category TEXT NOT NULL,
      cover_art TEXT NOT NULL,
      lyrics_snippet TEXT,
      plays_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS picks (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      track_id INTEGER NOT NULL,
      gradient TEXT NOT NULL,
      badge TEXT NOT NULL,
      pattern TEXT NOT NULL,
      FOREIGN KEY (track_id) REFERENCES tracks(id)
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      song_count INTEGER DEFAULT 0,
      is_favorite INTEGER DEFAULT 0,
      is_cache_playlist INTEGER DEFAULT 0,
      gradient TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id INTEGER NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (playlist_id, track_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cached_songs (
      track_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      duration INTEGER NOT NULL,
      gradient TEXT NOT NULL,
      file_size_mb REAL DEFAULT 4.2,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      avatar_initial TEXT NOT NULL,
      playlists_count INTEGER DEFAULT 18,
      following_count INTEGER DEFAULT 342,
      plays_count TEXT DEFAULT '5.8k',
      haptics_enabled INTEGER DEFAULT 1,
      auto_cache_enabled INTEGER DEFAULT 1,
      glass_sheen_level TEXT DEFAULT 'high',
      audio_codec TEXT DEFAULT 'Lossless 24-bit 96kHz',
      version TEXT DEFAULT '1.9.1'
    );

    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL,
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (track_id) REFERENCES tracks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_category ON tracks(category);
    CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);
  `);

  const trackCount = db.prepare('SELECT COUNT(*) as count FROM tracks').get().count;
  if (trackCount === 0) {
    seedDatabase();
  }
}

function seedDatabase() {
  const insertTrack = db.prepare(`
    INSERT INTO tracks (title, artist, album, duration, root_freq, gradient, category, cover_art, lyrics_snippet, plays_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const initialTracks = [
    ['Ume Tabasamu', 'Wakadinali', 'Victims of Madness', 214, 220, 'linear-gradient(135deg, #f0443a 0%, #a80f2a 100%)', 'Mood Mix', 'victims-of-madness', 'Looking at the city lights glowing through the dark skyline', 420],
    ['Yellow', 'Coldplay', 'Parachutes', 269, 261.63, 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)', 'Top Picks for You', 'parachutes-yellow', 'Look how they shine for you / And everything you do / Yeah they were all yellow', 890],
    ['Midnight Run', 'Nova Lane', 'Late Night Drive', 198, 196, 'linear-gradient(135deg, #e8508f 0%, #9c2670 100%)', 'Mood Mix', 'late-night-drive', 'Cruising down empty highways beneath neon raindrops', 340],
    ['Deep Work', 'Kito', 'Focus Flow', 245, 174.61, 'linear-gradient(135deg, #5b6cff 0%, #2a2f9e 100%)', 'Focus', 'deep-work', 'Binaural harmonic waves for intense deep creative flow', 512],
    ['Neon Rain', 'Static Bloom', 'Cyber Horizon', 210, 293.66, 'linear-gradient(135deg, #16a58c 0%, #0a5e5a 100%)', 'Chill', 'cyber-horizon', 'Reflections dancing on the wet asphalt in the midnight fog', 275]
  ];

  const seedTransaction = db.transaction(() => {
    for (const t of initialTracks) {
      insertTrack.run(...t);
    }

    const insertPick = db.prepare(`
      INSERT INTO picks (id, category, title, subtitle, track_id, gradient, badge, pattern)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertPick.run('pick-1', 'Mood Mix', 'Heart Break Melodies', 'Late Night Drive - 24 songs', 1, 'linear-gradient(135deg, #e63946 0%, #9b111e 100%)', 'Heart Break', 'dashed-heart');
    insertPick.run('pick-2', 'Top Picks for You', 'Golden Sunset Vibes', 'Coldplay and Friends - 36 songs', 2, 'linear-gradient(135deg, #ee7a2b 0%, #9c2670 100%)', 'Trending Now', 'chevron-mesh');
    insertPick.run('pick-3', 'Focus', 'Deep Work Binaural', 'Zero Distraction - 40 songs', 4, 'linear-gradient(135deg, #5b6cff 0%, #1e1b4b 100%)', 'Focus', 'radial-pulse');

    const insertPlaylist = db.prepare(`
      INSERT INTO playlists (id, name, song_count, is_favorite, is_cache_playlist, gradient)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertPlaylist.run('pl-liked', 'Liked Songs', 128, 1, 0, 'linear-gradient(135deg, #f0443a 0%, #a80f2a 100%)');
    insertPlaylist.run('pl-road', 'Road Trip Highs', 36, 0, 0, 'linear-gradient(135deg, #ee7a2b 0%, #b8420f 100%)');
    insertPlaylist.run('pl-focus', 'Deep Focus Studio', 52, 0, 0, 'linear-gradient(135deg, #5b6cff 0%, #2a2f9e 100%)');

    const insertUser = db.prepare(`
      INSERT INTO user_profile (id, name, handle, avatar_initial, playlists_count, following_count, plays_count, haptics_enabled, auto_cache_enabled, glass_sheen_level, audio_codec, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertUser.run('usr-1', 'MUSII Member', '@musii_user', 'MU', 18, 342, '5.8k', 1, 1, 'high', 'Lossless 24-bit 96kHz', '1.9.1');

    // Pre-seed 1 cached song
    const insertCache = db.prepare(`
      INSERT OR REPLACE INTO cached_songs (track_id, title, artist, album, duration, gradient, file_size_mb)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertCache.run(1, 'Ume Tabasamu', 'Wakadinali', 'Victims of Madness', 214, 'linear-gradient(135deg, #f0443a 0%, #a80f2a 100%)', 4.8);
  });

  seedTransaction();
}

initSchema();

module.exports = db;
