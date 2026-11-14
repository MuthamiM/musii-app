const playlistService = require('../services/playlistService');

class PlaylistController {
  async getPlaylists(req, res, next) {
    try {
      const playlists = await playlistService.getAllPlaylists();
      res.status(200).json({
        status: 'success',
        results: playlists.length,
        data: { playlists }
      });
    } catch (err) {
      next(err);
    }
  }

  async createPlaylist(req, res, next) {
    try {
      const { name } = req.body;
      const playlist = await playlistService.createPlaylist(name);
      res.status(201).json({
        status: 'success',
        message: 'Playlist created successfully',
        data: { playlist }
      });
    } catch (err) {
      next(err);
    }
  }

  async getPlaylist(req, res, next) {
    try {
      const playlist = await playlistService.getPlaylistById(req.params.id);
      res.status(200).json({
        status: 'success',
        data: { playlist }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PlaylistController();

