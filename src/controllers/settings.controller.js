// Per-user preferences. Same keys as the frontend DEFAULT_SETTINGS.

const { asyncHandler } = require('../utils/http');
const { getSettings, upsertSettings } = require('../services/data.service');

const get = asyncHandler(async (req, res) => {
  const settings = await getSettings(req.user.id);
  res.json({ settings });
});

const put = asyncHandler(async (req, res) => {
  const settings = await upsertSettings(req.user.id, req.body || {});
  res.json({ settings });
});

module.exports = { get, put };
