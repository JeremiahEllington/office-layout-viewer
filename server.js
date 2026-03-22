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

const { port, lansweeper, sync, typeMapping } = config;
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
  const description = item.assetBasicInfo.description || '';
  const lastUser    = item.users?.[0]?.username       || '';
  const lastSeen    = item.assetBasicInfo.lastSeen;
  const lsId        = item.assetId;
  const displayName = formatUsername(lastUser || contact) || name;

  return { mappedType, lsId, name, displayName, ip, location, department, description, lastUser, lastSeen, rawType };
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
        lsId:       a.lsId,
        name:       a.displayName,
        pc:         a.name,
        ip:         a.ip,
        location:   a.location,
        department: a.department,
        lastSeen:   a.lastSeen,
        rawType:    a.rawType,
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

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// GET /api/status
app.get('/api/status', (_req, res) => {
  res.json({
    ok:         true,
    configured: isConfigured,
    siteId:     configuredSiteId ? lansweeper.siteId : null,
    apiUrl:     lansweeper.apiUrl,
  });
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
