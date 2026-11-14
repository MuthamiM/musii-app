const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/send-code', (req, res, next) => authController.requestCode(req, res, next));
router.post('/verify-code', (req, res, next) => authController.verifyCode(req, res, next));
router.post('/set-username', (req, res, next) => authController.setUsername(req, res, next));
router.get('/session', (req, res, next) => authController.validateSession(req, res, next));
router.post('/logout', (req, res, next) => authController.logout(req, res, next));

module.exports = router;

