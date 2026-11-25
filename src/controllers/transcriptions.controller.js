// CRUD for the user's transcription library. Mirrors the contract of the
// frontend's local-first store (src/lib/store.js) so swapping is one file.

const { asyncHandler, httpError } = require('../utils/http');
const {
  listTranscriptions,
  getTranscription,
  createTranscription,
  updateTranscription,
  deleteTranscription,
  deleteAllTranscriptions,
} = require('../services/data.service');

const list = asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const sessions = await listTranscriptions(req.user.id, { q: q || undefined });
  res.json({ sessions });
});

const getOne = asyncHandler(async (req, res) => {
  const session = await getTranscription(req.user.id, req.params.id);
  if (!session) throw httpError(404, 'Session not found');
  res.json({ session });
});

const create = asyncHandler(async (req, res) => {
  const draft = req.body || {};
  if (draft.segments && !Array.isArray(draft.segments)) {
    throw httpError(400, 'segments must be an array');
  }
  const session = await createTranscription(req.user.id, draft);
  res.status(201).json({ session });
});

const update = asyncHandler(async (req, res) => {
  const patch = req.body || {};
  if (patch.segments && !Array.isArray(patch.segments)) {
    throw httpError(400, 'segments must be an array');
  }
  const session = await updateTranscription(req.user.id, req.params.id, patch);
  if (!session) throw httpError(404, 'Session not found');
  res.json({ session });
});

const remove = asyncHandler(async (req, res) => {
  await deleteTranscription(req.user.id, req.params.id);
  res.status(204).end();
});

const clearAll = asyncHandler(async (req, res) => {
  await deleteAllTranscriptions(req.user.id);
  res.status(204).end();
});

const exportAll = asyncHandler(async (req, res) => {
  const sessions = await listTranscriptions(req.user.id);
  res.json({ exportedAt: new Date().toISOString(), sessions });
});

module.exports = { list, getOne, create, update, remove, clearAll, exportAll };
