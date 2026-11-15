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

  async renamePlaylist(req, res, next) {
    try {
      const { name } = req.body;
      const playlist = await playlistService.renamePlaylist(req.params.id, name);
      res.status(200).json({
        status: 'success',
        message: 'Playlist renamed successfully',
        data: { playlist }
      });
    } catch (err) {
      next(err);
    }
  }

  async deletePlaylist(req, res, next) {
    try {
      const result = await playlistService.deletePlaylist(req.params.id);
      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  async addTrack(req, res, next) {
    try {
      const playlist = await playlistService.addTrackToPlaylist(req.params.id, req.body.track);
      res.status(200).json({
        status: 'success',
        data: { playlist }
      });
    } catch (err) {
      next(err);
    }
  }

  async removeTrack(req, res, next) {
    try {
      const playlist = await playlistService.removeTrackFromPlaylist(req.params.id, req.params.trackId);
      res.status(200).json({
        status: 'success',
        data: { playlist }
      });
    } catch (err) {
      next(err);
    }
  }

  async importPlaylist(req, res, next) {
    try {
      const { name, tracks } = req.body;
      const playlist = await playlistService.importPlaylist(name, tracks);
      res.status(201).json({
        status: 'success',
        message: 'Playlist imported successfully',
        data: { playlist }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PlaylistController();
