// Shared family tree storage for the Vercel deployment.
//
// Data lives in Redis (Upstash, added from the Vercel project's Storage tab),
// reached through its REST API, so no packages are needed. A tree is only
// addressable by its id, which the browser derives from the family passcode;
// there is no way to list trees.
//
//   GET  /api/tree?health=1           -> { ok, storage }
//   GET  /api/tree?id=…&since=N       -> { version, unchanged } or { version, people, terms } (404 if none)
//   POST /api/tree?id=…  { set: {id: person}, del: [id], terms? } -> { version }

const crypto = require('crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ID_RE = /^[0-9a-f]{48}$/;
const MAX_PEOPLE_PER_WRITE = 2000;
const MAX_PERSON_BYTES = 300 * 1024;

async function redis(commands) {
  const res = await fetch(`${REDIS_URL.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`storage ${res.status}`);
  const out = await res.json();
  for (const r of out) if (r.error) throw new Error(r.error);
  return out.map((r) => r.result);
}

// Keys are a hash of the id, so even the database never holds the id itself.
const keysFor = (id) => {
  const h = crypto.createHash('sha256').update('family-tree:' + id).digest('hex');
  return { people: `ft:${h}:people`, meta: `ft:${h}:meta`, ver: `ft:${h}:ver` };
};

const send = (res, status, body) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(status).json(body);
};

module.exports = async (req, res) => {
  const { id, since, health } = req.query || {};
  if (health) return send(res, 200, { ok: true, storage: !!(REDIS_URL && REDIS_TOKEN) });
  if (!REDIS_URL || !REDIS_TOKEN) return send(res, 503, { error: 'no_storage' });
  if (!ID_RE.test(String(id || ''))) return send(res, 400, { error: 'bad_id' });
  const k = keysFor(id);

  try {
    if (req.method === 'GET') {
      const [ver] = await redis([['GET', k.ver]]);
      const version = Number(ver || 0);
      if (!version) return send(res, 404, { error: 'not_found' });
      if (since !== undefined && Number(since) === version) return send(res, 200, { version, unchanged: true });
      const [flat, meta] = await redis([['HGETALL', k.people], ['GET', k.meta]]);
      const people = {};
      for (let i = 0; i + 1 < (flat || []).length; i += 2) {
        try { people[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* skip a damaged entry */ }
      }
      let terms = {};
      try { terms = JSON.parse(meta || '{}').terms || {}; } catch { /* ignore */ }
      return send(res, 200, { version, people, terms });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad_body' });
      const set = body.set && typeof body.set === 'object' ? body.set : {};
      const del = Array.isArray(body.del) ? body.del.map(String) : [];
      if (Object.keys(set).length + del.length > MAX_PEOPLE_PER_WRITE) return send(res, 413, { error: 'too_many' });

      const cmds = [];
      const hset = ['HSET', k.people];
      for (const [pid, person] of Object.entries(set)) {
        const json = JSON.stringify(person);
        if (json.length > MAX_PERSON_BYTES) return send(res, 413, { error: 'person_too_large', id: pid });
        hset.push(String(pid), json);
      }
      if (hset.length > 2) cmds.push(hset);
      if (del.length) cmds.push(['HDEL', k.people, ...del]);
      if (body.terms && typeof body.terms === 'object') cmds.push(['SET', k.meta, JSON.stringify({ terms: body.terms })]);
      cmds.push(['INCR', k.ver]);
      const out = await redis(cmds);
      return send(res, 200, { version: Number(out[out.length - 1]) });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    console.error(err);
    return send(res, 502, { error: 'storage_error' });
  }
};
