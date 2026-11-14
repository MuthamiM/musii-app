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

const env = require('../config/env');

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
