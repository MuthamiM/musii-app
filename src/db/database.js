const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'musii.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -64000');

function initTables() {
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
      image TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS user_accounts (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      avatar_initial TEXT NOT NULL,
      playlists_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stream_cache (
      query TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS listening_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration_listened INTEGER DEFAULT 0,
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS offline_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      duration INTEGER DEFAULT 180,
      cover_art TEXT,
      stream_query TEXT NOT NULL,
      file_size_bytes INTEGER DEFAULT 0,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_stream_cache_expires ON stream_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON user_accounts(email);
    CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes(email);
    CREATE INDEX IF NOT EXISTS idx_tracks_category ON tracks(category);
    CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_listening_history_played ON listening_history(played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_listening_history_artist ON listening_history(artist);
    CREATE INDEX IF NOT EXISTS idx_offline_tracks_query ON offline_tracks(stream_query);
  `);
}

function initSchema() {
  initTables();

  let needsSeed = false;
  try {
    const trackCount = db.prepare('SELECT COUNT(*) as count FROM tracks').get().count;
    if (trackCount === 0) {
      needsSeed = true;
    } else {
      const firstTrack = db.prepare('SELECT cover_art FROM tracks LIMIT 1').get();
      if (!firstTrack || !firstTrack.cover_art || !firstTrack.cover_art.startsWith('http')) {
        needsSeed = true;
      }
    }
  } catch (e) {
    needsSeed = true;
  }

  if (needsSeed) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS picks;
      DROP TABLE IF EXISTS playlist_tracks;
      DROP TABLE IF EXISTS play_history;
      DROP TABLE IF EXISTS cached_songs;
      DROP TABLE IF EXISTS tracks;
      DROP TABLE IF EXISTS playlists;
      DROP TABLE IF EXISTS user_profile;
      PRAGMA foreign_keys = ON;
    `);
    initTables();
    seedDatabase();
  }

  // Ensure default playlists always have tracks populated
  try {
    const ptCount = db.prepare('SELECT COUNT(*) as count FROM playlist_tracks').get().count;
    if (ptCount === 0) {
      const insertPT = db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id) VALUES (?, ?)');
      [1, 2, 5, 9, 6].forEach(tid => insertPT.run('pl-liked', tid));
      [1, 2, 3, 4].forEach(tid => insertPT.run('pl-road', tid));
      [5, 6, 7, 8, 9].forEach(tid => insertPT.run('pl-focus', tid));

      db.prepare('UPDATE playlists SET song_count = 5 WHERE id = "pl-liked"').run();
      db.prepare('UPDATE playlists SET song_count = 4 WHERE id = "pl-road"').run();
      db.prepare('UPDATE playlists SET song_count = 5 WHERE id = "pl-focus"').run();
    }
  } catch (e) {}
}

