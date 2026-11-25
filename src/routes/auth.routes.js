const express = require('express');
const { requireAuth } = require('../middleware/auth');
const auth = require('../controllers/auth.controller');

const router = express.Router();

router.post('/signup', auth.signup);
router.post('/login', auth.login);
router.post('/logout', requireAuth, auth.logout);
router.get('/me', requireAuth, auth.me);
router.patch('/me', requireAuth, auth.updateMe);
router.post('/password', requireAuth, auth.changePassword);

module.exports = router;
