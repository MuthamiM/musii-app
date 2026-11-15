const express = require('express');
const router = express.Router();
const musicController = require('../controllers/musicController');
const historyService = require('../services/historyService');

router.get('/feed', (req, res, next) => musicController.getFeed(req, res, next));
router.get('/track/:id', (req, res, next) => musicController.getTrack(req, res, next));
router.post('/track/:id/play', (req, res, next) => musicController.recordPlay(req, res, next));
router.get('/cached', (req, res, next) => musicController.getCachedSongs(req, res, next));
router.delete('/cached', (req, res, next) => musicController.clearCache(req, res, next));

// Listening History and Analytics (Feature 7)
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const history = historyService.getRecentHistory(limit);
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/stats', (req, res) => {
  try {
    const stats = historyService.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/history/record', (req, res) => {
  try {
    const { trackId, title, artist, durationListened } = req.body || {};
    if (!title || !artist) {
      return res.status(400).json({ success: false, error: 'title and artist are required' });
    }
    const result = historyService.recordListen(trackId, title, artist, durationListened);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/history', (req, res) => {
  try {
    const result = historyService.clearHistory();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
