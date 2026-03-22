'use strict';

const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');

// ─── Load config ────────────────────────────────────────────────────────────

const configPath = path.join(__dirname, 'lansweeper.config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error('[ERROR] Could not read lansweeper.config.json:', err.message);
  process.exit(1);
}

const { port, lansweeper, sync, typeMapping, ringcentral, intune } = config;
const TOKEN_PLACEHOLDER  = 'YOUR_PERSONAL_ACCESS_TOKEN_HERE';
const SITEID_PLACEHOLDER = 'YOUR_SITE_ID_HERE';
const configuredToken  = lansweeper.token  && lansweeper.token  !== TOKEN_PLACEHOLDER;
const configuredSiteId = lansweeper.siteId && lansweeper.siteId !== SITEID_PLACEHOLDER;
const isConfigured     = configuredToken && configuredSiteId;

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       Office Layout Viewer — Server          ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(`  Port    : ${port}`);
console.log(`  API URL : ${lansweeper.apiUrl}`);
console.log(`  Site ID : ${configuredSiteId ? lansweeper.siteId : '⚠  NOT SET (placeholder)'}`);
console.log(`  Token   : ${configuredToken  ? '✓  Set'            : '⚠  NOT SET (placeholder)'}`);
console.log(`  Status  : ${isConfigured     ? '✓  Ready to sync'  : '⚠  Config incomplete — edit lansweeper.config.json'}`);
console.log('');

// ─── In-memory cache ─────────────────────────────────────────────────────────

let cache = null; // { result, expiresAt }

// ─── GraphQL query ───────────────────────────────────────────────────────────

function buildQuery(siteId) {
  return `
    query GetOfficeAssets($pagination: PaginationInput) {
      site(id: "${siteId}") {
        assetResources(
          pagination: $pagination
        ) {
          total
          pagination { current limit total }
          items {
            assetId
            assetBasicInfo {
              name
              type
              ipAddress
              description
              lastSeen
              firstSeen
            }
            assetCustom {
              location
              department
              contact
              serialNumber
            }
            operatingSystem {
              caption
            }
            memory {
              totalPhysical
            }
            cpu {
              name
            }
            users(filters: { loginEvent: "LastLogin" }) {
              username
            }
          }
        }
      }
    }
  `;
}

// ─── Asset mapping ────────────────────────────────────────────────────────────

function formatRam(bytes) {
  const gb = Math.round(bytes / 1073741824);
  return gb > 0 ? `${gb} GB` : `${Math.round(bytes / 1048576)} MB`;
}

