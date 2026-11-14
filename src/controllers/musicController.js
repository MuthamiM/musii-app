const musicService = require('../services/musicService');

class MusicController {
  async getFeed(req, res, next) {
    try {
      const [picks, recent, tracks, cached] = await Promise.all([
        musicService.getTopPicks(),
        musicService.getRecentlyPlayed(),
        musicService.getAllTracks(),
        musicService.getCachedSongs()
      ]);

      res.status(200).json({
        status: 'success',
        data: {
          picks,
          recent,
          allTracks: tracks,
          cachedSongs: cached
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async getTrack(req, res, next) {
    try {
      const track = await musicService.getTrackById(req.params.id);
      res.status(200).json({
        status: 'success',
        data: { track }
      });
    } catch (err) {
      next(err);
    }
  }

  async recordPlay(req, res, next) {
    try {
      const track = await musicService.recordPlay(req.params.id);
      res.status(200).json({
        status: 'success',
        message: 'Track played and cached',
        data: { track }
      });
    } catch (err) {
      next(err);
    }
  }

  async getCachedSongs(req, res, next) {
    try {
      const cached = await musicService.getCachedSongs();
      res.status(200).json({
        status: 'success',
        data: { cached }
      });
    } catch (err) {
      next(err);
    }
  }

  async clearCache(req, res, next) {
    try {
      const result = await musicService.clearCache();
      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new MusicController();
