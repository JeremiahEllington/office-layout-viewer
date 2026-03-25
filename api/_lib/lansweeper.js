'use strict';

function buildQuery(siteId) {
  return `
    query GetOfficeAssets($pagination: PaginationInput) {
      site(id: "${siteId}") {
        assetResources(pagination: $pagination) {
          total
          pagination { current limit total }
          items {
            assetId
            assetBasicInfo { name type ipAddress description lastSeen firstSeen }
            assetCustom { location department contact serialNumber }
            operatingSystem { caption }
            memory { totalPhysical }
            cpu { name }
            users(filters: { loginEvent: "LastLogin" }) { username }
          }
        }
      }
    }
  `;
}

function formatRam(bytes) {
  const gb = Math.round(bytes / 1073741824);
  return gb > 0 ? `${gb} GB` : `${Math.round(bytes / 1048576)} MB`;
}

function formatUsername(raw) {
  if (!raw) return '';
  const base = raw.includes('\\') ? raw.split('\\').pop() : raw;
  return base.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function mapAsset(item, tm, hardwareHashField) {
  const rawType     = (item.assetBasicInfo.type || '').toLowerCase().trim();
  const mappedType  = tm[rawType] || 'unknown';
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
  const hardwareHash = hardwareHashField ? (item.assetCustom?.[hardwareHashField] || null) : null;
  return { mappedType, lsId, name, displayName, ip, location, department, serialNumber, description, lastUser, lastSeen, rawType, os, ram, cpu, hardwareHash };
}

async function runSync(config) {
  const { apiUrl, token, siteId, hardwareHashField } = config.lansweeper;
  const tm       = config.typeMapping || {};
  const pageSize = config.sync?.pageSize || 200;
  const query    = buildQuery(siteId);
  const allItems = [];
  let page = 1, total = null;

  while (true) {
    const variables = { pagination: { page, limit: pageSize } };
    const res = await fetch(apiUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ query, variables }),
    });

    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(`Authentication failed (HTTP ${res.status})`), {
        hint: 'Your token may be expired. Generate a new Personal Access Token in Lansweeper.',
      });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw Object.assign(new Error(`Lansweeper API returned HTTP ${res.status}`), { hint: body.slice(0, 200) });
    }

    const json = await res.json();
    if (json.errors?.length) {
      const msg = json.errors.map(e => e.message).join('; ');
      throw Object.assign(new Error(`GraphQL error: ${msg}`), { hint: 'Check your siteId and token.' });
    }

    const resources = json?.data?.site?.assetResources;
    if (!resources) throw new Error('Unexpected response shape from Lansweeper API');

    allItems.push(...(resources.items || []));
    if (total === null) total = resources.total || 0;
    if (allItems.length >= total) break;
    page++;
  }

  const pcs = [], printers = [], cameras = [], phones = [], unknown = [];
  for (const item of allItems) {
    const a = mapAsset(item, tm, hardwareHashField);
    if (a.mappedType === 'pc') {
      pcs.push({ lsId: a.lsId, name: a.displayName, pc: a.name, ip: a.ip, location: a.location, department: a.department, serialNumber: a.serialNumber, lastSeen: a.lastSeen, rawType: a.rawType, os: a.os, ram: a.ram, cpu: a.cpu, hardwareHash: a.hardwareHash });
    } else if (a.mappedType === 'printer') {
      printers.push({ lsId: a.lsId, label: a.name, model: a.description, ip: a.ip, location: a.location, lastSeen: a.lastSeen });
    } else if (a.mappedType === 'camera') {
      cameras.push({ lsId: a.lsId, name: a.name, ip: a.ip, location: a.location, lastSeen: a.lastSeen });
    } else if (a.mappedType === 'phone') {
      phones.push({ lsId: a.lsId, name: a.displayName, deviceName: a.name, ip: a.ip, location: a.location, lastSeen: a.lastSeen });
    } else {
      unknown.push({ lsId: a.lsId, name: a.name, rawType: a.rawType, ip: a.ip, location: a.location, lastSeen: a.lastSeen });
    }
  }

  return { ok: true, synced: new Date().toISOString(), total: allItems.length, pcs, printers, cameras, phones, unknown };
}

module.exports = { runSync };
