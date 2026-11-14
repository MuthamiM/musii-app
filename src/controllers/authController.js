const authService = require('../services/authService');

class AuthController {
  async requestCode(req, res, next) {
    try {
      const { email } = req.body;
      const result = await authService.requestCode(email);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: { message: err.message }
      });
    }
  }

  async verifyCode(req, res, next) {
    try {
      const { email, code } = req.body;
      const result = await authService.verifyCode(email, code);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: { message: result.error }
        });
      }
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: { message: err.message }
      });
    }
  }

  async setUsername(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.body.token;

      const { username } = req.body;
      const result = await authService.setUsername(token, username);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: { message: err.message }
      });
    }
  }

  async validateSession(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.query.token;

      const result = await authService.validateSession(token);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: { message: err.message }
      });
    }
  }

  async logout(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.body.token;

      const result = await authService.logout(token);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: { message: err.message }
      });
    }
  }
}

module.exports = new AuthController();

