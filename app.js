/* Family Tree — one connected tree, plain JS, no build step.
   Data lives in localStorage; export/import JSON for backups. */
(() => {
  'use strict';

  const STORE_KEY = 'familyTree.v1';
  const UI_KEY = 'familyTree.ui';

  // Layout metrics (world units = px at 100% zoom)
  const CARD_W = 208, CARD_H = 76;
  const SPOUSE_GAP = 36;          // gap between spouses in a couple
  const SIB_GAP = 44;             // gap between sibling sub-trees
  const TREE_GAP = 140;           // gap between unconnected top-level families
  const ROW_H = CARD_H + 124;     // vertical distance between generations
  const PAD = 120;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let state = { people: {} };
  let collapsed = new Set();     // anchor ids of couples whose children are hidden
  let L = null;                  // current layout
  let selectedId = null;
  const cam = { x: 0, y: 0, k: 1 };

  // ================================================================ data

  function blankPerson(extra = {}) {
    return {
      id: uid(), name: '', nickname: '', gender: '', birthYear: '', deathYear: '', order: '',
      deceased: false, location: '', phone: '', notes: '', photo: '', parents: [], spouses: [], ...extra,
    };
  }

  function starterTree() {
    const people = {};
    const add = (id, o) => { people[id] = blankPerson({ id, ...o }); };
    add('pgf', { name: 'Grandfather (paternal)', gender: 'male', spouses: ['pgm'] });
    add('pgm', { name: 'Grandmother (paternal)', gender: 'female', spouses: ['pgf'] });
    add('pu1', { name: '1st Son', gender: 'male', order: 1, parents: ['pgf', 'pgm'] });
    add('dad', { name: '2nd Son (Father)', gender: 'male', order: 2, parents: ['pgf', 'pgm'], spouses: ['mom'] });
    add('pu3', { name: '3rd Son', gender: 'male', order: 3, parents: ['pgf', 'pgm'] });
    add('pu4', { name: '4th Son', gender: 'male', order: 4, parents: ['pgf', 'pgm'] });
    add('mgf', { name: 'Grandfather (maternal)', gender: 'male', spouses: ['mgm'] });
    add('mgm', { name: 'Grandmother (maternal)', gender: 'female', spouses: ['mgf'] });
    add('mom', { name: '1st Daughter (Mother)', gender: 'female', order: 1, parents: ['mgf', 'mgm'], spouses: ['dad'] });
    add('ma2', { name: '2nd Daughter', gender: 'female', order: 2, parents: ['mgf', 'mgm'] });
    add('ma3', { name: '3rd Daughter', gender: 'female', order: 3, parents: ['mgf', 'mgm'] });
    add('mu4', { name: 'Son', gender: 'male', order: 4, parents: ['mgf', 'mgm'] });
    add('me', { name: 'Me', order: 1, parents: ['dad', 'mom'] });
    add('sib', { name: 'Younger Sibling', order: 2, parents: ['dad', 'mom'] });
    return { people };
  }

  const PLACEHOLDER_NAMES = new Set([
    ...Object.values(starterTree().people).map((p) => p.name),
    // names used by the first version of the site
    'Paternal Grandfather', 'Paternal Grandmother', "Father's Elder Brother", 'Father', "Father's Younger Brother",
    "Father's Youngest Brother", 'Maternal Grandfather', 'Maternal Grandmother', 'Mother', "Mother's Sister (2nd)",
    "Mother's Sister (3rd)", "Mother's Brother",
  ]);
  const PLACEHOLDER_IDS = new Set(Object.keys(starterTree().people));
  const isPlaceholder = (p) => PLACEHOLDER_IDS.has(p.id) && PLACEHOLDER_NAMES.has(p.name);

  function normalize(data) {
    if (!data || typeof data !== 'object' || typeof data.people !== 'object') throw new Error('Not a family tree file');
    const people = {};
    for (const [id, raw] of Object.entries(data.people)) {
      const p = { ...blankPerson(), ...raw, id };
      if (!p.nickname && raw.callName) p.nickname = raw.callName;   // v1 field
      delete p.callName;
      p.name = String(p.name || '').trim() || '(unnamed)';
      p.parents = [...(raw.parents || [])];
      p.spouses = [...(raw.spouses || [])];
      people[id] = p;
    }
    for (const p of Object.values(people)) {
      p.parents = [...new Set(p.parents.filter((x) => people[x] && x !== p.id))].slice(0, 2);
      p.spouses = [...new Set(p.spouses.filter((x) => people[x] && x !== p.id))];
      if (!/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo || '')) p.photo = '';
    }
    for (const p of Object.values(people)) {
      for (const s of p.spouses) if (!people[s].spouses.includes(p.id)) people[s].spouses.push(p.id);
    }
    return { people };
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch { toast('Could not save — browser storage may be full (try smaller photos).'); }
  }
  function saveUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ collapsed: [...collapsed], bannerClosed: $('#banner').dataset.closed === '1' })); } catch { /* ignore */ }
  }

  async function load() {
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      collapsed = new Set(ui.collapsed || []);
      if (ui.bannerClosed) $('#banner').dataset.closed = '1';
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { state = normalize(JSON.parse(raw)); return; }
    } catch { /* fall through */ }
    // A family.json committed next to index.html seeds a fresh browser.
    try {
      const res = await fetch('family.json', { cache: 'no-store' });
      if (res.ok) { state = normalize(await res.json()); save(); return; }
    } catch { /* ignore */ }
    state = starterTree();
    save();
  }

  const P = (id) => state.people[id];
  const all = () => Object.values(state.people);

  function byAge(a, b) {
    const A = P(a), B = P(b);
    const ya = +A.birthYear || 9999, yb = +B.birthYear || 9999;
    if (ya !== yb) return ya - yb;
    const oa = +A.order || 99, ob = +B.order || 99;
    if (oa !== ob) return oa - ob;
    return A.name.localeCompare(B.name);
  }
  function childrenOf(id) { return all().filter((c) => c.parents.includes(id)).map((c) => c.id).sort(byAge); }
  function siblingsOf(id) {
    const p = P(id);
    if (!p.parents.length) return [];
    return all().filter((c) => c.id !== id && c.parents.some((x) => p.parents.includes(x))).map((c) => c.id).sort(byAge);
  }
  const initials = (p) => (p.name || '?').split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w.match(/\w/)[0]).join('').toUpperCase() || '?';
  function years(p) {
    const b = p.birthYear, d = p.deathYear;
    if (b && d) return `${b} – ${d}`;
    if (b && p.deceased) return `${b} – †`;
    if (b) return `b. ${b}`;
    if (d) return `d. ${d}`;
    return p.deceased ? '†' : '';
  }
  const isDead = (p) => p.deceased || !!p.deathYear;
  const avatar = (p, cls = '') => `<div class="av ${p.gender} ${cls}"${p.photo ? ` style="background-image:url('${esc(p.photo)}')"` : ''}>${p.photo ? '' : esc(initials(p))}</div>`;
  function context(p) {
    if (p.parents.length) return `${p.gender === 'male' ? 'Son' : p.gender === 'female' ? 'Daughter' : 'Child'} of ${p.parents.map((x) => P(x).name).join(' & ')}`;
    if (p.spouses.length) return `Spouse of ${p.spouses.map((x) => P(x).name).join(', ')}`;
    return p.location || '';
  }

  // ============================================================== layout
  //
  // People married to each other form a "unit" (a couple, or one person).
  // Every unit hangs under the unit of its anchor's parents, which turns the
  // family graph into a tree we can lay out cleanly. An in-law whose own
  // parents are elsewhere in the tree gets a dashed connector to them.

  function computeLayout() {
    const people = state.people;
    const ids = Object.keys(people);

    // --- generations: child = parent + 1, spouses share a generation
    const gen = Object.fromEntries(ids.map((i) => [i, 0]));
    const kids = Object.fromEntries(ids.map((i) => [i, []]));
    for (const p of all()) for (const x of p.parents) kids[x].push(p.id);
    for (let iter = 0; iter < ids.length + 2; iter++) {
      let changed = false;
      for (const id of ids) {
        const p = people[id];
        let g = gen[id];
        for (const x of p.parents) g = Math.max(g, gen[x] + 1);
        for (const s of p.spouses) g = Math.max(g, gen[s]);
        if (!p.parents.length && kids[id].length) g = Math.max(g, Math.min(...kids[id].map((k) => gen[k])) - 1);
        if (g !== gen[id]) { gen[id] = g; changed = true; }
      }
      if (!changed) break;
    }

    // --- units (connected components of the spouse graph)
    const uf = Object.fromEntries(ids.map((i) => [i, i]));
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    for (const p of all()) for (const s of p.spouses) uf[find(p.id)] = find(s);
    const groups = new Map();
    for (const id of ids) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }

    const units = [];
    const unitOf = new Map();
    const male = (m) => people[m].gender === 'male';
    const hasPar = (m) => people[m].parents.length > 0;
    for (const members of groups.values()) {
      members.sort(byAge);
      const anchor = members.find((m) => hasPar(m) && male(m)) || members.find(hasPar) || members.find(male) || members[0];
      const others = members.filter((m) => m !== anchor);
      let order;
      if (!others.length) order = [anchor];
      else if (others.length === 1) order = male(others[0]) && !male(anchor) ? [others[0], anchor] : [anchor, others[0]];
      else order = [others[0], anchor, ...others.slice(1)];
      const u = { key: anchor, anchor, members: order, gen: Math.max(...members.map((m) => gen[m])), kids: [], parent: null };
      units.push(u);
      members.forEach((m) => unitOf.set(m, u));
    }
    for (const u of units) {
      for (const x of people[u.anchor].parents) {
        const pu = unitOf.get(x);
        if (pu && pu !== u) { u.parent = pu; break; }
      }
    }
    for (const u of units) {   // break any accidental cycles
      let v = u.parent, n = 0;
      while (v && v !== u && n++ < units.length) v = v.parent;
      if (v === u) u.parent = null;
    }
    for (const u of units) if (u.parent) u.parent.kids.push(u);
    for (const u of units) u.kids.sort((a, b) => byAge(a.anchor, b.anchor));

    const unitW = (u) => u.members.length * CARD_W + (u.members.length - 1) * SPOUSE_GAP;
    const descCount = (u) => u.kids.reduce((n, k) => n + k.members.length + descCount(k), 0);

    // --- measure / place (parents centred over their children)
    function measure(u) {
      const w = unitW(u);
      u.open = u.kids.length > 0 && !collapsed.has(u.key);
      if (!u.open) { u.kw = 0; return (u.w = w); }
      u.kw = u.kids.reduce((s, k, i) => s + measure(k) + (i ? SIB_GAP : 0), 0);
      return (u.w = Math.max(w, u.kw));
    }
    const minGen = Math.min(0, ...Object.values(gen));
    const pos = new Map();
    const visibleUnits = [];
    function place(u, left) {
      const w = unitW(u);
      u.y = (u.gen - minGen) * ROW_H;
      if (u.open) {
        let cx = left + (u.w - u.kw) / 2;
        for (const k of u.kids) { place(k, cx); cx += k.w + SIB_GAP; }
        const f = u.kids[0], l = u.kids[u.kids.length - 1];
        const centre = (f.x + unitW(f) / 2 + l.x + unitW(l) / 2) / 2;
        u.x = clamp(centre - w / 2, left, left + u.w - w);
      } else u.x = left + (u.w - w) / 2;
      u.members.forEach((m, i) => pos.set(m, { x: u.x + i * (CARD_W + SPOUSE_GAP), y: u.y }));
      visibleUnits.push(u);
    }

    // --- order top-level families so families joined by marriage sit side by side
    const roots = units.filter((u) => !u.parent);
    const rootOf = (u) => { while (u.parent) u = u.parent; return u; };
    roots.forEach(measure);
    const links = new Map(roots.map((r) => [r, new Set()]));
    for (const p of all()) {
      const ru = rootOf(unitOf.get(p.id));
      for (const x of p.parents) {
        const rx = rootOf(unitOf.get(x));
        if (rx !== ru) { links.get(ru).add(rx); links.get(rx).add(ru); }
      }
    }
    const ordered = [];
    const seen = new Set();
    for (const start of [...roots].sort((a, b) => b.w - a.w)) {
      if (seen.has(start)) continue;
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        const r = queue.shift();
        ordered.push(r);
        for (const n of [...links.get(r)].sort((a, b) => b.w - a.w)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    let x = 0;
    for (const r of ordered) { place(r, x); x += r.w + TREE_GAP; }

    for (const [, v] of pos) { v.x += PAD; v.y += PAD; }
    visibleUnits.forEach((u) => { u.x += PAD; u.y += PAD; });

    const maxGen = Math.max(0, ...visibleUnits.map((u) => u.gen - minGen));
    const first = ordered[0];
    return {
      pos, unitOf, visibleUnits, unitW, descCount,
      focusX: first ? first.x + unitW(first) / 2 : 0,
      width: Math.max(0, x - TREE_GAP) + PAD * 2,
      height: (maxGen) * ROW_H + CARD_H + PAD * 2,
      generations: new Set(Object.values(gen)).size,
    };
  }

  // ============================================================== render

  function elbow(sx, sy, cx, cy, busY) {
    if (Math.abs(cx - sx) < 1) return `M${sx},${sy}V${cy}`;
    const r = Math.min(14, Math.abs(cx - sx) / 2, (busY - sy) / 2, (cy - busY) / 2);
    const d = Math.sign(cx - sx);
    return `M${sx},${sy}V${busY - r}Q${sx},${busY} ${sx + d * r},${busY}H${cx - d * r}Q${cx},${busY} ${cx},${busY + r}V${cy}`;
  }
  function curve(sx, sy, cx, cy) {
    const dy = Math.max(60, (cy - sy) / 2);
    return `M${sx},${sy}C${sx},${sy + dy} ${cx},${cy - dy} ${cx},${cy}`;
  }

  function render() {
    L = computeLayout();
    const { pos, unitOf, visibleUnits, unitW } = L;
    const nodes = [];
    const paths = [];

    // spouse links
    for (const u of visibleUnits) {
      for (let i = 0; i + 1 < u.members.length; i++) {
        const a = pos.get(u.members[i]), b = pos.get(u.members[i + 1]);
        const y = a.y + CARD_H / 2;
        paths.push(`<path class="spouse" d="M${a.x + CARD_W},${y}H${b.x}"/>`);
        paths.push(`<circle class="ring" cx="${(a.x + CARD_W + b.x) / 2}" cy="${y}" r="5"/>`);
      }
    }

    // parent → child links
    for (const c of all()) {
      const cp = pos.get(c.id);
      if (!cp) continue;
      const vp = c.parents.filter((x) => pos.has(x));
      if (!vp.length) continue;
      const cu = unitOf.get(c.id);
      const pu = unitOf.get(vp[0]);
      const isTree = cu.anchor === c.id && cu.parent === pu;
      const groupsOfParents = vp.length === 2 && unitOf.get(vp[1]) === pu ? [vp] : vp.map((x) => [x]);
      for (const g of groupsOfParents) {
        const pts = g.map((x) => pos.get(x));
        let sx, sy;
        if (pts.length === 2) { sx = (Math.min(pts[0].x, pts[1].x) + CARD_W + Math.max(pts[0].x, pts[1].x)) / 2; sy = pts[0].y + CARD_H / 2 + 5; }
        else { sx = pts[0].x + CARD_W / 2; sy = pts[0].y + CARD_H; }
        const cx = cp.x + CARD_W / 2, cy = cp.y;
        const tree = isTree && g.includes(vp[0]);
        const d = tree ? elbow(sx, sy, cx, cy, cy - 44) : curve(sx, sy, cx, cy);
        paths.push(`<path class="${tree ? 'tree' : 'cross'}" data-c="${esc(c.id)}" data-p="${esc(g.join(' '))}" d="${d}"/>`);
      }
    }

    // cards
    for (const [id, p0] of pos) {
      const p = P(id);
      const sub = [p.nickname && `“${p.nickname}”`, years(p)].filter(Boolean).join(' · ') || p.location || '';
      nodes.push(`<div class="card ${p.gender}${isDead(p) ? ' dead' : ''}" data-id="${esc(id)}" style="left:${p0.x}px;top:${p0.y}px" tabindex="0" role="button" aria-label="${esc(p.name)}">
        ${avatar(p)}
        <div class="txt"><div class="nm">${esc(p.name)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      </div>`);
    }

    // expand / collapse pills
    for (const u of visibleUnits) {
      if (!u.kids.length) continue;
      const cx = u.x + unitW(u) / 2;
      const cy = u.y + CARD_H + 30;
      const label = u.open ? '−' : `+${L.descCount(u)}`;
      const title = u.open ? 'Hide descendants' : `Show ${L.descCount(u)} descendant(s)`;
      nodes.push(`<button class="tgl${u.open ? '' : ' closed'}" data-toggle="${esc(u.key)}" style="left:${cx}px;top:${cy}px" title="${title}" aria-label="${title}">${label}</button>`);
    }

    const svg = $('#edges');
    svg.setAttribute('width', L.width);
    svg.setAttribute('height', L.height);
    svg.innerHTML = paths.join('');
    $('#nodes').innerHTML = nodes.join('');
    document.body.classList.toggle('many', pos.size > 160);

    const total = all().length;
    $('#stats').innerHTML = `<span><b>${total}</b> ${total === 1 ? 'person' : 'people'}</span><span><b>${total ? L.generations : 0}</b> generations</span>`;
    const banner = $('#banner');
    banner.hidden = banner.dataset.closed === '1' || !all().some(isPlaceholder);

    let empty = $('#emptyState');
    if (!total && !empty) {
      document.body.insertAdjacentHTML('beforeend', `<div id="emptyState" class="empty-state glass"><h2>Start your family tree</h2><p>Add the first person, then add their parents, spouse and children.</p><button class="btn primary" id="emptyAdd">+ Add person</button></div>`);
      $('#emptyAdd').onclick = () => openEditor(null);
    } else if (total && empty) empty.remove();

    applySelection();
  }

  function applySelection() {
    const sel = selectedId && P(selectedId) ? selectedId : null;
    document.body.classList.toggle('has-sel', !!sel);
    const related = new Set();
    if (sel) {
      P(sel).parents.forEach((x) => related.add(x));
      childrenOf(sel).forEach((x) => related.add(x));
      P(sel).spouses.forEach((x) => related.add(x));
    }
    for (const el of $$('#nodes .card')) {
      el.classList.toggle('sel', el.dataset.id === sel);
      el.classList.toggle('rel', related.has(el.dataset.id));
    }
    for (const el of $$('#edges path[data-c]')) {
      el.classList.toggle('hl', !!sel && (el.dataset.c === sel || el.dataset.p.split(' ').includes(sel)));
    }
  }

  // ============================================================== camera

  const viewport = $('#viewport');
  const world = $('#world');
  function applyCam() {
    world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.k})`;
    viewport.style.backgroundSize = `${24 * cam.k}px ${24 * cam.k}px`;
    viewport.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
    $('#zoomLabel').textContent = Math.round(cam.k * 100) + '%';
  }
  function zoomAt(k, mx, my) {
    k = clamp(k, 0.12, 2.2);
    cam.x = mx - (mx - cam.x) * (k / cam.k);
    cam.y = my - (my - cam.y) * (k / cam.k);
    cam.k = k;
    applyCam();
  }
  // Area not covered by floating chrome
  function safeRect() {
    const w = innerWidth, h = innerHeight;
    const banner = $('#banner');
    const top = (banner.hidden ? $('.topbar') : banner).getBoundingClientRect().bottom + 10;
    const panelOpen = $('#panel').classList.contains('open') && w > 720;
    const right = panelOpen ? w - $('#panel').getBoundingClientRect().left + 10 : 0;
    const bottom = w <= 720 && $('#panel').classList.contains('open') ? h - $('#panel').getBoundingClientRect().top : 64;
    return { x: 0, y: top, w: w - right, h: Math.max(100, h - top - bottom) };
  }
  let anim = null;
  function animateTo(target, ms = 480) {
    cancelAnimationFrame(anim);
    const from = { ...cam };
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = clamp((now - t0) / ms, 0, 1), e = ease(t);
      cam.x = from.x + (target.x - from.x) * e;
      cam.y = from.y + (target.y - from.y) * e;
      cam.k = from.k + (target.k - from.k) * e;
      applyCam();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  // minK > 0 keeps names readable on first load: if everything won't fit at that
  // zoom, show the top of the tree centred instead.
  function fit(animate = true, minK = 0) {
    if (!L || !L.pos.size) return;
    const r = safeRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of L.pos.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + CARD_W); maxY = Math.max(maxY, p.y + CARD_H); }
    let k = clamp(Math.min((r.w - 60) / (maxX - minX), (r.h - 60) / (maxY - minY)), 0.12, 1);
    let cy = r.y + r.h / 2 - ((minY + maxY) / 2) * k;
    let cx = r.x + r.w / 2 - ((minX + maxX) / 2) * k;
    if (k < minK) { k = minK; cy = r.y + 40 - minY * k; cx = r.x + r.w / 2 - L.focusX * k; }
    const target = { k, x: cx, y: cy };
    animate ? animateTo(target) : (Object.assign(cam, target), applyCam());
  }
  function centreOn(id, minK = 0.85) {
    const p = L.pos.get(id);
    if (!p) return;
    const r = safeRect();
    const k = Math.max(cam.k, minK);
    animateTo({ k, x: r.x + r.w / 2 - (p.x + CARD_W / 2) * k, y: r.y + r.h / 2 - (p.y + CARD_H / 2) * k });
  }

  // Keep a given person fixed on screen while the layout changes underneath.
  function keepSteady(id, fn) {
    const before = L?.pos.get(id);
    fn();
    const after = L?.pos.get(id);
    if (before && after) { cam.x += (before.x - after.x) * cam.k; cam.y += (before.y - after.y) * cam.k; applyCam(); }
  }

  // Pan, pinch and wheel
  const pointers = new Map();
  let gesture = null, moved = 0;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('.tgl')) return;
    cancelAnimationFrame(anim);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    startGesture();
  });
  function startGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 1) gesture = { type: 'pan', sx: pts[0].x, sy: pts[0].y, cx: cam.x, cy: cam.y };
    else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam: { ...cam } };
    }
  }
  addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    if (gesture.type === 'pan' && pts.length === 1) {
      const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved > 4) viewport.classList.add('panning');
      cam.x = gesture.cx + dx; cam.y = gesture.cy + dy;
      applyCam();
    } else if (gesture.type === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      moved = 99;
      const g = gesture.cam;
      const k = clamp(g.k * d / gesture.d, 0.12, 2.2);
      cam.k = k;
      cam.x = mx - (gesture.mx - g.x) * (k / g.k);
      cam.y = my - (gesture.my - g.y) * (k / g.k);
      applyCam();
    }
  });
  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    viewport.classList.remove('panning');
    if (pointers.size) startGesture(); else gesture = null;
  };
  addEventListener('pointerup', endPointer);
  addEventListener('pointercancel', endPointer);

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || mouseWheel) {
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0018));
      zoomAt(cam.k * f, e.clientX, e.clientY);
    } else {   // trackpad two-finger scroll pans
      cam.x -= e.deltaX; cam.y -= e.deltaY; applyCam();
    }
  }, { passive: false });

  $('#zoomIn').onclick = () => { const r = safeRect(); cancelAnimationFrame(anim); zoomAt(cam.k * 1.2, r.x + r.w / 2, r.y + r.h / 2); };
  $('#zoomOut').onclick = () => { const r = safeRect(); cancelAnimationFrame(anim); zoomAt(cam.k / 1.2, r.x + r.w / 2, r.y + r.h / 2); };
  $('#fitBtn').onclick = () => fit();

  // Clicks on cards and pills
  $('#nodes').addEventListener('click', (e) => {
    const t = e.target.closest('.tgl');
    if (t) { toggle(t.dataset.toggle); return; }
    if (moved > 4) return;
    const c = e.target.closest('.card');
    if (c) select(c.dataset.id);
  });
  $('#nodes').addEventListener('keydown', (e) => {
    const c = e.target.closest('.card');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(c.dataset.id); }
  });
  viewport.addEventListener('click', (e) => {
    if (moved <= 4 && !e.target.closest('.card, .tgl')) closePanel();
  });

  function toggle(key) {
    keepSteady(key, () => {
      collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
      saveUI();
      render();
    });
  }

  // Make sure someone is visible (expand every collapsed ancestor), then fly to them.
  function locate(id, { open = true } = {}) {
    if (!P(id)) return;
    const lay = computeLayout();
    let u = lay.unitOf.get(id)?.parent;
    let changed = false;
    while (u) { if (collapsed.delete(u.key)) changed = true; u = u.parent; }
    if (changed) { saveUI(); render(); }
    if (open) select(id, false);
    centreOn(id);
    requestAnimationFrame(() => {
      const el = $(`#nodes .card[data-id="${CSS.escape(id)}"]`);
      if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
    });
  }

  // =============================================================== panel

  function select(id, keepInView = true) {
    selectedId = id;
    applySelection();
    renderPanel();
    if (keepInView) {
      const p = L.pos.get(id), r = safeRect();
      if (p) {
        const sx = p.x * cam.k + cam.x, sy = p.y * cam.k + cam.y;
        if (sx < r.x || sx + CARD_W * cam.k > r.x + r.w || sy < r.y || sy + CARD_H * cam.k > r.y + r.h) centreOn(id, cam.k);
      }
    }
  }

  function closePanel() {
    selectedId = null;
    $('#panel').classList.remove('open');
    $('#panel').setAttribute('aria-hidden', 'true');
    applySelection();
  }

  const chip = (id) => `<button class="chip" data-goto="${esc(id)}">${avatar(P(id), 'sm')}${esc(P(id).name)}</button>`;

  function renderPanel() {
    const id = selectedId, p = P(id);
    if (!p) return closePanel();
    const facts = [
      ['Born', p.birthYear], ['Died', p.deathYear || (p.deceased ? 'Yes' : '')],
      ['Birth order', p.order ? `#${p.order} among siblings` : ''], ['Lives in', p.location],
      ['Phone', p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''],
    ].filter(([, v]) => v);
    const sec = (t, ids) => ids.length ? `<div class="p-sec"><h4>${t} · ${ids.length}</h4><div class="chips">${ids.map(chip).join('')}</div></div>` : '';
    $('#panelBody').innerHTML = `
      <div class="p-head">
        ${avatar(p, 'xl')}
        <h2 class="p-name">${esc(p.name)}</h2>
        ${p.nickname ? `<div class="p-nick">“${esc(p.nickname)}”</div>` : ''}
        ${years(p) ? `<div class="p-years">${esc(years(p))}</div>` : ''}
      </div>
      ${facts.length ? `<dl class="p-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${k === 'Phone' ? v : esc(v)}</dd>`).join('')}</dl>` : ''}
      ${p.notes ? `<div class="p-notes">${esc(p.notes)}</div>` : ''}
      ${sec('Parents', p.parents)}
      ${sec(p.spouses.length > 1 ? 'Spouses' : 'Spouse', p.spouses)}
      ${sec('Siblings', siblingsOf(id))}
      ${sec('Children', childrenOf(id))}
      <div class="p-actions">
        <button class="btn primary wide" data-act="edit">Edit details</button>
        <button class="btn" data-act="add-parent" ${p.parents.length >= 2 ? 'disabled' : ''}>+ Parent</button>
        <button class="btn" data-act="add-spouse">+ Spouse</button>
        <button class="btn" data-act="add-sibling">+ Sibling</button>
        <button class="btn" data-act="add-child">+ Child</button>
        <button class="btn ghost danger wide" data-act="delete">Delete</button>
      </div>`;
    $('#panel').classList.add('open');
    $('#panel').setAttribute('aria-hidden', 'false');
  }

  $('#panelClose').onclick = closePanel;
  $('#panelBody').addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { locate(go.dataset.goto); return; }
    const b = e.target.closest('[data-act]');
    if (!b || !selectedId) return;
    const id = selectedId, p = P(id);
    switch (b.dataset.act) {
      case 'edit': openEditor(id); break;
      case 'add-child': openEditor(null, { parents: [id, ...p.spouses.slice(0, 1)] }); break;
      case 'add-spouse': openEditor(null, { spouses: [id], gender: p.gender === 'male' ? 'female' : p.gender === 'female' ? 'male' : '' }); break;
      case 'add-sibling':
        if (!p.parents.length) { toast(`Add ${p.name}'s parent first. Siblings hang under the same parents.`); break; }
        openEditor(null, { parents: [...p.parents] }); break;
      case 'add-parent': openEditor(null, { spouses: p.parents.slice(0, 1) }, { childOf: id }); break;
      case 'delete': deletePerson(id); break;
    }
  });

  function deletePerson(id) {
    const p = P(id);
    const n = childrenOf(id).length;
    if (!confirm(`Delete ${p.name}?` + (n ? `\n\nTheir ${n} child(ren) stay in the tree, just without this parent.` : ''))) return;
    delete state.people[id];
    for (const o of all()) {
      o.parents = o.parents.filter((x) => x !== id);
      o.spouses = o.spouses.filter((x) => x !== id);
    }
    collapsed.delete(id);
    closePanel();
    save(); saveUI(); render();
    toast(`Deleted ${p.name}`);
  }

  // ============================================================== search

  function searchPeople(q, limit = 12) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const p of all()) {
      const name = p.name.toLowerCase(), nick = (p.nickname || '').toLowerCase();
      let s = 0;
      if (name.startsWith(q) || nick.startsWith(q)) s = 4;
      else if (name.split(/\s+/).some((w) => w.startsWith(q)) || nick.includes(q)) s = 3;
      else if (name.includes(q)) s = 2;
      else if ([p.location, p.notes, p.phone].some((f) => String(f || '').toLowerCase().includes(q))) s = 1;
      if (s) scored.push([s, p]);
    }
    return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map((x) => x[1]);
  }
  function highlight(text, q) {
    const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
    if (!q.trim() || i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.trim().length)) + '</mark>' + esc(text.slice(i + q.trim().length));
  }
  const resultRow = (p, q, attr) => `<div class="res" ${attr}="${esc(p.id)}">${avatar(p)}<div><div class="r-name">${highlight(p.name, q)}${p.nickname ? ` <span class="r-ctx">“${highlight(p.nickname, q)}”</span>` : ''}</div><div class="r-ctx">${esc(context(p))}</div></div></div>`;

  const sInput = $('#search'), sBox = $('#searchResults');
  let sIndex = 0;
  function drawSearch() {
    const q = sInput.value;
    const res = searchPeople(q);
    sIndex = clamp(sIndex, 0, Math.max(0, res.length - 1));
    sBox.innerHTML = res.length ? res.map((p) => resultRow(p, q, 'data-find')).join('') : (q.trim() ? '<div class="empty-res">No one found</div>' : '');
    $$('.res', sBox).forEach((el, i) => el.classList.toggle('active', i === sIndex));
    sBox.classList.toggle('open', !!q.trim());
  }
  sInput.addEventListener('input', () => { sIndex = 0; drawSearch(); });
  sInput.addEventListener('focus', drawSearch);
  sInput.addEventListener('blur', () => setTimeout(() => sBox.classList.remove('open'), 150));
  sInput.addEventListener('keydown', (e) => {
    const rows = $$('.res', sBox);
    if (e.key === 'ArrowDown') { e.preventDefault(); sIndex = Math.min(rows.length - 1, sIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sIndex = Math.max(0, sIndex - 1); }
    else if (e.key === 'Enter' && rows[sIndex]) { pick(rows[sIndex].dataset.find); return; }
    else if (e.key === 'Escape') { sInput.blur(); return; }
    else return;
    rows.forEach((el, i) => el.classList.toggle('active', i === sIndex));
    rows[sIndex]?.scrollIntoView({ block: 'nearest' });
  });
  sBox.addEventListener('mousedown', (e) => { const r = e.target.closest('[data-find]'); if (r) { e.preventDefault(); pick(r.dataset.find); } });
  function pick(id) { sInput.value = ''; sBox.classList.remove('open'); sInput.blur(); locate(id); }

  // ============================================================== editor

  function makePicker(el, { max = Infinity }) {
    let value = [], exclude = new Set();
    el.innerHTML = `<div class="pk-chips chips"></div><div class="pk-wrap"><input class="pk-input" placeholder="Type a name to link…"><div class="pk-list"></div></div>`;
    const chipsEl = $('.pk-chips', el), wrap = $('.pk-wrap', el), input = $('.pk-input', el), list = $('.pk-list', el);
    let idx = 0;
    const draw = () => {
      chipsEl.innerHTML = value.map((id) => `<span class="chip">${avatar(P(id), 'sm')}${esc(P(id).name)}<button type="button" class="rm" data-rm="${esc(id)}" aria-label="Remove">✕</button></span>`).join('');
      wrap.hidden = value.length >= max;
    };
    const search = () => {
      const q = input.value;
      const res = searchPeople(q, 8).filter((p) => !value.includes(p.id) && !exclude.has(p.id));
      idx = clamp(idx, 0, Math.max(0, res.length - 1));
      list.innerHTML = res.length ? res.map((p) => resultRow(p, q, 'data-pk')).join('') : '<div class="empty-res">No match. Add them first, then link.</div>';
      $$('.res', list).forEach((r, i) => r.classList.toggle('active', i === idx));
      list.classList.toggle('open', !!q.trim());
    };
    const add = (id) => { value.push(id); input.value = ''; list.classList.remove('open'); draw(); if (!wrap.hidden) input.focus(); };
    input.addEventListener('input', () => { idx = 0; search(); });
    input.addEventListener('blur', () => setTimeout(() => list.classList.remove('open'), 150));
    input.addEventListener('keydown', (e) => {
      const rows = $$('.res', list);
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(rows.length - 1, idx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (rows[idx]) add(rows[idx].dataset.pk); return; }
      else return;
      rows.forEach((r, i) => r.classList.toggle('active', i === idx));
    });
    list.addEventListener('mousedown', (e) => { const r = e.target.closest('[data-pk]'); if (r) { e.preventDefault(); add(r.dataset.pk); } });
    chipsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { value = value.filter((v) => v !== b.dataset.rm); draw(); } });
    return {
      get: () => [...value],
      set(v, ex) { value = [...v]; exclude = new Set(ex); input.value = ''; list.classList.remove('open'); draw(); },
    };
  }

  const dlg = $('#editDialog');
  const form = $('#editForm');
  const F = (n) => form.elements.namedItem(n);
  const parentsPicker = makePicker($('#parentsPicker'), { max: 2 });
  const spousePicker = makePicker($('#spousePicker'), {});
  let editing = null;

  function drawPhoto() {
    const el = $('#photoPreview');
    el.className = `av xl ${F('gender').value}`;
    el.style.backgroundImage = editing.photo ? `url('${editing.photo}')` : '';
    el.textContent = editing.photo ? '' : initials({ name: F('fullName').value || F('fullName').placeholder || '?' });
  }

  function openEditor(id, preset = {}, extra = {}) {
    const base = id ? P(id) : blankPerson(preset);
    editing = { id: base.id, isNew: !id, childOf: extra.childOf || null, photo: base.photo };
    $('#editTitle').textContent = id ? `Edit ${base.name}` : 'Add person';
    const fields = { fullName: base.name, nickname: base.nickname, gender: base.gender, birthYear: base.birthYear, deathYear: base.deathYear, order: base.order, location: base.location, phone: base.phone, notes: base.notes };
    for (const [k, v] of Object.entries(fields)) F(k).value = v ?? '';
    F('deceased').checked = !!base.deceased;
    // Placeholder names: clear the field but show the old name as a hint.
    if (id && isPlaceholder(base)) { F('fullName').value = ''; F('fullName').placeholder = base.name; } else F('fullName').placeholder = '';
    // Can't be your own parent/spouse, and a child can't be your parent.
    const descendants = new Set();
    const walk = (x) => childrenOf(x).forEach((c) => { if (!descendants.has(c)) { descendants.add(c); walk(c); } });
    if (id) walk(id);
    parentsPicker.set(base.parents, [base.id, ...descendants]);
    spousePicker.set(base.spouses, [base.id]);
    drawPhoto();
    dlg.showModal();
    F('fullName').focus();
  }

  F('gender').addEventListener('change', drawPhoto);
  F('fullName').addEventListener('input', drawPhoto);
  F('deathYear').addEventListener('input', () => { if (F('deathYear').value) F('deceased').checked = true; });
  $('#photoInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { editing.photo = await shrinkImage(f, 220); drawPhoto(); } catch { toast('Could not read that image.'); }
  });
  $('#photoRemove').onclick = () => { editing.photo = ''; drawPhoto(); };
  $('#editCancel').onclick = $('#editClose').onclick = () => dlg.close();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = F('fullName').value.trim() || F('fullName').placeholder;
    if (!name) { F('fullName').focus(); return; }
    const id = editing.id;
    const old = P(id);
    const d = {
      ...(old || blankPerson()), id, name,
      nickname: F('nickname').value.trim(), gender: F('gender').value,
      birthYear: F('birthYear').value, deathYear: F('deathYear').value, order: F('order').value,
      location: F('location').value.trim(), phone: F('phone').value.trim(), notes: F('notes').value.trim(),
      deceased: F('deceased').checked || !!F('deathYear').value, photo: editing.photo,
      parents: parentsPicker.get(), spouses: spousePicker.get(),
    };
    for (const s of old?.spouses || []) if (!d.spouses.includes(s) && P(s)) P(s).spouses = P(s).spouses.filter((x) => x !== id);
    state.people[id] = d;
    for (const s of d.spouses) if (P(s) && !P(s).spouses.includes(id)) P(s).spouses.push(id);
    if (editing.childOf && P(editing.childOf)) {
      const c = P(editing.childOf);
      if (!c.parents.includes(id) && c.parents.length < 2) c.parents.push(id);
    }
    dlg.close();
    save();
    render();
    toast((editing.isNew ? 'Added ' : 'Saved ') + name);
    locate(id);
  });

  function shrinkImage(file, size) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.width, img.height), c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.84));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ================================================================ menu

  $('#addPersonBtn').onclick = () => openEditor(null);
  const menu = $('#menu');
  $('#menuBtn').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) menu.hidden = true; });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    menu.hidden = true;
    switch (b.dataset.menu) {
      case 'expand': collapsed.clear(); saveUI(); render(); fit(); break;
      case 'collapse': {
        const lay = computeLayout();
        collapsed = new Set([...lay.unitOf.values()].filter((u) => u.kids.length).map((u) => u.key));
        saveUI(); render(); fit(); break;
      }
      case 'export': {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `family-tree-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        break;
      }
      case 'reset':
        if (!confirm('Replace everything with the starter tree? Export a backup first if you want to keep your data.')) return;
        state = starterTree(); collapsed.clear(); closePanel(); save(); saveUI(); render(); fit();
        toast('Reset to starter tree');
        break;
    }
  });
  $('#importInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    menu.hidden = true;
    if (!f) return;
    try {
      const data = normalize(JSON.parse(await f.text()));
      if (!confirm(`Replace the current tree (${all().length} people) with this file (${Object.keys(data.people).length} people)?`)) return;
      state = data; collapsed.clear(); closePanel(); save(); saveUI(); render(); fit();
      toast('Imported ' + f.name);
    } catch { toast('That file is not a valid family tree backup.'); }
  });
  $('#bannerClose').onclick = () => { $('#banner').dataset.closed = '1'; $('#banner').hidden = true; saveUI(); };

  document.addEventListener('keydown', (e) => {
    if (dlg.open) return;
    if (e.key === '/' && document.activeElement !== sInput) { e.preventDefault(); sInput.focus(); }
    else if (e.key === 'Escape') closePanel();
  });
  addEventListener('resize', () => applyCam());

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ================================================================ boot
  (async () => {
    await load();
    render();
    fit(false, 0.5);
  })();
})();
