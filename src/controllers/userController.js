const userService = require('../services/userService');

class UserController {
  async getProfile(req, res, next) {
    try {
      const user = await userService.getProfile();
      res.status(200).json({
        status: 'success',
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateSettings(req, res, next) {
    try {
      const settings = await userService.updateSettings(req.body);
      res.status(200).json({
        status: 'success',
        message: 'Settings updated',
        data: { settings }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new UserController();