function seedDatabase() {
  const insertTrack = db.prepare(`
    INSERT INTO tracks (title, artist, album, duration, root_freq, gradient, category, cover_art, lyrics_snippet, plays_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const initialTracks = [
    ['Make No Sense', 'YoungBoy Never Broke Again', 'AI YoungBoy 2', 148, 220.0, 'linear-gradient(135deg, #e63946 0%, #1e1b4b 100%)', 'AI YoungBoy 2', 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg', 'I feel like I am Gucci Mane in 2006 / All these diamonds on my neck', 1250],
    ['Lonely Child', 'YoungBoy Never Broke Again', 'AI YoungBoy 2', 217, 196.0, 'linear-gradient(135deg, #1f1f2e 0%, #111118 100%)', 'AI YoungBoy 2', 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg', 'I miss my grandmother, wish that I could hug you / Wish that I could tell you that I love you', 980],
    ['Hot Now', 'YoungBoy Never Broke Again', 'AI YoungBoy 2', 128, 261.63, 'linear-gradient(135deg, #ee7a2b 0%, #9c2670 100%)', 'AI YoungBoy 2', 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg', 'Ain not no running, we got 30s in this car / We gon do this in the dark', 870],
    ['Ranada', 'YoungBoy Never Broke Again', 'AI YoungBoy 2', 176, 174.61, 'linear-gradient(135deg, #5b6cff 0%, #2a2f9e 100%)', 'AI YoungBoy 2', 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg', 'I was sitting in my cell, had my head down / Now I am on the road getting checks now', 920],
    ['Natural Mystic', 'Bob Marley & The Wailers', 'Exodus', 206, 130.81, 'linear-gradient(135deg, #10b981 0%, #047857 100%)', 'Reggae Classics', 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/f3/5a/67/f35a67ae-de94-1e98-8f3e-ab73358f9092/06UMGIM10554.rgb.jpg/600x600bb.jpg', 'There is a natural mystic blowing through the air / If you listen carefully now you will hear', 1100],
    ['Around the World (La La La La)', 'A Touch of Class', 'Planet Pop', 214, 293.66, 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', 'Eurodance', 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/c2/a2/38/c2a2384d-8c55-8180-53ed-88b152f82db4/743217932756.jpg/600x600bb.jpg', 'La la la la la, it goes around the world / Just la la la la la, it is all around the world', 840],
    ['Walking On A Dream', 'Empire of the Sun', 'Walking On A Dream', 198, 246.94, 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)', 'Electronic Indie', 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/3e/42/a7/3e42a78d-57a3-fd69-6703-14d51205dd4c/13UMGIM24968.rgb.jpg/600x600bb.jpg', 'We are always running for the thrill of it / Thrill of it, always pushing up the hill of it', 760],
    ['Ume Tii', 'Wakadinali', 'Victims of Madness', 210, 220.0, 'linear-gradient(135deg, #f0443a 0%, #a80f2a 100%)', 'Drill & Hip-Hop', 'https://i.ytimg.com/vi/fxIv96Ein7c/hqdefault.jpg', 'Rong Rende Victims of Madness Wakadinali flow', 1450],
    ['Yellow', 'Coldplay', 'Parachutes', 269, 261.63, 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)', 'Top Picks for You', 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f5/93/8c/f5938c49-964c-31d1-4b33-78b634f71fb7/190295978075.jpg/600x600bb.jpg', 'Look how they shine for you / And everything you do / Yeah, they were all yellow', 1890],
    ['Naksh Naksh', 'Ali Kiba', 'Naksh Naksh', 317, 196.0, 'linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)', 'Bongo Flava', 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/12/1f/93/121f9359-f134-8d0d-887d-ef61ac31a280/859741415228_cover.jpg/600x600bb.jpg', 'Naksh naksh urembo wako mrembo wangu', 650],
    ['Mile High Club', 'Vybz Kartel', 'King of the Dancehall', 164, 174.61, 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)', 'Dancehall', 'https://is1-ssl.mzstatic.com/image/thumb/Music62/v4/cb/87/fb/cb87fb96-c983-e481-5d7e-9e5e1699b9dd/889326493617.jpg/600x600bb.jpg', 'Mile high club in the sky so high up above', 590],
    ['Goth', 'Sidewalks and Skeletons', 'White Light', 207, 220.0, 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)', 'Witch House', 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/4a/cb/ae/4acbae53-2ca7-194f-2595-a1ec80d7b4d4/889211443277.jpg/600x600bb.jpg', 'Dark reverberations and haunted electronic synth waves', 720]
  ];

  const seedTransaction = db.transaction(() => {
    for (const t of initialTracks) {
      insertTrack.run(...t);
    }

    const insertPick = db.prepare(`
      INSERT INTO picks (id, category, title, subtitle, track_id, gradient, badge, pattern, image)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertPick.run(
      'pick-youngboy-ai2',
      'Featured Album',
      'AI YoungBoy 2',
      'YoungBoy Never Broke Again • 18 tracks',
      1,
      'linear-gradient(135deg, rgba(230,57,70,0.7), rgba(20,20,28,0.95))',
      'AI YoungBoy 2',
      'dashed-heart',
      'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/ab/64/d1/ab64d11e-422b-e0d5-ec2f-a3d097c5ded8/075679832085.jpg/600x600bb.jpg'
    );

    insertPick.run(
      'pick-natural-mystic',
      'Reggae Classic',
      'Natural Mystic',
      'Bob Marley & The Wailers • Exodus',
      5,
      'linear-gradient(135deg, rgba(16,185,129,0.7), rgba(20,20,28,0.95))',
      'Bob Marley',
      'chevron-mesh',
      'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/f3/5a/67/f35a67ae-de94-1e98-8f3e-ab73358f9092/06UMGIM10554.rgb.jpg/600x600bb.jpg'
    );

    insertPick.run(
      'pick-around-the-world',
      'Eurodance Anthem',
      'Around the World',
      'A Touch of Class • Planet Pop',
      6,
      'linear-gradient(135deg, rgba(59,130,246,0.7), rgba(20,20,28,0.95))',
      'ATC',
      'radial-pulse',
      'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/c2/a2/38/c2a2384d-8c55-8180-53ed-88b152f82db4/743217932756.jpg/600x600bb.jpg'
    );

    insertPick.run(
      'pick-walking-on-a-dream',
      'Electronic Indie',
      'Walking On A Dream',
      'Empire of the Sun • High Roller',
      7,
      'linear-gradient(135deg, rgba(139,92,246,0.7), rgba(20,20,28,0.95))',
      'Empire of the Sun',
      'chevron-mesh',
      'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/3e/42/a7/3e42a78d-57a3-fd69-6703-14d51205dd4c/13UMGIM24968.rgb.jpg/600x600bb.jpg'
    );

    insertPick.run(
      'pick-yellow',
      'Top Picks for You',
      'Golden Sunset Vibes',
      'Coldplay • Parachutes • Yellow',
      9,
      'linear-gradient(135deg, rgba(245,158,11,0.7), rgba(20,20,28,0.95))',
      'Coldplay',
      'chevron-mesh',
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f5/93/8c/f5938c49-964c-31d1-4b33-78b634f71fb7/190295978075.jpg/600x600bb.jpg'
    );

    insertPick.run(
      'pick-wakadinali',
      'Mood Mix',
      'Victims of Madness',
      'Wakadinali • Ume Tii • Drill',
      8,
      'linear-gradient(135deg, rgba(240,68,58,0.7), rgba(20,20,28,0.95))',
      'Wakadinali',
      'radial-pulse',
      'https://i.ytimg.com/vi/fxIv96Ein7c/hqdefault.jpg'
    );

    const insertPlaylist = db.prepare(`
      INSERT INTO playlists (id, name, song_count, is_favorite, is_cache_playlist, gradient)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertPlaylist.run('pl-liked', 'Liked Songs', 128, 1, 0, 'linear-gradient(135deg, #f0443a 0%, #a80f2a 100%)');
    insertPlaylist.run('pl-road', 'AI YoungBoy 2 Session', 18, 0, 0, 'linear-gradient(135deg, #e63946 0%, #1e1b4b 100%)');
    insertPlaylist.run('pl-focus', 'Late Night Flow', 36, 0, 0, 'linear-gradient(135deg, #5b6cff 0%, #2a2f9e 100%)');

    const insertUser = db.prepare(`
      INSERT INTO user_profile (id, name, handle, avatar_initial, playlists_count, following_count, plays_count, haptics_enabled, auto_cache_enabled, glass_sheen_level, audio_codec, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertUser.run('usr-1', 'MUSII Member', '@musii_user', 'MU', 18, 342, '5.8k', 1, 1, 'high', 'Lossless 24-bit 96kHz', '1.9.1');

    // Pre-seed cached songs with real AI YoungBoy 2 track
    const insertCache = db.prepare(`
      INSERT OR REPLACE INTO cached_songs (track_id, title, artist, album, duration, gradient, file_size_mb)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertCache.run(1, 'Make No Sense', 'YoungBoy Never Broke Again', 'AI YoungBoy 2', 148, 'linear-gradient(135deg, #e63946 0%, #1e1b4b 100%)', 3.8);
  });

  seedTransaction();
}

initSchema();

module.exports = db;
