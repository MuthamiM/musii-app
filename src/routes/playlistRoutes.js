const express = require('express');
const router = express.Router();
const playlistController = require('../controllers/playlistController');

router.get('/', (req, res, next) => playlistController.getPlaylists(req, res, next));
router.post('/', (req, res, next) => playlistController.createPlaylist(req, res, next));
router.post('/import', (req, res, next) => playlistController.importPlaylist(req, res, next));
router.get('/:id', (req, res, next) => playlistController.getPlaylist(req, res, next));
router.put('/:id/rename', (req, res, next) => playlistController.renamePlaylist(req, res, next));
router.patch('/:id/rename', (req, res, next) => playlistController.renamePlaylist(req, res, next));
router.delete('/:id', (req, res, next) => playlistController.deletePlaylist(req, res, next));
router.post('/:id/tracks', (req, res, next) => playlistController.addTrack(req, res, next));
router.delete('/:id/tracks/:trackId', (req, res, next) => playlistController.removeTrack(req, res, next));

module.exports = router;
