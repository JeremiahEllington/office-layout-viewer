'use strict';

const INTUNE_SELECT = [
  'id','deviceName','userDisplayName','userPrincipalName',
  'operatingSystem','osVersion','manufacturer','model','serialNumber',
  'complianceState','lastSyncDateTime','enrolledDateTime',
  'totalStorageSpaceInBytes','freeStorageSpaceInBytes',
  'managementState','autopilotEnrolled','azureADDeviceId',
  'wiFiMacAddress','ethernetMacAddress',
].join(',');

async function intuneAuth(cfg) {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default' });
  const res  = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Intune auth failed (HTTP ${res.status})`), { hint: text.slice(0, 200) });
  }
  const json = await res.json();
  if (json.error) throw new Error(`Intune auth error: ${json.error_description || json.error}`);
  return json.access_token;
}

function formatBytes(bytes) {
  if (!bytes) return null;
  const gb = bytes / 1073741824;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`;
}

async function runSync(config) {
  const cfg   = config.intune;
  const token = await intuneAuth(cfg);
  const all   = [];
  let url = `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=${INTUNE_SELECT}&$top=999`;

  while (url) {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`Graph API error (HTTP ${res.status})`), { hint: text.slice(0, 200) });
    }
    const json = await res.json();
    if (json.error) throw new Error(`Graph error: ${json.error.message}`);
    all.push(...(json.value || []));
    url = json['@odata.nextLink'] || null;
  }

  const devices = all.map(d => ({
    intuneId:        d.id,
    deviceName:      d.deviceName         || '',
    userDisplayName: d.userDisplayName    || '',
    userEmail:       d.userPrincipalName  || '',
    os:              d.operatingSystem    || '',
    osVersion:       d.osVersion          || '',
    manufacturer:    d.manufacturer       || '',
    model:           d.model              || '',
    serialNumber:    d.serialNumber       || '',
    complianceState: d.complianceState    || 'unknown',
    lastSync:        d.lastSyncDateTime   || null,
    enrolled:        d.enrolledDateTime   || null,
    totalStorage:    formatBytes(d.totalStorageSpaceInBytes),
    freeStorage:     formatBytes(d.freeStorageSpaceInBytes),
    managementState: d.managementState    || '',
    autopilot:       d.autopilotEnrolled  || false,
    azureAdId:       d.azureADDeviceId    || '',
  }));

  return { ok: true, synced: new Date().toISOString(), devices };
}

module.exports = { runSync };
