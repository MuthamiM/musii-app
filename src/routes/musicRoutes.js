const express = require('express');
const router = express.Router();
const musicController = require('../controllers/musicController');

router.get('/feed', (req, res, next) => musicController.getFeed(req, res, next));
router.get('/track/:id', (req, res, next) => musicController.getTrack(req, res, next));
router.post('/track/:id/play', (req, res, next) => musicController.recordPlay(req, res, next));
router.get('/cached', (req, res, next) => musicController.getCachedSongs(req, res, next));
router.delete('/cached', (req, res, next) => musicController.clearCache(req, res, next));

module.exports = router;
