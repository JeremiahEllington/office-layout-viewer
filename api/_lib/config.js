'use strict';

const DEFAULT_TYPE_MAPPING = {
  'windows': 'pc', 'linux': 'pc', 'mac os x': 'pc', 'apple mac': 'pc', 'chromebook': 'pc',
  'printer': 'printer', 'network printer': 'printer',
  'ip phone': 'phone', 'voip phone': 'phone', 'cisco ip phone': 'phone',
  'network camera': 'camera', 'ip camera': 'camera', 'webcam': 'camera',
};

function getConfig() {
  let typeMapping = DEFAULT_TYPE_MAPPING;
  if (process.env.TYPE_MAPPING) {
    try { typeMapping = JSON.parse(process.env.TYPE_MAPPING); } catch (_) {}
  }

  return {
    lansweeper: {
      apiUrl:            process.env.LANSWEEPER_API_URL || 'https://api.lansweeper.com/api/v2/graphql',
      token:             process.env.LANSWEEPER_TOKEN   || '',
      siteId:            process.env.LANSWEEPER_SITE_ID || '',
      hardwareHashField: process.env.LANSWEEPER_HARDWARE_HASH_FIELD || null,
    },
    sync: {
      pageSize:     parseInt(process.env.LANSWEEPER_PAGE_SIZE     || '200'),
      cacheSeconds: parseInt(process.env.LANSWEEPER_CACHE_SECONDS || '300'),
    },
    typeMapping,
    ringcentral: {
      clientId:     process.env.RC_CLIENT_ID     || '',
      clientSecret: process.env.RC_CLIENT_SECRET || '',
      jwtToken:     process.env.RC_JWT_TOKEN     || '',
      server:       process.env.RC_SERVER        || 'https://platform.ringcentral.com',
      cacheSeconds: parseInt(process.env.RC_CACHE_SECONDS || '60'),
    },
    intune: {
      tenantId:     process.env.INTUNE_TENANT_ID     || '',
      clientId:     process.env.INTUNE_CLIENT_ID     || '',
      clientSecret: process.env.INTUNE_CLIENT_SECRET || '',
      cacheSeconds: parseInt(process.env.INTUNE_CACHE_SECONDS || '300'),
    },
  };
}

module.exports = { getConfig };
