'use strict';
const { getConfig } = require('./_lib/config');

module.exports = function handler(req, res) {
  const cfg = getConfig();
  // Redact secrets
  const safe = JSON.parse(JSON.stringify(cfg));
  if (safe.lansweeper.token) safe.lansweeper.token = '***';
  if (safe.ringcentral.clientSecret) safe.ringcentral.clientSecret = '***';
  if (safe.ringcentral.jwtToken)     safe.ringcentral.jwtToken     = '***';
  if (safe.intune.clientSecret)      safe.intune.clientSecret      = '***';
  res.json(safe);
};
