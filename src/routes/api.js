const express = require('express');
const router = express.Router();

const musicRoutes = require('./musicRoutes');
const playlistRoutes = require('./playlistRoutes');
const userRoutes = require('./userRoutes');
const authRoutes = require('./authRoutes');
const streamRoutes = require('./streamRoutes');
const spotifyRoutes = require('./spotifyRoutes');
const lyricsRoutes = require('./lyricsRoutes');
const edgeRouter = require('../services/edgeRouter');
const updateService = require('../services/updateService');
const env = require('../config/env');

// Disable caching on all API endpoints so clients never receive empty 304 bodies
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// App update & version check endpoint (In-app updates)
router.get('/app/version', async (req, res) => {
  try {
    const clientVersion = req.query.currentVersion || req.query.version;
    const info = await updateService.getUpdateInfo(clientVersion);
    res.status(200).json({
      success: true,
      data: info
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// API status & healthcheck endpoint (strictly NO emojis)
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    appName: 'MUSII',
    version: env.VERSION,
    engine: 'Liquid-Glass-Ultra',
    edgeNodesOnline: edgeRouter.getAllNodes().length,
    timestamp: new Date().toISOString()
  });
});

// Edge server cluster endpoints for latency minimization & scalability
router.get('/edge/nodes', (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      nodes: edgeRouter.getAllNodes(),
      optimalNode: edgeRouter.getOptimalNode()
    }
  });
});

router.use('/music', musicRoutes);
router.use('/playlists', playlistRoutes);
router.use('/user', userRoutes);
router.use('/auth', authRoutes);
router.use('/stream', streamRoutes);
router.use('/spotify', spotifyRoutes);
router.use('/lyrics', lyricsRoutes);

module.exports = router;