function formatUsername(raw) {
  if (!raw) return '';
  const base = raw.includes('\\') ? raw.split('\\').pop() : raw;
  return base.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function mapAsset(item, tm) {
  const rawType    = (item.assetBasicInfo.type || '').toLowerCase().trim();
  const mappedType = tm[rawType] || 'unknown';
  const name        = item.assetBasicInfo.name        || '';
  const ip          = item.assetBasicInfo.ipAddress   || '';
  const location    = item.assetCustom?.location      || '';
  const department  = item.assetCustom?.department    || '';
  const contact     = item.assetCustom?.contact       || '';
  const serialNumber = item.assetCustom?.serialNumber || '';
  const description = item.assetBasicInfo.description || '';
  const lastUser    = item.users?.[0]?.username       || '';
  const lastSeen    = item.assetBasicInfo.lastSeen;
  const lsId        = item.assetId;
  const displayName = formatUsername(lastUser || contact) || name;
  const os          = item.operatingSystem?.caption   || '';
  const ram         = item.memory?.totalPhysical ? formatRam(item.memory.totalPhysical) : '';
  const cpu         = item.cpu?.name                  || '';
  const hardwareHash = item.assetCustom?.[config.lansweeper?.hardwareHashField] || null;

  return { mappedType, lsId, name, displayName, ip, location, department, serialNumber, description, lastUser, lastSeen, rawType, os, ram, cpu, hardwareHash };
}

// ─── Paginated fetch ──────────────────────────────────────────────────────────

async function fetchAllAssets() {
  const { apiUrl, token, siteId } = lansweeper;
  const pageSize = sync.pageSize || 200;
  const query    = buildQuery(siteId);
  const allItems = [];
  let page       = 1;
  let total      = null;

  while (true) {
    const variables = { pagination: { page, limit: pageSize } };

    let res;
    try {
      res = await fetch(apiUrl, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      // Network / DNS error
      throw Object.assign(new Error(`Connection failed: ${err.message}`), {
        hint: 'Check that the Lansweeper API URL is reachable from this server and that firewall rules allow outbound HTTPS.',
      });
    }

    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(`Authentication failed (HTTP ${res.status})`), {
        hint: 'Your token may be expired or invalid. Generate a new Personal Access Token in Lansweeper → Admin → Integrations → API Access.',
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw Object.assign(new Error(`Lansweeper API returned HTTP ${res.status}`), {
        hint: `Response: ${body.slice(0, 200)}`,
      });
    }

    let json;
    try {
      json = await res.json();
    } catch (err) {
      throw Object.assign(new Error('Invalid JSON response from Lansweeper API'), {
        hint: 'The API returned non-JSON content. Verify the apiUrl in lansweeper.config.json.',
      });
    }

    if (json.errors && json.errors.length) {
      const msg = json.errors.map(e => e.message).join('; ');
      throw Object.assign(new Error(`GraphQL error: ${msg}`), {
        hint: 'Check your siteId in lansweeper.config.json and ensure the token has read access to the site.',
      });
    }

    const resources = json?.data?.site?.assetResources;
    if (!resources) {
      throw Object.assign(new Error('Unexpected response shape from Lansweeper API'), {
        hint: 'data.site.assetResources was not present. Verify the site() query is supported by your Lansweeper version.',
      });
    }

    allItems.push(...(resources.items || []));

    if (total === null) total = resources.total || 0;

    const fetched = allItems.length;
    if (fetched >= total) break;

    page++;
  }

  return allItems;
}

// ─── Sync logic ───────────────────────────────────────────────────────────────

async function runSync() {
  const rawItems = await fetchAllAssets();
  const tm       = typeMapping || {};

  const pcs      = [];
  const printers = [];
  const cameras  = [];
  const phones   = [];
  const unknown  = [];

  for (const item of rawItems) {
    const a = mapAsset(item, tm);
    if (a.mappedType === 'pc') {
      pcs.push({
        lsId:         a.lsId,
        name:         a.displayName,
        pc:           a.name,
        ip:           a.ip,
        location:     a.location,
        department:   a.department,
        serialNumber: a.serialNumber,
        lastSeen:     a.lastSeen,
        rawType:      a.rawType,
        os:           a.os,
        ram:          a.ram,
        cpu:          a.cpu,
        hardwareHash: a.hardwareHash,
      });
    } else if (a.mappedType === 'printer') {
      printers.push({
        lsId:     a.lsId,
        label:    a.name,
        model:    a.description,
        ip:       a.ip,
        location: a.location,
        lastSeen: a.lastSeen,
      });
    } else if (a.mappedType === 'camera') {
      cameras.push({
        lsId:     a.lsId,
        name:     a.name,
        ip:       a.ip,
        location: a.location,
        lastSeen: a.lastSeen,
      });
    } else if (a.mappedType === 'phone') {
      phones.push({
        lsId:       a.lsId,
        name:       a.displayName,
        deviceName: a.name,
        ip:         a.ip,
        location:   a.location,
        lastSeen:   a.lastSeen,
      });
    } else {
      unknown.push({
        lsId:     a.lsId,
        name:     a.name,
        rawType:  a.rawType,
        ip:       a.ip,
        location: a.location,
        lastSeen: a.lastSeen,
      });
    }
  }

  const result = {
    ok:      true,
    synced:  new Date().toISOString(),
    total:   rawItems.length,
    pcs,
    printers,
    cameras,
    phones,
    unknown,
  };

  const expiresAt = Date.now() + (sync.cacheSeconds || 300) * 1000;
  cache = { result, expiresAt };

  return result;
}

// ─── RingCentral integration ──────────────────────────────────────────────────

const RC_PLACEHOLDERS = ['YOUR_RC_CLIENT_ID_HERE', 'YOUR_RC_CLIENT_SECRET_HERE', 'YOUR_RC_JWT_TOKEN_HERE'];
const rcConfigured = ringcentral &&
  ringcentral.clientId    && !RC_PLACEHOLDERS.includes(ringcentral.clientId) &&
  ringcentral.clientSecret && !RC_PLACEHOLDERS.includes(ringcentral.clientSecret) &&
  ringcentral.jwtToken    && !RC_PLACEHOLDERS.includes(ringcentral.jwtToken);

const RC_SERVER = (ringcentral && ringcentral.server) || 'https://platform.ringcentral.com';

let rcCache = null; // { result, expiresAt }

async function rcAuth() {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:  ringcentral.jwtToken,
  });
  const creds = Buffer.from(`${ringcentral.clientId}:${ringcentral.clientSecret}`).toString('base64');
  const res = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`RingCentral auth failed (HTTP ${res.status})`), {
      hint: `Response: ${text.slice(0, 200)}. Check clientId, clientSecret and jwtToken in lansweeper.config.json.`,
    });
  }
  const json = await res.json();
  return json.access_token;
}

