const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Translator API' });
});

router.use('/auth', require('./auth.routes'));
router.use('/transcriptions', require('./transcriptions.routes'));
router.use('/settings', require('./settings.routes'));
router.use('/ai', require('./ai.routes'));

module.exports = router;
