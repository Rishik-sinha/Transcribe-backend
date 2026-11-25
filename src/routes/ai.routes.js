const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/ai.controller');

const router = express.Router();

router.use(requireAuth);
router.get('/engine', ctrl.engine);
router.post('/summarize', ctrl.summarize);
router.post('/transcribe', ctrl.transcribe);

module.exports = router;