async function rcGet(token, path) {
  const res = await fetch(`${RC_SERVER}/restapi/v1.0${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`RingCentral API error on ${path} (HTTP ${res.status})`), {
      hint: text.slice(0, 200),
    });
  }
  return res.json();
}

async function rcFetchAll(token, path, recordsKey) {
  const perPage = 1000;
  let page = 1;
  const all = [];
  while (true) {
    const json = await rcGet(token, `${path}${path.includes('?') ? '&' : '?'}perPage=${perPage}&page=${page}`);
    const records = json[recordsKey] || json.records || [];
    all.push(...records);
    const nav = json.navigation || json.paging;
    if (!nav || page >= (nav.totalPages || 1)) break;
    page++;
  }
  return all;
}

async function runRcSync() {
  const token = await rcAuth();

  // 1. Fetch all user extensions
  const extensions = await rcFetchAll(token, '/account/~/extension?type=User&status=Enabled', 'records');

  // 2. Bulk presence (RC returns up to 1000 per call)
  const presenceData = await rcFetchAll(token, '/account/~/presence?detailedTelephonyState=true', 'records');
  const presenceById = {};
  for (const p of presenceData) {
    presenceById[p.extension?.id] = p;
  }

  // 3. Fetch device model per extension (parallel, throttled in batches of 10)
  const deviceById = {};
  for (let i = 0; i < extensions.length; i += 10) {
    const batch = extensions.slice(i, i + 10);
    await Promise.all(batch.map(async (ext) => {
      try {
        const devJson = await rcGet(token, `/account/~/extension/${ext.id}/device`);
        const devices = devJson.records || [];
        if (devices.length) deviceById[ext.id] = devices[0].model?.name || '';
      } catch (_) { /* skip if no device */ }
    }));
  }

  const result = extensions.map(ext => {
    const p = presenceById[ext.id] || {};
    return {
      rcId:            String(ext.id),
      ext:             ext.extensionNumber || '',
      name:            [ext.contact?.firstName, ext.contact?.lastName].filter(Boolean).join(' '),
      email:           ext.contact?.email || '',
      department:      ext.contact?.department || '',
      presence:        p.presenceStatus   || 'Offline',
      userStatus:      p.userStatus       || 'Offline',
      telephonyStatus: p.telephonyStatus  || 'NoCall',
      dndStatus:       p.dndStatus        || 'TakeAllCalls',
      activeCalls:     p.activeCalls      || [],
      model:           deviceById[ext.id] || '',
    };
  });

  const cacheSeconds = (ringcentral && ringcentral.cacheSeconds) || 60;
  rcCache = { result, expiresAt: Date.now() + cacheSeconds * 1000 };
  return result;
}

// ─── Intune / Microsoft Graph integration ─────────────────────────────────────

const INTUNE_PLACEHOLDERS = ['YOUR_TENANT_ID_HERE', 'YOUR_APP_CLIENT_ID_HERE', 'YOUR_APP_CLIENT_SECRET_HERE'];
const intuneConfigured = intune &&
  intune.tenantId     && !INTUNE_PLACEHOLDERS.includes(intune.tenantId) &&
  intune.clientId     && !INTUNE_PLACEHOLDERS.includes(intune.clientId) &&
  intune.clientSecret && !INTUNE_PLACEHOLDERS.includes(intune.clientSecret);

let intuneCache = null; // { result, expiresAt }

async function intuneAuth() {
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     intune.clientId,
    client_secret: intune.clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${intune.tenantId}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Intune auth failed (HTTP ${res.status})`), {
      hint: `Response: ${text.slice(0, 200)}. Verify tenantId, clientId, clientSecret in config.`,
    });
  }
  const json = await res.json();
  if (json.error) {
    throw Object.assign(new Error(`Intune auth error: ${json.error_description || json.error}`), {
      hint: 'Ensure the app has DeviceManagementManagedDevices.Read.All application permission and admin consent was granted.',
    });
  }
  return json.access_token;
}

