const express = require('express');
const router = express.Router();
const spotifyService = require('../services/spotifyService');

router.post('/import', async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'Spotify URL is required' });
    }
    const result = await spotifyService.importFromUrl(url);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;

