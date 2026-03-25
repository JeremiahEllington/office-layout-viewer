'use strict';

async function rcAuth(rc) {
  const body  = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: rc.jwtToken });
  const creds = Buffer.from(`${rc.clientId}:${rc.clientSecret}`).toString('base64');
  const res   = await fetch(`${rc.server}/restapi/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${creds}` },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`RingCentral auth failed (HTTP ${res.status})`), { hint: text.slice(0, 200) });
  }
  const json = await res.json();
  return json.access_token;
}

async function rcFetchAll(token, server, path) {
  const perPage = 1000;
  let page = 1;
  const all = [];
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${server}/restapi/v1.0${path}${sep}perPage=${perPage}&page=${page}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`RingCentral API error on ${path} (HTTP ${res.status})`);
    const json = await res.json();
    all.push(...(json.records || []));
    const nav = json.navigation || json.paging;
    if (!nav || page >= (nav.totalPages || 1)) break;
    page++;
  }
  return all;
}

async function runSync(config) {
  const rc    = config.ringcentral;
  const token = await rcAuth(rc);

  const extensions   = await rcFetchAll(token, rc.server, '/account/~/extension?type=User&status=Enabled');
  const presenceData = await rcFetchAll(token, rc.server, '/account/~/presence?detailedTelephonyState=true');
  const presenceById = {};
  for (const p of presenceData) presenceById[p.extension?.id] = p;

  const deviceById = {};
  for (let i = 0; i < extensions.length; i += 10) {
    await Promise.all(extensions.slice(i, i + 10).map(async (ext) => {
      try {
        const res = await fetch(`${rc.server}/restapi/v1.0/account/~/extension/${ext.id}/device`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
          const j = await res.json();
          if (j.records?.length) deviceById[ext.id] = j.records[0].model?.name || '';
        }
      } catch (_) {}
    }));
  }

  const result = extensions.map(ext => {
    const p = presenceById[ext.id] || {};
    return {
      rcId:            String(ext.id),
      ext:             ext.extensionNumber || '',
      name:            [ext.contact?.firstName, ext.contact?.lastName].filter(Boolean).join(' '),
      email:           ext.contact?.email       || '',
      department:      ext.contact?.department  || '',
      presence:        p.presenceStatus         || 'Offline',
      userStatus:      p.userStatus             || 'Offline',
      telephonyStatus: p.telephonyStatus        || 'NoCall',
      dndStatus:       p.dndStatus              || 'TakeAllCalls',
      activeCalls:     p.activeCalls            || [],
      model:           deviceById[ext.id]       || '',
    };
  });

  return { ok: true, synced: new Date().toISOString(), extensions: result };
}

module.exports = { runSync };
