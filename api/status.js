'use strict';
const { getConfig } = require('./_lib/config');

module.exports = function handler(req, res) {
  const cfg = getConfig();
  res.json({
    ok:               true,
    configured:       !!(cfg.lansweeper.token && cfg.lansweeper.siteId),
    siteId:           cfg.lansweeper.siteId || null,
    apiUrl:           cfg.lansweeper.apiUrl,
    rcConfigured:     !!(cfg.ringcentral.clientId && cfg.ringcentral.clientSecret && cfg.ringcentral.jwtToken),
    intuneConfigured: !!(cfg.intune.tenantId && cfg.intune.clientId && cfg.intune.clientSecret),
  });
};
