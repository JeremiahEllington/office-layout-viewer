'use strict';
const { getConfig } = require('./_lib/config');
const { runSync }   = require('./_lib/intune');

let cache = null;

module.exports = async function handler(req, res) {
  const cfg    = getConfig();
  const intune = cfg.intune;

  if (!intune.tenantId || !intune.clientId || !intune.clientSecret) {
    return res.status(400).json({
      ok:    false,
      error: 'Intune is not configured.',
      hint:  'Set INTUNE_TENANT_ID, INTUNE_CLIENT_ID, and INTUNE_CLIENT_SECRET environment variables in Vercel.',
    });
  }

  const force = req.method === 'POST';
  const cacheSeconds = intune.cacheSeconds || 300;

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