const INTUNE_SELECT = [
  'id', 'deviceName', 'userDisplayName', 'userPrincipalName',
  'operatingSystem', 'osVersion',
  'manufacturer', 'model', 'serialNumber',
  'complianceState', 'lastSyncDateTime', 'enrolledDateTime',
  'totalStorageSpaceInBytes', 'freeStorageSpaceInBytes',
  'managementState', 'autopilotEnrolled', 'azureADDeviceId',
  'wiFiMacAddress', 'ethernetMacAddress',
].join(',');

async function fetchIntuneDevices(token) {
  const all = [];
  let url = `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=${INTUNE_SELECT}&$top=999`;

  while (url) {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`Graph API error (HTTP ${res.status})`), { hint: text.slice(0, 200) });
    }
    const json = await res.json();
    if (json.error) throw Object.assign(new Error(`Graph error: ${json.error.message}`), { hint: '' });
    all.push(...(json.value || []));
    url = json['@odata.nextLink'] || null;
  }
  return all;
}

function formatBytes(bytes) {
  if (!bytes) return null;
  const gb = bytes / 1073741824;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`;
}

async function runIntuneSync() {
  const token   = await intuneAuth();
  const devices = await fetchIntuneDevices(token);

  const result = devices.map(d => ({
    intuneId:        d.id,
    deviceName:      d.deviceName      || '',
    userDisplayName: d.userDisplayName || '',
    userEmail:       d.userPrincipalName || '',
    os:              d.operatingSystem  || '',
    osVersion:       d.osVersion        || '',
    manufacturer:    d.manufacturer     || '',
    model:           d.model            || '',
    serialNumber:    d.serialNumber     || '',
    complianceState: d.complianceState  || 'unknown',
    lastSync:        d.lastSyncDateTime || null,
    enrolled:        d.enrolledDateTime || null,
    totalStorage:    formatBytes(d.totalStorageSpaceInBytes),
    freeStorage:     formatBytes(d.freeStorageSpaceInBytes),
    managementState: d.managementState  || '',
    autopilot:       d.autopilotEnrolled || false,
    azureAdId:       d.azureADDeviceId  || '',
    wifiMac:         d.wiFiMacAddress   || '',
    ethernetMac:     d.ethernetMacAddress || '',
  }));

  const cacheSeconds = (intune && intune.cacheSeconds) || 300;
  intuneCache = { result, expiresAt: Date.now() + cacheSeconds * 1000 };
  return result;
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// GET /api/status
app.get('/api/status', (_req, res) => {
  res.json({
    ok:               true,
    configured:       isConfigured,
    siteId:           configuredSiteId ? lansweeper.siteId : null,
    apiUrl:           lansweeper.apiUrl,
    rcConfigured:     !!rcConfigured,
    intuneConfigured: !!intuneConfigured,
  });
});

// GET /api/ringcentral — return cached RC data or trigger fresh sync
app.get('/api/ringcentral', async (_req, res) => {
  if (!rcConfigured) {
    return res.status(400).json({
      ok:    false,
      error: 'RingCentral is not configured.',
      hint:  'Edit lansweeper.config.json and fill in ringcentral.clientId, clientSecret, and jwtToken.',
    });
  }
  if (rcCache && Date.now() < rcCache.expiresAt) {
    return res.json({ ok: true, synced: new Date(rcCache.expiresAt).toISOString(), extensions: rcCache.result });
  }
  try {
    const result = await runRcSync();
    console.log(`[RC SYNC] OK — ${result.length} extensions fetched`);
    res.json({ ok: true, synced: new Date().toISOString(), extensions: result });
  } catch (err) {
    console.error('[RC SYNC] Error:', err.message);
    res.status(502).json({ ok: false, error: err.message, hint: err.hint || '' });
  }
});

// GET /api/intune — return cached Intune device data or trigger fresh sync
app.get('/api/intune', async (_req, res) => {
  if (!intuneConfigured) {
    return res.status(400).json({
      ok:    false,
      error: 'Intune is not configured.',
      hint:  'Edit lansweeper.config.json and fill in intune.tenantId, clientId, and clientSecret.',
    });
  }
  if (intuneCache && Date.now() < intuneCache.expiresAt) {
    return res.json({ ok: true, synced: new Date(intuneCache.expiresAt).toISOString(), devices: intuneCache.result });
  }
  try {
    const result = await runIntuneSync();
    console.log(`[INTUNE SYNC] OK — ${result.length} devices fetched`);
    res.json({ ok: true, synced: new Date().toISOString(), devices: result });
  } catch (err) {
    console.error('[INTUNE SYNC] Error:', err.message);
    res.status(502).json({ ok: false, error: err.message, hint: err.hint || '' });
  }
});

// POST /api/intune — force fresh sync
app.post('/api/intune', async (_req, res) => {
  if (!intuneConfigured) {
    return res.status(400).json({ ok: false, error: 'Intune is not configured.' });
  }
  try {
    intuneCache = null;
    const result = await runIntuneSync();
    console.log(`[INTUNE SYNC] Force OK — ${result.length} devices fetched`);
    res.json({ ok: true, synced: new Date().toISOString(), devices: result });
  } catch (err) {
    console.error('[INTUNE SYNC] Error:', err.message);
    res.status(502).json({ ok: false, error: err.message, hint: err.hint || '' });
  }
});

// POST /api/ringcentral — force fresh sync
app.post('/api/ringcentral', async (_req, res) => {
  if (!rcConfigured) {
    return res.status(400).json({ ok: false, error: 'RingCentral is not configured.' });
  }
  try {
    rcCache = null;
    const result = await runRcSync();
    console.log(`[RC SYNC] Force OK — ${result.length} extensions fetched`);
    res.json({ ok: true, synced: new Date().toISOString(), extensions: result });
  } catch (err) {
    console.error('[RC SYNC] Error:', err.message);
    res.status(502).json({ ok: false, error: err.message, hint: err.hint || '' });
  }
});

// GET /api/config  (token redacted)
app.get('/api/config', (_req, res) => {
  const safe = JSON.parse(JSON.stringify(config));
  safe.lansweeper.token = '***';
  res.json(safe);
});

// POST /api/sync  — force a fresh sync
app.post('/api/sync', async (_req, res) => {
  if (!isConfigured) {
    return res.status(400).json({
      ok:    false,
      error: 'Lansweeper is not configured.',
      hint:  'Edit lansweeper.config.json and replace the placeholder values for token and siteId, then restart the server.',
    });
  }

  try {
    const result = await runSync();
    console.log(`[SYNC] OK — ${result.total} assets fetched at ${result.synced}`);
    res.json(result);
  } catch (err) {
    console.error('[SYNC] Error:', err.message);
    res.status(502).json({
      ok:    false,
      error: err.message,
      hint:  err.hint || 'Check server logs for more detail.',
    });
  }
});

// GET /api/sync  — return cached result or trigger fresh sync
app.get('/api/sync', async (_req, res) => {
  if (!isConfigured) {
    return res.status(400).json({
      ok:    false,
      error: 'Lansweeper is not configured.',
      hint:  'Edit lansweeper.config.json and replace the placeholder values for token and siteId, then restart the server.',
    });
  }

  if (cache && Date.now() < cache.expiresAt) {
    return res.json(cache.result);
  }

  try {
    const result = await runSync();
    console.log(`[SYNC] OK (auto) — ${result.total} assets fetched at ${result.synced}`);
    res.json(result);
  } catch (err) {
    console.error('[SYNC] Error:', err.message);
    res.status(502).json({
      ok:    false,
      error: err.message,
      hint:  err.hint || 'Check server logs for more detail.',
    });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
  console.log('');
});
