const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/transcriptions.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', ctrl.list); // ?q= searches title + segment text
router.get('/export', ctrl.exportAll);
router.delete('/', ctrl.clearAll);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
