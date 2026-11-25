const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/settings.controller');

const router = express.Router();

router.use(requireAuth);
router.get('/', ctrl.get);
router.put('/', ctrl.put);

module.exports = router;
