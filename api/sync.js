'use strict';
const { getConfig }  = require('./_lib/config');
const { runSync }    = require('./_lib/lansweeper');

let cache = null; // persists within a warm lambda instance

module.exports = async function handler(req, res) {
  const cfg = getConfig();

  if (!cfg.lansweeper.token || !cfg.lansweeper.siteId) {
    return res.status(400).json({
      ok:    false,
      error: 'Lansweeper is not configured.',
      hint:  'Set LANSWEEPER_TOKEN and LANSWEEPER_SITE_ID environment variables in Vercel.',
    });
  }

  const force = req.method === 'POST';
  const cacheSeconds = cfg.sync.cacheSeconds || 300;

  if (!force && cache && Date.now() < cache.expiresAt) {
    return res.json(cache.result);
  }

  try {
    const result   = await runSync(cfg);
    cache = { result, expiresAt: Date.now() + cacheSeconds * 1000 };
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, hint: err.hint || '' });
  }
};
