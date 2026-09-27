// Shared family tree storage for the Vercel deployment.
//
// The tree is one private file in Vercel Blob. Anyone with the family
// passcode can read it (the browser turns the passcode into the tree's id);
// only the owner, with the editor password, can save it. There is no way to
// list trees, and blobs are private, so nothing is reachable without the id.
//
//   GET  /api/tree?health=1                 -> { ok, storage }
//   GET  /api/tree?id=…   (If-None-Match)   -> tree JSON with ETag, 304, or 404
//   POST /api/tree?id=…   { password, verify: true }       -> { ok } or 403
//   POST /api/tree?id=…   { password, tree: {people, terms} } -> { ok, version }
//        The first save for an id sets its editor password.

const crypto = require('crypto');

const ID_RE = /^[0-9a-f]{48}$/;
const MAX_BYTES = 4 * 1024 * 1024;

// --- storage (Vercel Blob, or memory for local tests)
const memory = new Map();
const store = process.env.TREE_STORE === 'memory'
  ? {
    ready: () => true,
    async read(path, etag) {
      const v = memory.get(path);
      if (!v) return null;
      if (etag && etag === v.etag) return { status: 304, etag: v.etag };
      return { status: 200, etag: v.etag, text: v.text };
    },
    async write(path, text) { memory.set(path, { text, etag: '"' + crypto.createHash('md5').update(text).digest('hex') + '"' }); },
  }
  : {
    ready: () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
    async read(path, etag) {
      const { get } = require('@vercel/blob');
      const r = await get(path, { access: 'private', useCache: false, ifNoneMatch: etag || undefined });
      if (!r) return null;
      if (r.statusCode === 304) return { status: 304, etag: r.blob.etag };
      return { status: 200, etag: r.blob.etag, text: await new Response(r.stream).text() };
    },
    async write(path, text) {
      const { put } = require('@vercel/blob');
      await put(path, text, { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
    },
  };

// Paths use a hash of the id, so storage never holds the id itself.
const pathsFor = (id) => {
  const h = crypto.createHash('sha256').update('family-tree:' + id).digest('hex');
  return { tree: `trees/${h}.json`, owner: `owners/${h}.json` };
};

const hashPassword = (password, salt) => crypto.scryptSync(String(password), salt, 32).toString('hex');
async function checkOwner(paths, password) {
  const r = await store.read(paths.owner);
  if (!r) return 'unset';
  const { salt, hash } = JSON.parse(r.text);
  const given = Buffer.from(hashPassword(password || '', salt), 'hex');
  return crypto.timingSafeEqual(given, Buffer.from(hash, 'hex')) ? 'ok' : 'wrong';
}

function send(res, status, body, headers = {}) {
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === null) { res.statusCode = status; return res.end(); }
  if (typeof body === 'string') { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); return res.end(body); }
  res.status(status).json(body);
}

module.exports = async (req, res) => {
  const { id, health } = req.query || {};
  if (health) return send(res, 200, { ok: true, storage: store.ready() });
  if (!store.ready()) return send(res, 503, { error: 'no_storage' });
  if (!ID_RE.test(String(id || ''))) return send(res, 400, { error: 'bad_id' });
  const paths = pathsFor(id);

  try {
    if (req.method === 'GET') {
      const r = await store.read(paths.tree, req.headers['if-none-match']);
      if (!r) return send(res, 404, { error: 'not_found' });
      if (r.status === 304) return send(res, 304, null, { ETag: r.etag });
      return send(res, 200, r.text, { ETag: r.etag });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad_body' });
      const password = String(body.password || '');
      const owner = await checkOwner(paths, password);

      if (body.verify) return owner === 'ok' ? send(res, 200, { ok: true }) : send(res, 403, { error: owner === 'unset' ? 'no_tree' : 'wrong_password' });

      const tree = body.tree;
      if (!tree || typeof tree !== 'object' || typeof tree.people !== 'object') return send(res, 400, { error: 'bad_tree' });
      if (owner === 'wrong') return send(res, 403, { error: 'wrong_password' });
      if (owner === 'unset') {
        if (password.length < 8) return send(res, 400, { error: 'weak_password' });
        const salt = crypto.randomBytes(16).toString('hex');
        await store.write(paths.owner, JSON.stringify({ salt, hash: hashPassword(password, salt) }));
      }
      const version = Date.now();
      const text = JSON.stringify({ version, people: tree.people, terms: tree.terms || {} });
      if (text.length > MAX_BYTES) return send(res, 413, { error: 'too_large' });
      await store.write(paths.tree, text);
      return send(res, 200, { ok: true, version });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    console.error(err);
    return send(res, 502, { error: 'storage_error' });
  }
};
