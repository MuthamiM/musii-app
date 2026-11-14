const express = require('express');
const router = express.Router();
const streamingService = require('../services/streamingService');

// Get direct stream URL as JSON
router.get('/url', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query parameter q is required' });
    }
    const url = await streamingService.getStreamUrl(query);
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stream audio directly via 302 redirect for native range requests & zero-buffer playback
router.get('/play', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).send('Query parameter q is required');
    }
    const streamUrl = await streamingService.getStreamUrl(query);
    res.redirect(302, streamUrl);
  } catch (err) {
    res.status(500).send('Stream error: ' + err.message);
  }
});

// Download audio stream as file attachment
router.get('/download', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).send('Query parameter q is required');
    }
    const streamUrl = await streamingService.getStreamUrl(query);
    const rawFilename = req.query.filename || `${query}.m4a`;
    const cleanFilename = rawFilename.replace(/[/\\?%*:|"<>]/g, '').trim() || 'track.m4a';
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanFilename)}"`);
    res.redirect(302, streamUrl);
  } catch (err) {
    res.status(500).send('Download error: ' + err.message);
  }
});

// Search YouTube tracks
router.get('/search', async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query parameter q is required' });
    }
    const results = await streamingService.searchTracks(query, parseInt(req.query.limit, 10) || 5);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

