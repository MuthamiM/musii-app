const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/profile', (req, res, next) => userController.getProfile(req, res, next));
router.patch('/settings', (req, res, next) => userController.updateSettings(req, res, next));

module.exports = router;

