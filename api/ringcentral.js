'use strict';
const { getConfig } = require('./_lib/config');
const { runSync }   = require('./_lib/ringcentral');

let cache = null;

module.exports = async function handler(req, res) {
  const cfg = getConfig();
  const rc  = cfg.ringcentral;

  if (!rc.clientId || !rc.clientSecret || !rc.jwtToken) {
    return res.status(400).json({
      ok:    false,
      error: 'RingCentral is not configured.',
      hint:  'Set RC_CLIENT_ID, RC_CLIENT_SECRET, and RC_JWT_TOKEN environment variables in Vercel.',
    });
  }

  const force = req.method === 'POST';
  const cacheSeconds = rc.cacheSeconds || 60;

  if (!force && cache && Date.now() < cache.expiresAt) {
    return res.json(cache.result);
  }

  try {
    const result = await runSync(cfg);
    cache = { result, expiresAt: Date.now() + cacheSeconds * 1000 };
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, hint: err.hint || '' });
  }
};
