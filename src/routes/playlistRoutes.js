const express = require('express');
const router = express.Router();
const playlistController = require('../controllers/playlistController');
const validate = require('../middleware/validationMiddleware');

router.get('/', (req, res, next) => playlistController.getPlaylists(req, res, next));
router.get('/:id', (req, res, next) => playlistController.getPlaylist(req, res, next));
router.post(
  '/',
  validate({ body: { name: { required: true, type: 'string' } } }),
  (req, res, next) => playlistController.createPlaylist(req, res, next)
);

module.exports = router;

