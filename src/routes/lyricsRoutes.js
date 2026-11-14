const express = require('express');
const router = express.Router();
const lyricsService = require('../services/lyricsService');

router.get('/', async (req, res, next) => {
  try {
    const { title, artist, duration } = req.query;
    if (!title) {
      return res.status(400).json({ success: false, error: 'Track title is required' });
    }
    const result = await lyricsService.getLyrics({
      title,
      artist,
      duration: duration ? parseFloat(duration) : null
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

