/* Family Tree — one connected tree, plain JS, no build step.
   Data lives in localStorage; export/import JSON for backups. */
(() => {
  'use strict';

  const STORE_KEY = 'familyTree.v1';
  const UI_KEY = 'familyTree.ui';

  // Layout metrics (world units = px at 100% zoom)
  let CARD_W = 196, CARD_H = 84;  // larger with "Larger profile cards"
  const SPOUSE_GAP = 28;          // gap between spouses in a couple
  const SIB_GAP = 30;             // gap between sibling sub-trees
  const TREE_GAP = 110;           // gap between unconnected top-level families
  let ROW_H = CARD_H + 108;       // vertical distance between generations
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
  let scopeId = null;            // when set, only this person's family is shown
  let meId = null;               // remembered by the relationship checker
  let hideSiblings = false;      // show only the direct line of the home person
  let firstVisit = false;        // no saved view yet: open on the home families
  let lastSelected = null;
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
    return { people, terms: {} };
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
    const terms = {};
    for (const [k, v] of Object.entries(data.terms || {})) {
      if (v && typeof v === 'object') terms[String(k).includes('>') ? String(k) : String(k).toLowerCase()] = { hi: v.hi == null ? null : String(v.hi), or: v.or == null ? null : String(v.or) };
    }
    return { people, terms };
  }

  // Undo history (this session only). Call remember() before every data change.
  const undoStack = [], redoStack = [];
  function remember(label) {
    undoStack.push({ label, data: JSON.stringify(state) });
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(from, to, verb) {
    const snap = from.pop();
    if (!snap) { toast(verb === 'Undid' ? 'Nothing to undo' : 'Nothing to redo'); return; }
    to.push({ label: snap.label, data: JSON.stringify(state) });
    state = normalize(JSON.parse(snap.data));
    if (selectedId && !P(selectedId)) closePanel();
    save(); render();
    if (selectedId) renderPanel();
    if (relDlg.open) drawRelations();
    toast(`${verb}: ${snap.label}`);
  }
  const undo = () => canEdit() && restore(undoStack, redoStack, 'Undid');
  const redo = () => canEdit() && restore(redoStack, undoStack, 'Redid');
  function updateUndoButtons() {
    $('#undoBtn').disabled = !undoStack.length;
    $('#redoBtn').disabled = !redoStack.length;
    $('#undoBtn').title = undoStack.length ? `Undo ${undoStack[undoStack.length - 1].label} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
    $('#redoBtn').title = redoStack.length ? `Redo ${redoStack[redoStack.length - 1].label} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)';
  }

  function saveLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch { toast('Could not save — browser storage may be full (try smaller photos).'); }
  }
  // Every change goes through here: kept in this browser, and sent to the shared tree when there is one.
  function save() {
    saveLocal();
    queuePush();
  }
  function saveUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ v: 2, collapsed: [...collapsed], scopeId, meId, hideSiblings, bannerClosed: $('#banner').dataset.closed === '1' })); } catch { /* ignore */ }
  }

  async function load() {
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      firstVisit = ui.v !== 2;
      collapsed = new Set(firstVisit ? [] : ui.collapsed || []);
      scopeId = firstVisit ? '@home' : ui.scopeId || null;
      meId = ui.meId || null;
      hideSiblings = !!ui.hideSiblings;
      if (ui.bannerClosed) $('#banner').dataset.closed = '1';
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { state = normalize(JSON.parse(raw)); return; }
    } catch { /* fall through */ }
    // A family.json committed next to index.html seeds a fresh browser.
    try {
      const res = await fetch('family.json', { cache: 'no-store' });
      if (res.ok) { state = normalize(await res.json()); saveLocal(); return; }
    } catch { /* ignore */ }
    state = starterTree();
    saveLocal();
  }

  const P = (id) => state.people[id];
  const all = () => Object.values(state.people);

  // Eldest first: birth order when both have one, else birth year, else whoever has either.
  function byAge(a, b) {
    const A = P(a), B = P(b);
    const oa = +A.order || 0, ob = +B.order || 0;
    if (oa && ob && oa !== ob) return oa - ob;
    const ya = +A.birthYear || 0, yb = +B.birthYear || 0;
    if (ya && yb && ya !== yb) return ya - yb;
    const ka = oa || ya ? 0 : 1, kb = ob || yb ? 0 : 1;   // unknowns go last
    if (ka !== kb) return ka - kb;
    return A.name.localeCompare(B.name);
  }
  function childrenOf(id) { return all().filter((c) => c.parents.includes(id)).map((c) => c.id).sort(byAge); }
  function siblingsOf(id) {
    const p = P(id);
    if (!p.parents.length) return [];
    return all().filter((c) => c.id !== id && c.parents.some((x) => p.parents.includes(x))).map((c) => c.id).sort(byAge);
  }
  // Siblings whose parents aren't known share a stand-in "Parents unknown" card.
  const UNKNOWN = 'Parents unknown';
  const realPeople = () => all().filter((p) => !p.unknown);
  function makeUnknownParent() {
    const u = blankPerson({ name: UNKNOWN, unknown: true });
    state.people[u.id] = u;
    return u.id;
  }
  // Make a and b brothers/sisters. Returns an error message, or '' when done.
  function linkSiblings(a, b) {
    const A = P(a), B = P(b);
    if (!A || !B || a === b || A.parents.some((x) => B.parents.includes(x))) return '';
    if (!A.parents.length && !B.parents.length) { const u = makeUnknownParent(); A.parents = [u]; B.parents = [u]; return ''; }
    if (!B.parents.length) { B.parents = [...A.parents]; return ''; }
    if (!A.parents.length) { A.parents = [...B.parents]; return ''; }
    // One side only has stand-in parents: move that whole group of siblings under the known parents.
    const onlyUnknown = (ps) => ps.every((x) => P(x).unknown);
    const merge = (from, to) => { for (const c of all()) if (c.parents.length && c.parents.every((x) => from.includes(x))) c.parents = [...to]; };
    if (onlyUnknown(B.parents)) { merge([...B.parents], A.parents); return ''; }
    if (onlyUnknown(A.parents)) { merge([...A.parents], B.parents); return ''; }
    return `${A.name} and ${B.name} already have different parents, so they can't be linked as siblings.`;
  }
  // Stand-in parents linking fewer than two children aren't needed any more.
  function cleanupUnknown() {
    for (const u of all()) {
      if (!u.unknown || u.spouses.length) continue;
      if (all().filter((c) => c.parents.includes(u.id)).length < 2) {
        delete state.people[u.id];
        for (const o of all()) o.parents = o.parents.filter((x) => x !== u.id);
      }
    }
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
  // Photos only: people without one are shown by name alone.
  const avatar = (p, cls = '') => (p.photo ? `<div class="av ${p.gender} ${cls}" style="background-image:url('${esc(p.photo)}')"></div>` : '');
  function context(p) {
    if (p.parents.length && p.parents.every((x) => P(x).unknown)) {
      const sibs = siblingsOf(p.id).map((x) => P(x).name);
      return `${p.gender === 'male' ? 'Brother' : p.gender === 'female' ? 'Sister' : 'Sibling'} of ${sibs.join(', ')}`;
    }
    if (p.parents.length) return `${p.gender === 'male' ? 'Son' : p.gender === 'female' ? 'Daughter' : 'Child'} of ${p.parents.filter((x) => !P(x).unknown).map((x) => P(x).name).join(' & ')}`;
    if (p.spouses.length) return `Spouse of ${p.spouses.map((x) => P(x).name).join(', ')}`;
    return p.location || '';
  }

  // ============================================================== layout
  //
  // People married to each other form a "unit" (a couple, or one person).
  // Every unit hangs under the unit of its anchor's parents, which turns the
  // family graph into a tree we can lay out cleanly. When a spouse's own
  // parents are also in the tree (e.g. a daughter who married into another
  // family), the whole couple and their descendants are drawn a second time
  // under her parents, and a dotted line joins her two cards.

  // A family = a couple, all their descendants, and those descendants' spouses.
  function familyOf(rootId) {
    const blood = new Set([rootId, ...P(rootId).spouses]);
    const kids = new Map();
    for (const p of all()) for (const x of p.parents) { if (!kids.has(x)) kids.set(x, []); kids.get(x).push(p.id); }
    const stack = [...blood];
    while (stack.length) for (const c of kids.get(stack.pop()) || []) if (!blood.has(c)) { blood.add(c); stack.push(c); }
    const set = new Set(blood);
    for (const x of blood) P(x).spouses.forEach((s) => set.add(s));
    return set;
  }

  // stack: lay top-level families one under another (used by the home view)
  function computeLayout(scope = null, stack = false, unfold = false) {
    // Work on a view of the data restricted to the chosen family.
    const inS = (id) => !scope || scope.has(id);
    const people = {};
    for (const p of all()) if (inS(p.id)) people[p.id] = { ...p, parents: p.parents.filter(inS), spouses: p.spouses.filter(inS) };
    const ids = Object.keys(people);
    const list = Object.values(people);

    // --- generations: child = parent + 1, spouses share a generation.
    // Walk each connected family once so that everyone lines up across both
    // sides (e.g. both sets of grandparents), whatever is added above them.
    const gen = {};
    const kids = Object.fromEntries(ids.map((i) => [i, []]));
    for (const p of list) for (const x of p.parents) kids[x].push(p.id);
    for (const start of ids) {
      if (start in gen) continue;
      gen[start] = 0;
      const comp = [start], queue = [start];
      while (queue.length) {
        const x = queue.shift(), p = people[x];
        const next = [...p.parents.map((y) => [y, -1]), ...kids[x].map((y) => [y, 1]), ...p.spouses.map((y) => [y, 0])];
        for (const [y, d] of next) if (!(y in gen)) { gen[y] = gen[x] + d; comp.push(y); queue.push(y); }
      }
      const top = Math.min(...comp.map((y) => gen[y]));
      comp.forEach((y) => { gen[y] -= top; });
    }
    // Unusual marriages (across generations) can break the rules above; repair them.
    for (let iter = 0; iter < ids.length + 2; iter++) {
      let changed = false;
      for (const id of ids) {
        const p = people[id];
        let g = gen[id];
        for (const x of p.parents) g = Math.max(g, gen[x] + 1);
        for (const sp of p.spouses) g = Math.max(g, gen[sp]);
        if (g !== gen[id]) { gen[id] = g; changed = true; }
      }
      if (!changed) break;
    }

    // --- units (connected components of the spouse graph)
    const uf = Object.fromEntries(ids.map((i) => [i, i]));
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    for (const p of list) for (const s of p.spouses) uf[find(p.id)] = find(s);
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

    // --- copies of a couple's family under the other spouse's parents
    const clone = (u, prefix, anchor) => ({
      key: prefix + u.key, anchor: anchor || u.anchor, members: u.members, gen: u.gen, mirror: true,
      kids: u.kids.filter((k) => !k.mirror).map((k) => clone(k, prefix)),
    });
    const bridges = [];
    for (const u of units) {
      for (const m of u.members) {
        if (m === u.anchor) continue;
        const pu = people[m].parents.map((x) => unitOf.get(x)).find((v) => v && v !== u);
        if (!pu) continue;
        const copy = clone(u, `m:${m}:`, m);
        pu.kids.push(copy);
        bridges.push({ person: m, real: u, copy });
      }
    }
    const sortKids = (u) => { u.kids.sort((a, b) => byAge(a.anchor, b.anchor)); u.kids.forEach(sortKids); };
    units.filter((u) => !u.parent).forEach(sortKids);

    // --- seniority among cousins: within each top family, rank everyone in a
    // generation (grandchildren and below) by birth year. Needs birth years.
    for (const r of units.filter((u) => !u.parent)) {
      const byDepth = new Map();
      const walk = (u, d) => {
        if (d >= 2) { if (!byDepth.has(d)) byDepth.set(d, []); byDepth.get(d).push(u); }
        u.kids.forEach((k) => walk(k, d + 1));
      };
      walk(r, 0);
      for (const row of byDepth.values()) {
        const dated = row.filter((u) => +people[u.anchor].birthYear);
        if (dated.length < 2) continue;
        dated.sort((a, b) => (+people[a.anchor].birthYear - +people[b.anchor].birthYear) || byAge(a.anchor, b.anchor));
        dated.forEach((u, i) => { u.rank = i + 1; u.rankOf = row.length; });
      }
    }

    const unitW = (u) => u.members.length * CARD_W + (u.members.length - 1) * SPOUSE_GAP;
    const descCount = (u) => u.kids.reduce((n, k) => n + k.members.length + descCount(k), 0);

    // --- measure / place (parents centred over their children)
    function measure(u) {
      const w = unitW(u);
      u.open = u.kids.length > 0 && (unfold || !collapsed.has(u.key));
      if (!u.open) { u.kw = 0; return (u.w = w); }
      u.kw = u.kids.reduce((s, k, i) => s + measure(k) + (i ? SIB_GAP : 0), 0);
      return (u.w = Math.max(w, u.kw));
    }
    const minGen = Math.min(0, ...Object.values(gen));
    const pos = new Map();          // the primary card of each person
    const visibleUnits = [];
    let baseGen = minGen, yOff = 0;
    function place(u, left) {
      const w = unitW(u);
      u.y = (u.gen - baseGen) * ROW_H + PAD + yOff;
      if (u.open) {
        let cx = left + (u.w - u.kw) / 2;
        for (const k of u.kids) { place(k, cx); cx += k.w + SIB_GAP; }
        const f = u.kids[0], l = u.kids[u.kids.length - 1];
        const centre = (f.x + unitW(f) / 2 + l.x + unitW(l) / 2) / 2;
        u.x = clamp(centre - w / 2, left, left + u.w - w);
      } else u.x = left + (u.w - w) / 2;
      u.mpos = new Map(u.members.map((m, i) => [m, { x: u.x + i * (CARD_W + SPOUSE_GAP), y: u.y }]));
      for (const [m, p] of u.mpos) if (!u.mirror || !pos.has(m)) pos.set(m, p);
      visibleUnits.push(u);
    }

    // --- order top-level families so families joined by marriage sit side by side
    const roots = units.filter((u) => !u.parent);
    const rootOf = (u) => { while (u.parent) u = u.parent; return u; };
    roots.forEach(measure);
    const links = new Map(roots.map((r) => [r, new Set()]));
    for (const p of list) {
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
    let x = PAD;
    if (!stack) {
      for (const r of ordered) { place(r, x); x += r.w + TREE_GAP; }
    } else {
      // One family under another, each with its top couple centred on the same line.
      const blocks = [];
      for (const r of ordered) {
        const start = visibleUnits.length;
        baseGen = r.gen;
        place(r, PAD);
        const units = visibleUnits.slice(start);
        const bottom = Math.max(...units.map((u) => u.y)) + CARD_H;
        blocks.push({ units, centre: r.x + unitW(r) / 2 });
        yOff = bottom - PAD + ROW_H * 0.55;
      }
      const C = Math.max(...blocks.map((b) => b.centre));
      for (const b of blocks) {
        const dx = C - b.centre;
        for (const u of b.units) { u.x += dx; for (const p of u.mpos.values()) p.x += dx; }
      }
      x = Math.max(...visibleUnits.map((u) => u.x + unitW(u))) + TREE_GAP;
    }

    const maxGen = Math.max(0, ...visibleUnits.map((u) => u.gen - minGen));
    const first = ordered[0];
    return {
      people, pos, unitOf, visibleUnits, unitW, descCount, roots: ordered,
      bridges: bridges.filter((b) => b.real.mpos && b.copy.mpos && visibleUnits.includes(b.real) && visibleUnits.includes(b.copy)),
      byKey: new Map(visibleUnits.map((u) => [u.key, u])),
      allPos: visibleUnits.flatMap((u) => [...u.mpos.values()]),
      focusX: stack && ordered.length ? ordered[0].x + unitW(ordered[0]) / 2 : (() => {
        const big = ordered.filter((u) => u.kids.length);
        const us = big.length ? big : ordered.slice(0, 1);
        return us.length ? us.reduce((sum, u) => sum + u.x + unitW(u) / 2, 0) / us.length : 0;
      })(),
      width: Math.max(0, x - TREE_GAP) + PAD,
      height: (visibleUnits.length ? Math.max(...visibleUnits.map((u) => u.y)) : 0) + CARD_H + PAD,
      generations: new Set(Object.values(gen)).size,
    };
  }

  // ======================================================= family filter

  const coupleName = (id) => P(id).unknown
    ? `the parents of ${childrenOf(id).map((c) => P(c).name.split(' ')[0]).join(', ')}`
    : [id, ...P(id).spouses].map((x) => P(x).name).join(' & ');
  const familySize = (id) => [...familyOf(id)].filter((x) => !P(x).unknown).length;

  // The person the tree is "about": you, if you've said so in Relations,
  // otherwise the person the tree started from (id "me").
  function homePerson() {
    if (meId && P(meId) && !P(meId).unknown) return meId;
    if (P('me') && !P('me').unknown) return 'me';
    return null;
  }
  // Home view: both sets of the home person's grandparents and their families.
  function homeRoots() {
    const me = homePerson();
    if (!me) return [];
    const roots = [];
    for (const parent of P(me).parents) {
      const gp = P(parent)?.parents.find((x) => P(x) && !P(x).unknown);
      if (gp && !roots.some((r) => r === gp || P(r).spouses.includes(gp))) roots.push(gp);
    }
    if (!roots.length) P(me).parents.filter((x) => !P(x).unknown).slice(0, 1).forEach((x) => roots.push(x));
    return roots;
  }
  // You, your parents, grandparents… and your descendants, with their spouses.
  function directLine(id) {
    const line = new Set([id]);
    const up = [id];
    while (up.length) for (const x of P(up.pop()).parents) if (!line.has(x)) { line.add(x); up.push(x); }
    const down = [id];
    while (down.length) { const x = down.pop(); for (const c of childrenOf(x)) if (!line.has(c)) { line.add(c); down.push(c); } }
    for (const x of [...line]) P(x).spouses.forEach((sp) => line.add(sp));
    return line;
  }

  function currentScope() {
    let base = null;
    if (scopeId === '@home') {
      const roots = homeRoots();
      if (roots.length) { base = new Set(); roots.forEach((r) => familyOf(r).forEach((x) => base.add(x))); }
    } else if (scopeId && P(scopeId)) base = familyOf(scopeId);
    else if (scopeId) scopeId = null;
    if (hideSiblings) {
      const focus = homePerson() || lastSelected;
      if (focus && P(focus)) {
        const line = directLine(focus);
        base = base ? new Set([...base].filter((x) => line.has(x))) : line;
      }
    }
    return base;
  }

  function renderScopeSelect() {
    const full = computeLayout(null);
    const families = full.roots.filter((u) => u.kids.length).map((u) => u.anchor);
    if (scopeId && scopeId !== '@home' && !families.some((f) => f === scopeId || P(f).spouses.includes(scopeId))) families.push(scopeId);
    const home = homeRoots();
    const opts = (home.length ? `<option value="@home">Home: ${esc(home.map(coupleName).join(' + '))}</option>` : '')
      + `<option value="">Everyone (${realPeople().length})</option>`
      + families.map((id) => `<option value="${esc(id)}">Family of ${esc(coupleName(id))} (${familySize(id)})</option>`).join('');
    const match = scopeId === '@home' ? '@home' : scopeId && families.find((f) => f === scopeId || P(f).spouses.includes(scopeId));
    for (const sel of $$('.scope-select')) { sel.innerHTML = opts; sel.value = match || ''; }
    $('#scopeWrap').classList.toggle('active', !!scopeId && scopeId !== '@home');
    $$('[data-menu="siblings"]').forEach((b) => { b.textContent = hideSiblings ? 'Show siblings' : 'Hide siblings (direct line only)'; });
  }

  function setScope(id) {
    scopeId = id || null;
    closePanel();
    saveUI();
    render();
    fit(true, readableZoom());
    if (scopeId && scopeId !== '@home') toast(`Showing the family of ${coupleName(scopeId)}`);
  }

  const isPhone = () => innerWidth <= 760;
  const readableZoom = () => (isPhone() ? 0.62 : 0.72);

  // The calm starting point: grandparents and their children, the rest folded away.
  function goHome(animate = true) {
    if (!homeRoots().length) { fit(animate, readableZoom()); return; }
    scopeId = '@home';
    const lay = computeLayout(currentScope(), true);
    collapsed = new Set();
    for (const r of lay.roots) for (const k of r.kids) if (k.kids.length) collapsed.add(k.key);
    closePanel();
    saveUI();
    render();
    fit(animate, readableZoom());
  }

  function toggleSiblings() {
    const focus = homePerson() || lastSelected;
    if (!hideSiblings && !focus) { toast('Open someone first, or set who you are in Relations.'); return; }
    hideSiblings = !hideSiblings;
    saveUI();
    render();
    fit(true, readableZoom());
    toast(hideSiblings ? `Showing only the direct line of ${P(focus).name}` : 'Showing everyone again');
  }

  // ============================================================== render
  // ============================================================== render

  function elbow(sx, sy, cx, cy, busY) {
    if (Math.abs(cx - sx) < 1) return `M${sx},${sy}V${cy}`;
    const r = Math.min(14, Math.abs(cx - sx) / 2, (busY - sy) / 2, (cy - busY) / 2);
    const d = Math.sign(cx - sx);
    return `M${sx},${sy}V${busY - r}Q${sx},${busY} ${sx + d * r},${busY}H${cx - d * r}Q${cx},${busY} ${cx},${busY + r}V${cy}`;
  }

  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >= 11 && n % 100 <= 13) || n % 10 > 3 ? 0 : n % 10]);

  function cardHTML(id, x, y, copy, rank = 0, rankOf = 0) {
    const p = P(id);
    if (p.unknown) {
      return `<div class="card unknown" data-id="${esc(id)}" style="left:${x}px;top:${y}px" tabindex="0" role="button" aria-label="Parents unknown">
        <div class="txt"><div class="nm">Parents unknown</div><div class="sub">Add a name if you find out</div></div>
      </div>`;
    }
    const sub = [p.nickname && `“${p.nickname}”`, years(p)].filter(Boolean).join(' · ') || p.location || '';
    return `<div class="card ${p.gender}${isDead(p) ? ' dead' : ''}${copy ? ' copy' : ''}" data-id="${esc(id)}" style="left:${x}px;top:${y}px" tabindex="0" role="button" aria-label="${esc(p.name)}"${copy ? ' title="Also shown in their other family (see the dotted line)"' : ''}>
        ${avatar(p)}
        <div class="txt"><div class="nm">${esc(p.name)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
        ${rank ? `<span class="rank" title="${ordinal(rank)} eldest of the ${rankOf} cousins in this generation of the family">${ordinal(rank)}</span>` : ''}
      </div>`;
  }

  function render() {
    L = computeLayout(currentScope(), scopeId === '@home' && !hideSiblings, hideSiblings);
    const { visibleUnits, unitW } = L;
    const nodes = [];
    const paths = [];

    for (const u of visibleUnits) {
      // spouse links
      for (let i = 0; i + 1 < u.members.length; i++) {
        const a = u.mpos.get(u.members[i]), b = u.mpos.get(u.members[i + 1]);
        const y = a.y + CARD_H / 2;
        paths.push(`<path class="spouse" d="M${a.x + CARD_W},${y}H${b.x}"/>`);
        paths.push(`<circle class="ring" cx="${(a.x + CARD_W + b.x) / 2}" cy="${y}" r="4"/>`);
      }
      // parent → child links
      if (!u.open) continue;
      for (const k of u.kids) {
        const c = k.anchor;
        const cp = k.mpos.get(c);
        const par = L.people[c].parents.filter((x) => u.members.includes(x));
        if (!cp || !par.length) continue;
        const pts = par.map((x) => u.mpos.get(x));
        let sx, sy;
        if (pts.length === 2) { sx = (Math.min(pts[0].x, pts[1].x) + CARD_W + Math.max(pts[0].x, pts[1].x)) / 2; sy = pts[0].y + CARD_H / 2 + 4; }
        else { sx = pts[0].x + CARD_W / 2; sy = pts[0].y + CARD_H; }
        paths.push(`<path class="tree" data-c="${esc(c)}" data-p="${esc(par.join(' '))}" d="${elbow(sx, sy, cp.x + CARD_W / 2, cp.y, cp.y - 44)}"/>`);
      }
    }

    // dotted lines joining the two cards of someone shown in two families
    for (const b of L.bridges) {
      const a = b.real.mpos.get(b.person), c = b.copy.mpos.get(b.person);
      const ax = a.x + CARD_W / 2, cx = c.x + CARD_W / 2;
      const lift = Math.min(150, 60 + Math.abs(cx - ax) * 0.08);
      const d = `M${ax},${a.y}C${ax},${a.y - lift} ${cx},${c.y - lift} ${cx},${c.y}`;
      paths.push(`<path class="bridge" data-c="${esc(b.person)}" data-p="" d="${d}"/>`);
      const mx = (ax + cx) / 2, my = (a.y + c.y) / 2 - lift * 0.75;
      paths.push(`<g class="bridge-tag" transform="translate(${mx},${my})"><rect x="-58" y="-12" width="116" height="24" rx="12"/><text text-anchor="middle" y="5">same person</text></g>`);
    }

    for (const u of visibleUnits) for (const [id, p] of u.mpos) nodes.push(cardHTML(id, p.x, p.y, u.mirror, id === u.anchor ? u.rank : 0, u.rankOf));

    // expand / collapse pills
    for (const u of visibleUnits) {
      if (!u.kids.length) continue;
      const cx = u.x + unitW(u) / 2;
      const cy = u.y + CARD_H + 30;
      const n = L.descCount(u);
      const label = u.open ? '−' : `+${n}`;
      const title = u.open ? 'Hide children' : `Show ${n} hidden`;
      nodes.push(`<button class="tgl${u.open ? '' : ' closed'}" data-toggle="${esc(u.key)}" style="left:${cx}px;top:${cy}px" title="${title}" aria-label="${title}">${label}</button>`);
    }

    const svg = $('#edges');
    svg.setAttribute('width', L.width);
    svg.setAttribute('height', L.height);
    svg.innerHTML = paths.join('');
    $('#nodes').innerHTML = nodes.join('');

    const total = realPeople().length;
    $('#stats').innerHTML = scopeId
      ? `<span><b>${Object.values(L.people).filter((p) => !p.unknown).length}</b> of ${total} people</span><button class="link" id="showAll">Show everyone</button>`
      : `<span><b>${total}</b> ${total === 1 ? 'person' : 'people'}</span><span><b>${total ? L.generations : 0}</b> generations</span>`;
    $('#showAll')?.addEventListener('click', () => setScope(null));
    renderScopeSelect();
    updateUndoButtons();
    const banner = $('#banner');
    banner.hidden = banner.dataset.closed === '1' || !all().some(isPlaceholder);

    let empty = $('#emptyState');
    if (!total && !empty) {
      document.body.insertAdjacentHTML('beforeend', `<div id="emptyState" class="empty-state"><h2>Start your family tree</h2><p>Add the first person, then add their parents, spouse and children.</p><button class="btn primary" id="emptyAdd">+ Add person</button></div>`);
      $('#emptyAdd').onclick = () => openEditor(null);
    } else if (total && empty) empty.remove();

    applySelection();
    if (view === 'fan') renderFan();
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
    for (const p of L.allPos) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + CARD_W); maxY = Math.max(maxY, p.y + CARD_H); }
    let k = clamp(Math.min((r.w - 60) / (maxX - minX), (r.h - 60) / (maxY - minY)), 0.12, 1);
    let cy = r.y + r.h / 2 - ((minY + maxY) / 2) * k;
    let cx = r.x + r.w / 2 - ((minX + maxX) / 2) * k;
    if (k < minK) { k = minK; cy = r.y + 40 - minY * k; cx = r.x + r.w / 2 - L.focusX * k; }
    const target = { k, x: cx, y: cy };
    animate ? animateTo(target) : (Object.assign(cam, target), applyCam());
  }
  function centreOn(target, minK = 0.85) {
    const p = typeof target === 'string' ? L.pos.get(target) : target;
    if (!p) return;
    const r = safeRect();
    const k = Math.max(cam.k, minK);
    animateTo({ k, x: r.x + r.w / 2 - (p.x + CARD_W / 2) * k, y: r.y + r.h / 2 - (p.y + CARD_H / 2) * k });
  }

  // Keep a given person fixed on screen while the layout changes underneath.
  function keepSteady(key, fn) {
    const b = L?.byKey.get(key), before = b && { x: b.x, y: b.y };
    fn();
    const after = L?.byKey.get(key);
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
    if (c) select(c.dataset.id, true, c);
  });
  $('#nodes').addEventListener('keydown', (e) => {
    const c = e.target.closest('.card');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(c.dataset.id, true, c); }
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
    const scope = currentScope();
    if (scope && !scope.has(id)) { scopeId = null; saveUI(); render(); toast('Showing everyone'); }
    const lay = computeLayout(currentScope());
    let u = lay.unitOf.get(id)?.parent;
    let changed = false;
    while (u) { if (collapsed.delete(u.key)) changed = true; u = u.parent; }
    if (changed) { saveUI(); render(); }
    if (open) select(id, false);
    centreOn(id);
    requestAnimationFrame(() => {
      const el = $(`#nodes .card[data-id="${CSS.escape(id)}"]`);
      if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    });
  }

  // =============================================================== panel

  // el: the card that was clicked (a person can have two cards)
  function select(id, keepInView = true, el = null) {
    selectedId = id;
    lastSelected = id;
    applySelection();
    renderPanel();
    if (keepInView) {
      const p = el ? { x: parseFloat(el.style.left), y: parseFloat(el.style.top) } : L.pos.get(id), r = safeRect();
      if (p) {
        const sx = p.x * cam.k + cam.x, sy = p.y * cam.k + cam.y;
        if (sx < r.x || sx + CARD_W * cam.k > r.x + r.w || sy < r.y || sy + CARD_H * cam.k > r.y + r.h) centreOn(p, cam.k);
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
    if (p.unknown) {
      const kids = childrenOf(id);
      $('#panelBody').innerHTML = `
        <div class="p-head"><h2 class="p-name">Parents unknown</h2></div>
        <p class="p-notes">This card links brothers and sisters whose parents aren’t in the tree yet. When you find out, click <em>Add their name</em> to make it a real person.</p>
        <div class="p-sec"><h4>Brothers &amp; sisters · ${kids.length}</h4><div class="chips">${kids.map(chip).join('')}</div></div>
        <div class="p-actions">
          <button class="btn primary wide" data-act="edit">Add their name</button>
          <button class="btn wide" data-act="add-child">+ Another brother or sister</button>
          <button class="btn ghost danger wide" data-act="delete">Unlink these siblings</button>
        </div>`;
      $('#panel').classList.add('open');
      $('#panel').setAttribute('aria-hidden', 'false');
      return;
    }
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
      ${sec('Parents', p.parents.filter((x) => !P(x).unknown))}
      ${p.parents.length && p.parents.every((x) => P(x).unknown) ? '<div class="p-sec"><h4>Parents</h4><div class="muted">Not known yet</div></div>' : ''}
      ${sec(p.spouses.length > 1 ? 'Spouses' : 'Spouse', p.spouses)}
      ${sec('Siblings', siblingsOf(id))}
      ${sec('Children', childrenOf(id))}
      <div class="p-actions">
        <button class="btn primary wide" data-act="edit">Edit details</button>
        <button class="btn" data-act="add-parent" ${p.parents.filter((x) => !P(x).unknown).length >= 2 ? 'disabled' : ''}>+ Parent</button>
        <button class="btn" data-act="add-spouse">+ Spouse</button>
        <button class="btn" data-act="add-sibling">+ Sibling</button>
        <button class="btn" data-act="add-child">+ Child</button>
        <button class="btn wide" data-act="relate">${meId && meId !== id && P(meId) ? `How is ${esc(p.name.split(' ')[0])} related to me?` : 'Check a relationship'}</button>
        ${childrenOf(id).length ? `<button class="btn wide" data-act="scope">Show only this family</button>` : ''}
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
      case 'add-sibling': openEditor(null, { parents: [...p.parents] }, { siblingOf: id }); break;
      case 'add-parent': openEditor(null, { spouses: p.parents.filter((x) => !P(x).unknown).slice(0, 1) }, { childOf: id }); break;
      case 'scope': setScope(id); break;
      case 'relate': openRelations(meId && meId !== id && P(meId) ? meId : null, id); break;
      case 'delete': deletePerson(id); break;
    }
  });

  function deletePerson(id) {
    if (!canEdit()) return;
    const p = P(id);
    const n = childrenOf(id).length;
    if (!p.unknown && !confirm(`Delete ${p.name}?` + (n ? `\n\nTheir ${n} child(ren) stay in the tree, just without this parent.` : ''))) return;
    remember(`delete ${p.name}`);
    delete state.people[id];
    for (const o of all()) {
      o.parents = o.parents.filter((x) => x !== id);
      o.spouses = o.spouses.filter((x) => x !== id);
    }
    cleanupUnknown();
    collapsed.delete(id);
    closePanel();
    save(); saveUI(); render();
    toast(p.unknown ? 'Unlinked those siblings' : `Deleted ${p.name}`);
  }

  // ============================================================== search

  function searchPeople(q, limit = 12) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const p of realPeople()) {
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

  function makePicker(el, { max = Infinity, placeholder = 'Type a name to link…', onChange = null }) {
    let value = [], exclude = new Set();
    el.innerHTML = `<div class="pk-chips chips"></div><div class="pk-wrap"><input class="pk-input" placeholder="${esc(placeholder)}"><div class="pk-list"></div></div>`;
    const chipsEl = $('.pk-chips', el), wrap = $('.pk-wrap', el), input = $('.pk-input', el), list = $('.pk-list', el);
    let idx = 0;
    const draw = () => {
      chipsEl.innerHTML = value.map((id) => `<span class="chip">${avatar(P(id), 'sm')}${esc(P(id).name)}<button type="button" class="rm" data-rm="${esc(id)}" aria-label="Remove">✕</button></span>`).join('');
      wrap.hidden = value.length >= max;
      onChange?.([...value]);
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
  const siblingsPicker = makePicker($('#siblingsPicker'), { placeholder: 'Type a brother’s or sister’s name…' });
  let editing = null;

  function drawPhoto() {
    const el = $('#photoPreview');
    el.className = `av xl ${F('gender').value}`;
    el.style.backgroundImage = editing.photo ? `url('${editing.photo}')` : '';
    el.textContent = editing.photo ? '' : 'No photo';
  }

  function openEditor(id, preset = {}, extra = {}) {
    if (!canEdit()) return;
    const base = id ? P(id) : blankPerson(preset);
    editing = { id: base.id, isNew: !id, childOf: extra.childOf || null, photo: base.photo, oldSibs: id ? siblingsOf(id) : [] };
    $('#editTitle').textContent = base.unknown ? 'Add the parent’s name' : id ? `Edit ${base.name}` : 'Add person';
    const fields = { fullName: base.name, nickname: base.nickname, gender: base.gender, birthYear: base.birthYear, deathYear: base.deathYear, order: base.order, location: base.location, phone: base.phone, notes: base.notes };
    for (const [k, v] of Object.entries(fields)) F(k).value = v ?? '';
    F('deceased').checked = !!base.deceased;
    // Placeholder names: clear the field but show the old name as a hint.
    if (id && (isPlaceholder(base) || base.unknown)) { F('fullName').value = ''; F('fullName').placeholder = base.name; } else F('fullName').placeholder = '';
    // Can't be your own parent/spouse, and a child can't be your parent.
    const descendants = new Set();
    const walk = (x) => childrenOf(x).forEach((c) => { if (!descendants.has(c)) { descendants.add(c); walk(c); } });
    if (id) walk(id);
    parentsPicker.set(base.parents, [base.id, ...descendants]);
    spousePicker.set(base.spouses, [base.id]);
    siblingsPicker.set(id ? editing.oldSibs : extra.siblingOf ? [extra.siblingOf] : [], [base.id, ...descendants]);
    $('#siblingsField').hidden = !!base.unknown;
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
      unknown: !!old?.unknown && !F('fullName').value.trim(),
    };
    remember(old ? `edit ${old.name}` : `add ${name}`);
    for (const s of old?.spouses || []) if (!d.spouses.includes(s) && P(s)) P(s).spouses = P(s).spouses.filter((x) => x !== id);
    state.people[id] = d;
    for (const s of d.spouses) if (P(s) && !P(s).spouses.includes(id)) P(s).spouses.push(id);
    if (editing.childOf && P(editing.childOf)) {
      const c = P(editing.childOf);
      const standIns = c.parents.filter((x) => P(x).unknown);
      if (standIns.length && !c.parents.includes(id)) {
        // The new parent replaces "Parents unknown" for every sibling it linked.
        for (const k of all()) if (k.parents.some((x) => standIns.includes(x))) k.parents = [...k.parents.filter((x) => !standIns.includes(x)), id].slice(0, 2);
      } else if (!c.parents.includes(id) && c.parents.length < 2) c.parents.push(id);
    }
    // Brothers and sisters: removing one only works through stand-in parents.
    const sibs = d.unknown ? [] : siblingsPicker.get();
    const problems = [];
    for (const s of editing.oldSibs) {
      if (sibs.includes(s) || !P(s)) continue;
      const shared = d.parents.filter((x) => P(s).parents.includes(x));
      if (shared.length && shared.every((x) => P(x).unknown)) d.parents = d.parents.filter((x) => !shared.includes(x));
      else problems.push(`${P(s).name} shares real parents with ${name}. Change the parents to separate them.`);
    }
    for (const s of sibs) { const err = linkSiblings(id, s); if (err) problems.push(err); }
    cleanupUnknown();
    if (problems.length) setTimeout(() => toast(problems[0]), 2700);
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

  // ======================================================= relationships
  //
  // How is B related to A, and what does A call B in Hindi and Odia?
  // Blood relations come from the nearest common ancestor; in-laws from one
  // marriage step at either end. Terms are the common forms of address;
  // families differ, so any term can be changed and the change is kept.

  const G = (id) => (P(id).gender === 'male' ? 'm' : P(id).gender === 'female' ? 'f' : '');
  // Is x older than y? true / false / null when we can't tell.
  function older(x, y) {
    const X = P(x), Y = P(y);
    const shareParent = X.parents.some((p) => Y.parents.includes(p));
    if (shareParent && X.order && Y.order && +X.order !== +Y.order) return +X.order < +Y.order;
    if (X.birthYear && Y.birthYear && +X.birthYear !== +Y.birthYear) return +X.birthYear < +Y.birthYear;
    return null;
  }
  // [hindi, odia] by gender of the person being named
  const byG = (id, m, f) => { const g = G(id); if (g === 'm') return m; if (g === 'f') return f; return [`${m[0]} / ${f[0]}`, m[1] && f[1] ? `${m[1]} / ${f[1]}` : null]; };
  // Pick a term by who is older; when birth order/years are missing, show both with the condition.
  const byAgeOf = (o, ifOlder, ifYounger, subject, ref) => {
    if (o === true) return ifOlder;
    if (o === false) return ifYounger;
    const cond = `if ${P(subject).name.split(' ')[0]} is older than ${P(ref).name.split(' ')[0]}`;
    return [`${ifOlder[0]} (${cond}), else ${ifYounger[0]}`, ifOlder[1] && ifYounger[1] ? `${ifOlder[1]} (${cond}), else ${ifYounger[1]}` : null];
  };

  const pw = (id) => ({ m: 'father', f: 'mother' }[G(id)] || 'parent');
  const cw = (id) => ({ m: 'son', f: 'daughter' }[G(id)] || 'child');
  const sw = (id) => ({ m: 'husband', f: 'wife' }[G(id)] || 'spouse');
  function sibw(id, other) {
    const o = older(id, other);
    return (o === true ? 'elder ' : o === false ? 'younger ' : '') + ({ m: 'brother', f: 'sister' }[G(id)] || 'sibling');
  }

  function ancestry(id) {
    const m = new Map([[id, { d: 0, next: null }]]);
    const q = [id];
    while (q.length) {
      const x = q.shift();
      for (const p of P(x).parents) if (!m.has(p)) { m.set(p, { d: m.get(x).d + 1, next: x }); q.push(p); }
    }
    return m;
  }
  // Blood link: chains [a … common ancestor] and [b … common ancestor]
  function blood(a, b) {
    const ma = ancestry(a), mb = ancestry(b);
    let best = null;
    for (const [x, v] of ma) if (mb.has(x) && (!best || v.d + mb.get(x).d < best.n)) best = { top: x, n: v.d + mb.get(x).d };
    if (!best) return null;
    const chain = (m) => { const c = [best.top]; let x = best.top; while (m.get(x).next) { x = m.get(x).next; c.unshift(x); } return c; };
    const ca = chain(ma), cb = chain(mb);
    return { ca, cb, k: ca.length - 1, j: cb.length - 1 };
  }

  function bloodPhrase({ ca, cb, k, j }) {
    const parts = [];
    if (j === 0) for (let i = 1; i <= k; i++) parts.push(pw(ca[i]));
    else if (k === 0) for (let i = j - 1; i >= 0; i--) parts.push(cw(cb[i]));
    else {
      for (let i = 1; i < k; i++) parts.push(pw(ca[i]));
      parts.push(sibw(cb[j - 1], ca[k - 1]));
      for (let i = j - 2; i >= 0; i--) parts.push(cw(cb[i]));
    }
    return parts.join("'s ");
  }

  // What a calls b, for a blood relative b. Returns [hindi, odia] (null = no common term).
  function bloodTerms(a, b, { ca, cb, k, j }) {
    const side = k >= 1 ? G(ca[1]) : '';
    const pat = side === 'm', mat = side === 'f';
    if (j === 0) {                                   // ancestors
      if (k === 1) return byG(b, ['Papa / Pitaji', 'Bapa'], ['Maa / Mummy', 'Maa / Bou']);
      if (k === 2) return pat ? byG(b, ['Dada ji', 'Jeje / Jejebapa'], ['Dadi ji', 'Jejemaa'])
        : mat ? byG(b, ['Nana ji', 'Aja'], ['Nani ji', 'Aai']) : byG(b, ['Dada ji / Nana ji', null], ['Dadi ji / Nani ji', null]);
      if (k === 3) return pat ? byG(b, ['Pardada ji', null], ['Pardadi ji', null]) : byG(b, ['Parnana ji', null], ['Parnani ji', null]);
      return [null, null];
    }
    if (k === 0) {                                   // descendants
      if (j === 1) return byG(b, ['by name (beta)', 'by name (pua)'], ['by name (beti)', 'by name (jhia)']);
      if (j === 2) return G(cb[1]) === 'f' ? byG(b, ['by name (naati)', 'by name (nati)'], ['by name (naatin)', 'by name (natuni)'])
        : byG(b, ['by name (pota)', 'by name (nati)'], ['by name (poti)', 'by name (natuni)']);
      return ['by name', 'by name'];
    }
    if (k === j) {                                   // siblings and cousins
      const o = older(b, a);
      return byG(b,
        byAgeOf(o, ['Bhaiya', 'Bhai / Bhaina'], ['by name (chhota bhai)', 'by name (sana bhai)'], b, a),
        byAgeOf(o, ['Didi', 'Apa / Nani'], ['by name (chhoti behen)', 'by name (sana bhauni)'], b, a));
    }
    if (k === j + 1) {                               // uncles and aunts (incl. parents' cousins)
      const parent = ca[1];
      if (pat) return byG(b, byAgeOf(older(b, parent), ['Tau ji / Taya ji', 'Bada Bapa'], ['Chacha ji', 'Dada'], b, parent), ['Bua ji', 'Piusi']);
      if (mat) return byG(b, ['Mama ji', 'Mamu'], ['Mausi', 'Mausi']);
      return [null, null];
    }
    if (k === j + 2) {                               // grandparents' siblings and cousins
      return pat ? byG(b, ['Dada ji', 'Jeje'], ['Dadi ji', 'Jejemaa']) : mat ? byG(b, ['Nana ji', 'Aja'], ['Nani ji', 'Aai']) : [null, null];
    }
    if (j === k + 1) {                               // nephews and nieces
      return G(cb[1]) === 'f' ? byG(b, ['by name (bhanja)', 'by name (bhanaja)'], ['by name (bhanji)', 'by name (bhanaji)'])
        : byG(b, ['by name (bhatija)', 'by name (bhatija)'], ['by name (bhatiji)', 'by name (bhatiji)']);
    }
    if (j > k) return ['by name', 'by name'];
    return [null, null];
  }

  // b is married to x, who is a's blood relative
  function spouseOfBloodTerms(a, b, x, bl) {
    const { ca, k, j } = bl;
    const side = k >= 1 ? G(ca[1]) : '';
    if (j === 0 && k === 1) return byG(b, ['Papa / Pitaji', 'Bapa'], ['Maa / Mummy', 'Maa / Bou']);
    if (j === 0 && k === 2) return side === 'm' ? byG(b, ['Dada ji', 'Jeje'], ['Dadi ji', 'Jejemaa']) : byG(b, ['Nana ji', 'Aja'], ['Nani ji', 'Aai']);
    if (k === j + 1) {
      const parent = ca[1];
      if (side === 'm' && G(x) === 'm') return byAgeOf(older(x, parent), ['Tai ji', 'Bada Maa'], ['Chachi ji', 'Khudi'], x, parent);
      if (side === 'm' && G(x) === 'f') return ['Fufa ji', 'Piusa'];
      if (side === 'f' && G(x) === 'm') return ['Mami ji', 'Maain'];
      if (side === 'f' && G(x) === 'f') return ['Mausa ji', 'Mausa'];
    }
    if (k === j + 2) return side === 'm' ? byG(b, ['Dada ji', 'Jeje'], ['Dadi ji', 'Jejemaa']) : byG(b, ['Nana ji', 'Aja'], ['Nani ji', 'Aai']);
    if (k === j && k >= 1) {
      const o = older(x, a);
      if (G(x) === 'm') return o === false ? ['by name (bhai ki patni)', 'by name (bhai bohu)'] : ['Bhabhi', 'Bhauja'];
      if (G(x) === 'f') return ['Jija ji', 'Bhinoi'];
    }
    if (k === 0 && j === 1) return G(x) === 'm' ? ['by name (bahu)', 'by name (bohu)'] : ['Damad ji / Jamai ji', 'Juain'];
    if (j > k) return ['by name', 'by name'];
    return [null, null];
  }

  // b is a blood relative of a's spouse s
  function spousesRelativeTerms(a, b, s, bl) {
    const { k, j } = bl;
    if (k === 1 && j === 0) return byG(b, ['Papa ji (sasur ji)', 'Bapa (shwashura)'], ['Mummy ji (saas ji)', 'Maa (shashu)']);
    if (k === 1 && j === 1) {
      const o = older(b, s);
      if (G(a) === 'f' || G(s) === 'm') {            // husband's siblings
        return byG(b, byAgeOf(o, ['Bhaiya (jeth ji)', 'Bhai (bhashura)'], ['by name (devar)', 'by name (diara)'], b, s),
          byAgeOf(o, ['Didi (nanad)', 'Apa (nanada)'], ['by name (nanad)', 'by name (nanada)'], b, s));
      }
      return byG(b, byAgeOf(o, ['Bhaiya (saala)', 'Bhai (shala)'], ['by name (saala)', 'by name (shala)'], b, s),
        byAgeOf(o, ['Didi (saali)', 'Apa (shali)'], ['by name (saali)', 'by name (shali)'], b, s));
    }
    return null;   // otherwise: whatever the spouse calls them
  }

  // Full answer: { phrase, hi, or, via } — phrase completes "b is a's ___".
  function relate(a, b, depth = 0) {
    if (a === b) return { phrase: 'the same person', hi: null, or: null };
    const A = P(a), B = P(b);
    if (A.spouses.includes(b)) return { phrase: sw(b), hi: 'by name', or: 'by name' };
    const bl = blood(a, b);
    if (bl) return { phrase: bloodPhrase(bl), ...pair(bloodTerms(a, b, bl)), n: bl.k + bl.j, role: roleOfBlood(a, b, bl), blood: true };

    let best = null;
    for (const x of B.spouses) {                      // spouse of a blood relative
      const r = blood(a, x);
      if (r && (!best || r.k + r.j < best.n)) best = { n: r.k + r.j + 1, kind: 'sp', x, r };
    }
    for (const s of A.spouses) {                      // blood relative of a's spouse
      const r = blood(s, b);
      if (r && (!best || r.k + r.j + 1 < best.n)) best = { n: r.k + r.j + 1, kind: 'in', x: s, r };
    }
    if (best?.kind === 'sp') {
      const xr = roleOfBlood(a, best.x, best.r);
      return { phrase: `${bloodPhrase(best.r)}'s ${sw(b)}`, ...pair(spouseOfBloodTerms(a, b, best.x, best.r)), n: best.n, role: { ...xr, g: G(b), married: !xr.married } };
    }
    if (best?.kind === 'in') {
      const s = best.x;
      const t = spousesRelativeTerms(a, b, s, best.r);
      const phrase = `${sw(s)}'s ${bloodPhrase(best.r)}`;
      if (t) return { phrase, ...pair(t), n: best.n, role: { gen: best.r.k - best.r.j, side: 's', g: G(b), married: false, age: '' } };
      const via = relate(s, b, depth + 1);
      return { phrase, hi: via.hi, or: via.or, via: P(s).name, n: best.n };
    }
    if (depth < 1) {                                  // spouse's relative's spouse, etc.
      for (const s of A.spouses) {
        const r = relate(s, b, depth + 1);
        if (r.phrase && !r.none) return { phrase: `${sw(s)}'s ${r.phrase}`, hi: r.hi, or: r.or, via: P(s).name, n: (r.n || 9) + 1 };
      }
    }
    return { phrase: null, none: true };
  }
  const pair = ([hi, or]) => ({ hi, or });

  // ---- naming relatives of relatives
  //
  // Families name people who aren't directly related through a common link:
  // Bada Mama's brothers are Mamus too, his wife is Maain, her sister is a
  // Mausi, their children are Bhai and Apa. A "role" captures the position
  // someone holds for you:
  //   gen     generations above you (1 = your parents' level, 0 = yours)
  //   side    'p' father's side, 'm' mother's side, 's' spouse's side, '' unknown
  //   g       'm' | 'f' | ''
  //   married they married into that position (Chachi, Mami, Fufa, Mausa, Bhabhi, Jija)
  //   age     'e' elder / 'y' younger: than you at your level, than your parent at theirs

  const ageOf = (o) => (o === true ? 'e' : o === false ? 'y' : '');
  function roleOfBlood(a, b, { ca, k, j }) {
    const gen = k - j;
    return {
      gen, g: G(b), married: false,
      side: gen >= 1 && k >= 1 ? ({ m: 'p', f: 'm' }[G(ca[1])] || '') : '',
      age: gen === 0 ? ageOf(older(b, a)) : gen === 1 && k >= 2 ? ageOf(older(b, ca[1])) : '',
    };
  }

  // What you call someone, from their role.
  function termsFromRole(r) {
    const both = (m, f) => (r.g === 'm' ? m : r.g === 'f' ? f : [`${m[0]} / ${f[0]}`, m[1] && f[1] ? `${m[1]} / ${f[1]}` : null]);
    const byAge = (e, y) => (r.age === 'e' ? e : r.age === 'y' ? y : [`${e[0]} (if elder) or ${y[0]}`, `${e[1]} (if elder) or ${y[1]}`]);
    const side = r.side === 's' ? 'p' : r.side;
    if (r.gen >= 3) return both(['Pardada ji / Parnana ji', null], ['Pardadi ji / Parnani ji', null]);
    if (r.gen === 2) {
      if (side === 'p') return both(['Dada ji', 'Jeje'], ['Dadi ji', 'Jejemaa']);
      if (side === 'm') return both(['Nana ji', 'Aja'], ['Nani ji', 'Aai']);
      return both(['Dada ji / Nana ji', 'Jeje / Aja'], ['Dadi ji / Nani ji', 'Jejemaa / Aai']);
    }
    if (r.gen === 1) {
      if (side === 'p') {
        if (r.married) return both(['Fufa ji', 'Piusa'], byAge(['Tai ji', 'Bada Maa'], ['Chachi ji', 'Khudi']));
        return both(byAge(['Tau ji', 'Bada Bapa'], ['Chacha ji', 'Dada']), ['Bua ji', 'Piusi']);
      }
      if (side === 'm') return r.married ? both(['Mausa ji', 'Mausa'], ['Mami ji', 'Maain']) : both(['Mama ji', 'Mamu'], ['Mausi', 'Mausi']);
      return both(['Chacha ji / Mama ji (depends on the side)', 'Dada / Mamu'], ['Chachi ji / Mausi (depends on the side)', 'Khudi / Mausi']);
    }
    if (r.gen === 0) {
      if (r.married) return both(['Jija ji', 'Bhinoi'], ['Bhabhi', 'Bhauja']);
      return both(r.age === 'y' ? ['by name', 'by name'] : r.age === 'e' ? ['Bhaiya', 'Bhai / Bhaina'] : ['Bhaiya (if elder), else by name', 'Bhai (if elder), else by name'],
        r.age === 'y' ? ['by name', 'by name'] : r.age === 'e' ? ['Didi', 'Apa / Nani'] : ['Didi (if elder), else by name', 'Apa (if elder), else by name']);
    }
    return ['by name', 'by name'];
  }

  // Read a role back from a term, so family-edited names (e.g. "Bada Mama") drive the naming.
  const TERM_ROLES = [
    // [pattern, lang, role]
    [/\bpar(dada|dadi|nana|nani)\b/, 'hi', (m) => ({ gen: 3, side: m[1].startsWith('d') ? 'p' : 'm', g: m[1].endsWith('i') ? 'f' : 'm' })],
    [/\bdadi\b/, 'hi', { gen: 2, side: 'p', g: 'f' }], [/\bdada\b/, 'hi', { gen: 2, side: 'p', g: 'm' }],
    [/\bnani\b/, 'hi', { gen: 2, side: 'm', g: 'f' }], [/\bnana\b/, 'hi', { gen: 2, side: 'm', g: 'm' }],
    [/\bjejema+\b/, 'or', { gen: 2, side: 'p', g: 'f' }], [/\bjeje(bapa)?\b/, 'or', { gen: 2, side: 'p', g: 'm' }],
    [/\baai\b/, 'or', { gen: 2, side: 'm', g: 'f' }], [/\baja\b/, 'or', { gen: 2, side: 'm', g: 'm' }],
    [/\b(tau|taya|bade papa|bada ?bapa)\b/, '*', { gen: 1, side: 'p', g: 'm', age: 'e' }],
    [/\b(tai|badi ma+|bada ?ma+)\b/, '*', { gen: 1, side: 'p', g: 'f', married: true, age: 'e' }],
    [/\b(chachi|kaki|khudi|khuri)\b/, '*', { gen: 1, side: 'p', g: 'f', married: true, age: 'y' }],
    [/\b(chacha|chachu|kaka)\b/, '*', { gen: 1, side: 'p', g: 'm', age: 'y' }],
    [/\bdada\b/, 'or', { gen: 1, side: 'p', g: 'm', age: 'y' }],
    [/\b(bua|buaa|phua|piusi|pishi)\b/, '*', { gen: 1, side: 'p', g: 'f' }],
    [/\b(fufa|phupha|piusa|pisa)\b/, '*', { gen: 1, side: 'p', g: 'm', married: true }],
    [/\b(mami|maain|main|mai)\b/, '*', { gen: 1, side: 'm', g: 'f', married: true }],
    [/\b(mama|mamu|mamoo)\b/, '*', { gen: 1, side: 'm', g: 'm' }],
    [/\b(mausa|mousa|masa)\b/, '*', { gen: 1, side: 'm', g: 'm', married: true }],
    [/\b(mausi|mousi|masi)\b/, '*', { gen: 1, side: 'm', g: 'f' }],
    [/\b(bhabhi|bhauja|bhouja)\b/, '*', { gen: 0, g: 'f', married: true, age: 'e' }],
    [/\b(jija|jiju|bhinoi)\b/, '*', { gen: 0, g: 'm', married: true, age: 'e' }],
    [/\b(bhaiya|bhaina|bhai)\b/, '*', { gen: 0, g: 'm', age: 'e' }],
    [/\b(didi|apa|nani)\b/, 'or', { gen: 0, g: 'f', age: 'e' }],
    [/\bdidi\b/, 'hi', { gen: 0, g: 'f', age: 'e' }],
  ];
  function roleFromTerms(hi, or) {
    for (const [lang, text] of [['hi', hi], ['or', or]]) {
      const t = String(text || '').toLowerCase();
      if (!t || t.startsWith('by name')) continue;
      for (const [re, l, role] of TERM_ROLES) {
        if (l !== '*' && l !== lang) continue;
        const m = t.match(re);
        if (m) return { side: '', married: false, age: '', ...(typeof role === 'function' ? role(m) : role) };
      }
    }
    return null;
  }

  // One step along the family from someone with role r to their relative `to`.
  function stepRole(r, type, to, a) {
    const g = G(to);
    if (type === 'spouse') return { ...r, g, married: !r.married };
    if (type === 'sibling') {
      // A married-in person's brothers and sisters are named the way that
      // person's own children name them (Chachi's brother → Mama).
      if (r.married) return { gen: r.gen, side: r.g === 'f' ? 'm' : 'p', g, married: false, age: '' };
      return { ...r, g, age: r.gen === 0 ? ageOf(older(to, a)) : '' };
    }
    if (type === 'child') return { gen: r.gen - 1, side: r.gen - 1 >= 1 ? r.side : '', g, married: false, age: r.gen - 1 === 0 ? ageOf(older(to, a)) : '' };
    if (type === 'parent') return { gen: r.gen + 1, side: r.gen >= 1 ? r.side : '', g, married: false, age: '' };
    return r;
  }

  // Shortest path a → b over parent / child / spouse links, with "parent then
  // their other child" folded into a sibling step.
  function kinPath(a, b) {
    const kidsOf = new Map();
    for (const p of all()) for (const x of p.parents) { if (!kidsOf.has(x)) kidsOf.set(x, []); kidsOf.get(x).push(p.id); }
    const prev = new Map([[a, null]]);
    const q = [a];
    while (q.length) {
      const x = q.shift();
      if (x === b) break;
      const p = P(x);
      const nb = [...p.parents.map((y) => ['parent', y]), ...(kidsOf.get(x) || []).map((y) => ['child', y]), ...p.spouses.map((y) => ['spouse', y])];
      for (const [t, y] of nb) if (!prev.has(y)) { prev.set(y, { from: x, t }); q.push(y); }
    }
    if (!prev.has(b)) return null;
    const raw = [];
    for (let c = b; c !== a;) { const s = prev.get(c); raw.unshift({ t: s.t, from: s.from, to: c }); c = s.from; }
    const steps = [];
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i], n = raw[i + 1];
      if (s.t === 'parent' && n && n.t === 'child' && n.to !== s.from) { steps.push({ t: 'sibling', from: s.from, to: n.to }); i++; }
      else steps.push(s);
    }
    return steps;
  }
  const stepWord = (s) => (s.t === 'parent' ? pw(s.to) : s.t === 'child' ? cw(s.to) : s.t === 'spouse' ? sw(s.to) : sibw(s.to, s.from));

  // Name someone through the nearest relative on the way whom you already have a name for.
  // customOnly: use only a link whose name the family has edited (e.g. "Bada Mama").
  // sameGenOnly: accept the link only if b is its brother, sister or spouse (or theirs).
  function relateThroughLink(a, b, customOnly = false, sameGenOnly = false) {
    const steps = kinPath(a, b);
    if (!steps || !steps.length) return null;
    const phrase = steps.filter((s) => !P(s.to).unknown || s === steps[steps.length - 1]).map(stepWord).join("'s ");
    for (let i = steps.length - 2; i >= 0; i--) {
      const x = steps[i].to;
      if (P(x).unknown) continue;
      const r = termsFor(a, x, false);
      if (r.none || (customOnly && !r.custom)) continue;
      if (sameGenOnly && steps.slice(i + 1).some((s) => s.t === 'parent' || s.t === 'child')) continue;
      let role = (r.custom && roleFromTerms(r.hi, r.or)) || r.role || roleFromTerms(r.hi, r.or);
      if (!role) continue;
      for (const s of steps.slice(i + 1)) role = stepRole(role, s.t, s.to, a);
      const rest = steps.slice(i + 1).map(stepWord).join("'s ");
      const linkTerm = [r.hi, r.or].filter((t) => t && !t.startsWith('by name'))[0];
      return {
        phrase, ...pair(termsFromRole(role)), role, n: steps.length + 5, derived: true,
        link: { id: x, term: linkTerm || null, rest },
      };
    }
    return customOnly ? null : { phrase, hi: null, or: null, n: steps.length + 5, derived: true };
  }

  // Family-specific corrections, keyed by the English relationship.
  // Edits are kept per pair of people ("a>b") or for everyone in a position (the English phrase).
  function customTerm(a, b, phrase) {
    return state.terms?.[`${a}>${b}`] || (phrase && state.terms?.[phrase.toLowerCase()]) || null;
  }
  // Someone's brothers, sisters and spouses (and theirs) share the name you use for
  // any of them: if you call one of them "Bada Mama", the others follow from it.
  function nearbyCustom(a, b) {
    const seen = new Map([[b, null]]);
    let frontier = [b];
    for (let d = 0; d < 2; d++) {
      const next = [];
      for (const y of frontier) {
        for (const [t, z] of [...siblingsOf(y).map((z) => ['sibling', z]), ...P(y).spouses.map((z) => ['spouse', z])]) {
          if (seen.has(z) || z === a || P(z).unknown) continue;
          seen.set(z, { from: y, t });
          next.push(z);
          const o = customTerm(a, z, relate(a, z).phrase);
          const role0 = o && roleFromTerms(o.hi, o.or);
          if (!role0) continue;
          let role = role0, cur = z;
          const words = [];
          while (cur !== b) {
            const st = seen.get(cur);
            role = stepRole(role, st.t, st.from, a);
            words.push(st.t === 'spouse' ? sw(st.from) : sibw(st.from, cur));
            cur = st.from;
          }
          return { role, link: { id: z, term: o.hi || o.or, rest: words.join("'s ") } };
        }
      }
      frontier = next;
    }
    return null;
  }

  function termsFor(a, b, viaLinks = true) {
    let r = relate(a, b);
    let o = customTerm(a, b, r.phrase);
    const near = !o && viaLinks && a !== b && nearbyCustom(a, b);
    if (near) {
      const phrase = r.phrase || kinPath(a, b)?.map(stepWord).join("'s ") || null;
      r = { ...r, phrase, none: false, ...pair(termsFromRole(near.role)), role: near.role, link: near.link, derived: true };
    } else if (!o && viaLinks && a !== b) {
      // A family-edited name on the way wins (Bada Mama → his brothers are Mamus, his wife is Maain).
      // For blood relatives only across the same generation; a generation away the family structure decides.
      const viaCustom = relateThroughLink(a, b, true, !!r.blood);
      if (viaCustom) r = viaCustom;
      else if (r.none) r = relateThroughLink(a, b) || r;
      o = customTerm(a, b, r.phrase);
    }
    return { ...r, hi: o?.hi ?? r.hi, or: o?.or ?? r.or, custom: !!o };
  }


  // ------------------------------------------------ relationship checker UI

  const relDlg = $('#relDialog');
  let relPair = [null, null];
  const relA = makePicker($('#relA'), { max: 1, placeholder: 'Type a name…', onChange: (v) => { relPair[0] = v[0] || null; drawRelations(); } });
  const relB = makePicker($('#relB'), { max: 1, placeholder: 'Type a name…', onChange: (v) => { relPair[1] = v[0] || null; drawRelations(); } });

  function openRelations(a = meId, b = null) {
    if (a && !P(a)) a = null;
    relPair = [a, b];
    relA.set(a ? [a] : [], []);
    relB.set(b ? [b] : [], []);
    drawRelations();
    if (!relDlg.open) relDlg.showModal();
    const empty = $$('.pk-wrap:not([hidden]) .pk-input', relDlg)[0];
    empty?.focus();
  }

  const termCell = (t) => (t ? esc(t) : '<span class="muted">no common term</span>');
  function termBox(a, b) {
    const r = termsFor(a, b);
    if (r.none) return '';
    return `<div class="rel-card">
      <div class="rc-h"><b>${esc(P(a).name)}</b> calls <b>${esc(P(b).name)}</b></div>
      <div class="rc-terms">
        <div><span class="lang">Hindi</span><span class="term">${termCell(r.hi)}</span></div>
        <div><span class="lang">Odia</span><span class="term">${termCell(r.or)}</span></div>
      </div>
      ${r.via ? `<div class="rc-via">The same as ${esc(r.via)} calls them.</div>` : ''}
      ${r.link ? `<div class="rc-via">Named through ${esc(P(r.link.id).name)}${r.link.term && r.link.term !== P(r.link.id).name ? ` (${esc(r.link.term)})` : ''}.</div>` : ''}
      <button type="button" class="link" data-edit-term="${esc(r.phrase)}" data-a="${esc(a)}" data-b="${esc(b)}" data-hi="${esc(r.hi || '')}" data-or="${esc(r.or || '')}">Edit${r.custom ? ' (edited)' : ''}</button>
    </div>`;
  }

  function drawRelations() {
    const [a, b] = relPair;
    $('#relMe').checked = !!a && a === meId;
    let html = '';
    if (a && b) {
      const r = termsFor(a, b);
      if (r.none) html = `<div class="rel-sentence">No link was found between <b>${esc(P(a).name)}</b> and <b>${esc(P(b).name)}</b>. Add the missing parents or spouses to connect them.</div>`;
      else if (a === b) html = `<div class="rel-sentence">That’s the same person.</div>`;
      else html = `<div class="rel-sentence"><b>${esc(P(b).name)}</b> is <b>${esc(P(a).name)}</b>’s <em>${esc(r.phrase)}</em>.</div>
        ${r.link ? `<p class="rel-link">${r.blood ? 'Named the same way as' : 'Not a direct relation, so they’re named through the common link,'} <b>${esc(P(r.link.id).name)}</b>${r.link.term ? `, whom ${esc(P(a).name.split(' ')[0])} calls <em>${esc(r.link.term)}</em>` : ''}. ${esc(P(b).name)} is ${esc(P(r.link.id).name)}’s ${esc(r.link.rest)}.</p>` : ''}
        <div class="rel-cards">${termBox(a, b)}${termBox(b, a)}</div>`;
    }
    $('#relResult').innerHTML = html;

    // Everyone, as related to the first person
    if (a) {
      const rows = realPeople().filter((p) => p.id !== a).map((p) => ({ p, r: termsFor(a, p.id) })).filter((x) => !x.r.none)
        .sort((x, y) => (x.r.n ?? 99) - (y.r.n ?? 99) || x.p.name.localeCompare(y.p.name));
      $('#relAll').innerHTML = `<div class="rel-all-head"><h3>Everyone, as related to ${esc(P(a).name)}</h3>
          <input class="pk-input" id="relFilter" placeholder="Filter…"></div>
        <div class="rel-table" role="table">
          <div class="rt-row rt-head" role="row"><span>Name</span><span>Relation</span><span>Hindi</span><span>Odia</span></div>
          ${rows.map(({ p, r }) => `<div class="rt-row" role="row" data-rel-b="${esc(p.id)}" data-q="${esc((p.name + ' ' + (p.nickname || '') + ' ' + r.phrase + ' ' + (r.hi || '') + ' ' + (r.or || '')).toLowerCase())}">
            <span class="rt-name">${avatar(p, 'sm')}${esc(p.name)}</span><span class="rt-rel">${esc(r.phrase)}</span><span>${termCell(r.hi)}</span><span>${termCell(r.or)}</span></div>`).join('')}
        </div>`;
      $('#relFilter').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        $$('.rt-row[data-q]', relDlg).forEach((row) => { row.hidden = !!q && !row.dataset.q.includes(q); });
      });
    } else $('#relAll').innerHTML = '';
  }

  $('#relBtn').onclick = () => openRelations(meId, null);
  $('#relClose').onclick = () => relDlg.close();
  $('#relSwap').onclick = () => openRelations(relPair[1], relPair[0]);
  $('#relMe').addEventListener('change', (e) => {
    if (e.target.checked && relPair[0]) meId = relPair[0];
    else if (!e.target.checked && meId === relPair[0]) meId = null;
    saveUI();
    if (selectedId) renderPanel();
  });
  relDlg.addEventListener('click', (e) => {
    if (e.target === relDlg) { relDlg.close(); return; }          // click on the backdrop
    const row = e.target.closest('[data-rel-b]');
    if (row) { openRelations(relPair[0], row.dataset.relB); relDlg.scrollTop = 0; return; }
    const ed = e.target.closest('[data-edit-term]');
    if (ed && canEdit()) {
      const { a, b } = ed.dataset;
      const who = `${P(a).name.split(' ')[0]} calls ${P(b).name}`;
      const hi = prompt(`What ${who} in Hindi:`, ed.dataset.hi);
      if (hi === null) return;
      const or = prompt(`What ${who} in Odia:`, ed.dataset.or);
      if (or === null) return;
      const everyone = confirm(`Use this for everyone who is ${P(a).name.split(' ')[0]}’s “${ed.dataset.editTerm}”?\n\nOK: everyone in that position\nCancel: only ${P(b).name}`);
      const key = everyone ? ed.dataset.editTerm.toLowerCase() : `${a}>${b}`;
      remember(`edit term “${ed.dataset.editTerm}”`);
      state.terms = state.terms || {};
      if (!hi.trim() && !or.trim()) { delete state.terms[key]; delete state.terms[`${a}>${b}`]; }
      else state.terms[key] = { hi: hi.trim() || null, or: or.trim() || null };
      save(); updateUndoButtons(); drawRelations();
      toast(everyone ? `Saved for every “${ed.dataset.editTerm}”` : `Saved for ${P(b).name}`);
    }
  });

  // ============================================================ sharing
  //
  // The family can view one shared tree; only its owner edits it. The tree
  // is stored by the site's API (api/tree.js, Vercel Blob). The family
  // passcode is stretched with PBKDF2 into the tree's id, its only address;
  // saving also needs the editor password, which the server checks. Invite
  // links carry the passcode after '#', which browsers never send to servers.

  const SHARE_KEY = 'familyTree.share';
  const POLL_MS = 30000;
  const sync = {
    status: 'local',          // local | connecting | live | error
    available: null,          // null = unknown, 'yes', 'no-storage', 'no-api'
    treeId: null, passcode: null, owner: null,   // owner = editor password, once accepted
    etag: null, version: 0, timer: null, pushTimer: null, pushing: null, dirty: false, offline: false, error: '',
  };
  const sharingSetUp = () => sync.available === 'yes';
  const canEdit = () => sync.status !== 'live' || !!sync.owner;

  function applyMode() {
    const ro = !canEdit();
    document.body.classList.toggle('readonly', ro);
    if (ro && dlg.open) dlg.close();
  }

  async function checkAvailable() {
    if (sync.available) return sync.available;
    try {
      const r = await fetch('api/tree?health=1', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      sync.available = j?.ok ? (j.storage ? 'yes' : 'no-storage') : 'no-api';
    } catch { sync.available = 'no-api'; }
    return sync.available;
  }

  async function deriveTreeId(passcode) {
    const norm = passcode.trim().toLowerCase().replace(/\s+/g, ' ');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(norm), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('family-tree:v1'), iterations: 150000, hash: 'SHA-256' }, key, 192);
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function getTree(conditional) {
    const r = await fetch(`api/tree?id=${sync.treeId}`, { cache: 'no-store', headers: conditional && sync.etag ? { 'If-None-Match': sync.etag } : {} });
    if (r.status === 404) return { notFound: true };
    if (r.status === 304) return { unchanged: true };
    if (!r.ok) throw new Error('HTTP ' + r.status);
    sync.etag = r.headers.get('ETag');
    return r.json();
  }
  async function postTree(body, id = sync.treeId) {
    const r = await fetch(`api/tree?id=${id}`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  }

  function setStatus(status, error = '') {
    sync.status = status;
    sync.error = error;
    const pill = $('#syncPill');
    const text = {
      local: sharingSetUp() ? 'Only on this device' : '',
      connecting: 'Connecting…',
      live: sync.offline ? 'Offline' : sync.owner ? 'Shared · you’re the editor' : 'Shared · view only',
      error: 'Sharing error',
    }[status];
    pill.hidden = !text;
    pill.dataset.status = status;
    pill.innerHTML = `<span class="dot"></span>${esc(text)}`;
    applyMode();
    if ($('#shareDialog').open) drawShare();
  }
  function setOffline(v) { if (sync.offline !== v) { sync.offline = v; setStatus(sync.status, sync.error); } }

  function remember_() {
    try { localStorage.setItem(SHARE_KEY, JSON.stringify({ passcode: sync.passcode, owner: sync.owner })); } catch { /* ignore */ }
  }

  // Open the tree for a passcode. Returns 'live', 'empty' (no tree uses it yet) or 'error'.
  async function connect(passcode, ownerPassword = null) {
    setStatus('connecting');
    try {
      sync.treeId = await deriveTreeId(passcode);
      sync.etag = null;
      const data = await getTree(false);
      if (data.notFound) { setStatus('local'); return 'empty'; }
      sync.passcode = passcode;
      sync.owner = null;
      if (ownerPassword) {
        const v = await postTree({ password: ownerPassword, verify: true });
        if (v.status === 200) sync.owner = ownerPassword;
      }
      startLive(data);
      return 'live';
    } catch (err) {
      console.error(err);
      setStatus('error', 'Could not reach the shared tree. Check your connection and try again.');
      return 'error';
    }
  }

  function startLive(data) {
    remember_();
    sync.status = 'live';
    applyRemote(data, true);
    setStatus('live');
    clearInterval(sync.timer);
    sync.timer = setInterval(poll, POLL_MS);
  }

  function stopLive() {
    clearInterval(sync.timer);
    Object.assign(sync, { timer: null, passcode: null, owner: null, etag: null, version: 0, dirty: false });
    try { localStorage.removeItem(SHARE_KEY); } catch { /* ignore */ }
    setStatus('local');
  }

  function applyRemote(data, first = false) {
    if (!first && data.version && data.version <= sync.version) return;
    sync.version = data.version || 0;
    const next = normalize({ people: data.people || {}, terms: data.terms || {} });
    if (JSON.stringify(next) !== JSON.stringify(state)) {
      state = next;
      if (!first) { undoStack.length = 0; redoStack.length = 0; }
      saveLocal();
      render();
      if (selectedId) P(selectedId) ? renderPanel() : closePanel();
      if (relDlg.open) drawRelations();
    }
    if (first) { if (firstVisit) goHome(false); else fit(false, readableZoom()); }
  }

  async function poll() {
    if (sync.status !== 'live' || document.hidden) return;
    if (sync.dirty) { await pushChanges(); return; }
    try {
      const data = await getTree(true);
      setOffline(false);
      if (data.unchanged || data.notFound || sync.dirty || sync.pushing) return;
      applyRemote(data);
    } catch { setOffline(true); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  addEventListener('online', () => poll());

  // The editor's changes are saved a moment after the last edit.
  function queuePush() {
    if (sync.status !== 'live' || !sync.owner) return;
    sync.dirty = true;
    clearTimeout(sync.pushTimer);
    sync.pushTimer = setTimeout(pushChanges, 800);
  }
  async function pushChanges() {
    if (!sync.dirty || !sync.owner) return true;
    if (sync.pushing) return sync.pushing;
    sync.pushing = (async () => {
      sync.dirty = false;
      try {
        const r = await postTree({ password: sync.owner, tree: { people: state.people, terms: state.terms || {} } });
        if (r.status === 403) {
          sync.owner = null; remember_(); setStatus('live');
          toast('Your editor password was not accepted, so this device is now view only.');
          return false;
        }
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        sync.version = r.version;
        sync.etag = null;
        setOffline(false);
        return true;
      } catch (err) {
        console.error(err);
        sync.dirty = true;
        setOffline(true);
        return false;
      } finally { sync.pushing = null; }
    })();
    return sync.pushing;
  }
  addEventListener('beforeunload', (e) => { if (sync.dirty || sync.pushing) { pushChanges(); e.preventDefault(); } });

  // First upload of this browser's tree: sets the family passcode and editor password.
  async function uploadAndShare(passcode, password) {
    setStatus('connecting');
    try {
      sync.treeId = await deriveTreeId(passcode);
      const r = await postTree({ password, tree: { people: state.people, terms: state.terms || {} } });
      if (r.status === 403) { setStatus('error', 'That passcode is already used by a tree with a different editor password.'); return false; }
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      sync.passcode = passcode;
      sync.owner = password;
      sync.etag = null;
      startLive(await getTree(false));
      return true;
    } catch (err) {
      console.error(err);
      setStatus('error', 'Upload failed. Check your connection and try again.');
      return false;
    }
  }

  // ------------------------------------------------------ share dialog

  const shareDlg = $('#shareDialog');
  let shareStep = null;      // null | { empty: passcode }

  const inviteLink = () => `${location.origin}${location.pathname}#join=${encodeURIComponent(sync.passcode)}`;
  const hasOwnData = () => realPeople().some((p) => !isPlaceholder(p));

  function drawShare() {
    const body = $('#shareBody');
    if (sync.available === 'no-api' || sync.available === 'no-storage') {
      body.innerHTML = sync.available === 'no-api'
        ? `<p>Sharing works on the Vercel version of this site. This copy can’t reach the family database.</p>
           <p class="muted">Until then, your tree lives only in this browser. Use ⋯ → Export backup to keep a copy, then Import backup on the Vercel site.</p>`
        : `<p>Almost there. The Vercel project needs its Blob store connected. The steps are in the README.</p>`;
      return;
    }
    if (sync.status === 'live') {
      const link = inviteLink();
      body.innerHTML = `<p class="share-live"><span class="dot"></span> ${sync.owner
        ? 'You’re the editor on this device. Your changes are saved for everyone.'
        : 'You’re viewing the family tree. Only its editor can make changes.'}</p>
        <div class="f">Invite link for family (view only)
          <div class="copy-row"><input class="pk-input" id="inviteLink" readonly value="${esc(link)}"><button class="btn" id="copyInvite">Copy</button></div>
        </div>
        <div class="share-actions">
          <a class="btn" href="https://wa.me/?text=${encodeURIComponent('Our family tree: ' + link)}" target="_blank" rel="noopener">Send on WhatsApp</a>
          <button class="btn ghost danger" id="leaveShare">Stop using the shared tree on this device</button>
        </div>
        ${sync.owner ? `<details class="change-code"><summary>Change the family passcode</summary>
          <p class="muted">Everyone will need the new invite link afterwards; the old link stops working.</p>
          <form id="changeForm" class="join-row">
            <input class="pk-input" id="newCode" type="password" autocomplete="off" placeholder="New family passcode, e.g. four random words">
            <button class="btn" type="submit">Change</button>
          </form></details>` : `<form id="unlockForm" class="join-row">
          <input class="pk-input" id="unlockCode" type="password" autocomplete="current-password" placeholder="Editor password (only if you’re the editor)">
          <button class="btn" type="submit">Unlock editing</button>
        </form>`}
        <p class="muted">Anyone with this link can see the tree, so send it only to family. It isn’t listed anywhere and search engines are told not to index this site. ${sync.owner ? 'Keep your editor password to yourself. Export a backup now and then (⋯ menu).' : ''}</p>`;
      $('#copyInvite').onclick = async () => {
        try { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
        catch { $('#inviteLink').select(); toast('Press Ctrl+C to copy'); }
      };
      $('#leaveShare').onclick = () => {
        if (!confirm('Stop showing the shared tree on this device? It stays online for everyone else, and this browser keeps a copy.')) return;
        stopLive(); drawShare(); toast('This device is no longer connected');
      };
      $('#changeForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = $('#newCode').value;
        if (code.trim().length < 12) { toast('Use at least 12 characters, e.g. four random words'); return; }
        if (code.trim().toLowerCase() === sync.passcode.trim().toLowerCase()) { toast('That’s the current passcode'); return; }
        if (!confirm('Change the family passcode? The old invite link will stop working, so you’ll need to send the new one to everyone.')) return;
        const oldId = sync.treeId, pw = sync.owner;
        clearInterval(sync.timer);
        const ok = await uploadAndShare(code, pw);
        if (!ok) {
          sync.treeId = oldId; setStatus('live'); sync.timer = setInterval(poll, POLL_MS);
          toast('Couldn’t change the passcode, so nothing was changed. That passcode may already be in use.');
          return;
        }
        await postTree({ password: pw, remove: true }, oldId).catch(() => {});
        drawShare();
        toast('Passcode changed. Send family the new invite link.');
      });
      $('#unlockForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = $('#unlockCode').value;
        const v = await postTree({ password: pw, verify: true });
        if (v.status === 200) { sync.owner = pw; remember_(); setStatus('live'); toast('Editing unlocked on this device'); }
        else toast('That editor password isn’t right');
      });
      return;
    }
    if (shareStep?.empty) {
      const n = realPeople().length;
      body.innerHTML = `<p>No family tree uses that passcode yet.</p>
        <p class="muted">If a relative sent you the passcode, check it was typed exactly and try again.</p>
        ${hasOwnData() ? `<p><b>Setting up sharing?</b> Choose an editor password. Only someone with it can change the tree, so keep it to yourself.</p>
        <form id="setupForm" class="setup-form">
          <input class="pk-input" id="setupPw" type="password" autocomplete="new-password" placeholder="Editor password (only you)" required>
          <input class="pk-input" id="setupPw2" type="password" autocomplete="new-password" placeholder="Type it again" required>
          <div class="share-actions">
            <button class="btn" type="button" id="shareRetry">Try another passcode</button>
            <button class="btn primary" type="submit">Upload my tree (${n} people) and share it</button>
          </div>
        </form>` : '<div class="share-actions"><button class="btn" id="shareRetry">Try another passcode</button></div>'}
        ${sync.status === 'error' ? `<p class="share-error">${esc(sync.error)}</p>` : ''}`;
      $('#shareRetry').onclick = () => { shareStep = null; drawShare(); };
      $('#setupForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const a = $('#setupPw').value, b = $('#setupPw2').value;
        if (a.length < 8) { toast('Use at least 8 characters for the editor password'); return; }
        if (a !== b) { toast('The two passwords don’t match'); return; }
        if (a.trim().toLowerCase() === shareStep.empty.trim().toLowerCase()) { toast('Use a different password from the family passcode'); return; }
        const ok = await uploadAndShare(shareStep.empty, a);
        if (ok) { shareStep = null; drawShare(); toast('Your tree is now shared'); }
      });
      return;
    }
    body.innerHTML = `<p>Enter the family passcode to open the family tree.</p>
      <form id="joinForm" class="join-row">
        <input class="pk-input" id="joinCode" type="password" autocomplete="off" placeholder="Family passcode" required>
        <button class="btn primary" type="submit">${sync.status === 'connecting' ? 'Opening…' : 'Open'}</button>
      </form>
      ${sync.status === 'error' ? `<p class="share-error">${esc(sync.error)}</p>` : ''}
      <p class="muted">Setting it up for the first time? Choose a family passcode that’s easy to say out loud, like four random words (“mango river silver kite”). Family use it to view the tree. You’ll set a separate editor password next.</p>`;
    $('#joinForm').onsubmit = async (e) => {
      e.preventDefault();
      const code = $('#joinCode').value;
      if (code.trim().length < 8) { toast('Use at least 8 characters, e.g. a few words'); return; }
      const res = await connect(code);
      if (res === 'empty') shareStep = { empty: code };
      drawShare();
      if (res === 'live') { shareDlg.close(); toast('Opened the family tree'); }
    };
    setTimeout(() => $('#joinCode')?.focus(), 30);
  }

  async function openShare() {
    shareStep = null;
    await checkAvailable();
    drawShare();
    if (!shareDlg.open) shareDlg.showModal();
  }
  $('#shareClose').onclick = () => shareDlg.close();
  shareDlg.addEventListener('click', (e) => { if (e.target === shareDlg) shareDlg.close(); });

  // Start sharing on load: an invite link (#join=…) or a remembered passcode.
  async function startSharing() {
    const m = location.hash.match(/(?:^#|&)join=([^&]+)/);
    let code = m ? decodeURIComponent(m[1]) : null, owner = null;
    if (m) history.replaceState(null, '', location.pathname + location.search);   // keep the passcode out of the address bar
    try {
      const saved = JSON.parse(localStorage.getItem(SHARE_KEY) || 'null');
      if (!code) code = saved?.passcode || null;
      if (saved?.passcode === code) owner = saved?.owner || null;
    } catch { /* ignore */ }
    if (await checkAvailable() !== 'yes') { setStatus('local'); if (m) openShare(); return; }
    if (!code) {
      setStatus('local');
      if (!hasOwnData()) openShare();      // a visitor without the passcode sees no family data
      return;
    }
    const res = await connect(code, owner);
    if (res === 'empty') { shareStep = { empty: code }; drawShare(); shareDlg.showModal(); }
    else if (res === 'error') openShare();
  }


  // ============================================================ fan view
  //
  // A person in the middle and their ancestors in rings around them:
  // parents, grandparents, great-grandparents… Father's line on the left,
  // mother's on the right. Click anyone to put them in the middle.

  let view = 'tree';           // tree | fan
  let fanFocus = null;
  const FAN_GENS = 5, FAN_R0 = 92, FAN_RING = 86, FAN_SPAN = 220;   // degrees

  const polar = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)]; };
  function arcPath(r1, r2, a1, a2) {
    const large = a2 - a1 > 180 ? 1 : 0;
    const [x1, y1] = polar(r2, a1), [x2, y2] = polar(r2, a2), [x3, y3] = polar(r1, a2), [x4, y4] = polar(r1, a1);
    return `M${x1},${y1}A${r2},${r2} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${r1},${r1} 0 ${large} 0 ${x4},${y4}Z`;
  }
  // Father first, then mother (unknown genders keep their order).
  function orderedParents(id) {
    const ps = P(id).parents.filter((x) => P(x) && !P(x).unknown);
    return ps.sort((a, b) => (G(a) === 'f') - (G(b) === 'f'));
  }

  function fanDefaultFocus() {
    if (fanFocus && P(fanFocus)) return fanFocus;
    if (selectedId && P(selectedId) && !P(selectedId).unknown) return selectedId;
    if (lastSelected && P(lastSelected)) return lastSelected;
    if (meId && P(meId)) return meId;
    // someone with the most known ancestors
    const depth = (id, d = 0) => (d > 6 ? 0 : 1 + Math.max(0, ...orderedParents(id).map((p) => depth(p, d + 1))));
    return realPeople().map((p) => p.id).sort((a, b) => depth(b) - depth(a))[0] || null;
  }

  function renderFan() {
    const host = $('#fanView');
    const focus = fanFocus = fanDefaultFocus();
    if (!focus) { host.innerHTML = '<div class="fan-empty">Add some people first.</div>'; return; }
    const parts = [];
    const start = -FAN_SPAN / 2;
    const clipDefs = [];
    // slot list per generation: [id or null, childId, parentIndex]
    let slots = [{ id: focus }];
    let maxG = 0;
    for (let g = 1; g <= FAN_GENS; g++) {
      const next = [];
      for (const s of slots) {
        const ps = s.id ? orderedParents(s.id) : [];
        const f = ps.find((x) => G(x) !== 'f') || null, m = ps.find((x) => x !== f) || null;
        next.push({ id: f, child: s.id, role: 'father' }, { id: m, child: s.id, role: 'mother' });
      }
      slots = next;
      if (!slots.some((s) => s.id || s.child)) break;
      maxG = g;
      const r1 = FAN_R0 + (g - 1) * FAN_RING, r2 = r1 + FAN_RING - 4;
      const step = FAN_SPAN / slots.length;
      slots.forEach((s, i) => {
        const a1 = start + i * step + 0.6, a2 = start + (i + 1) * step - 0.6;
        if (!s.id && !s.child) return;
        const p = s.id && P(s.id);
        const mid = (a1 + a2) / 2, rm = (r1 + r2) / 2;
        const cls = p ? `seg ${p.gender}` : 'seg empty';
        parts.push(`<path class="${cls}" d="${arcPath(r1, r2, a1, a2)}" ${p ? `data-fan="${esc(s.id)}"` : s.child && canEdit() ? `data-fan-add="${esc(s.child)}"` : ''}><title>${esc(p ? p.name : 'Add ' + s.role)}</title></path>`);
        // label: upright near the middle, radial further out
        const [tx, ty] = polar(rm, mid);
        const words = p ? p.name.split(/\s+/) : [];
        if (p) {
          const arcLen = (Math.PI * rm * (a2 - a1)) / 180;
          if (g <= 2) {
            const lines = [words[0], words.slice(1).join(' ')].filter(Boolean);
            const sub = years(p) || p.nickname || '';
            parts.push(`<text class="fan-t g${g}" x="${tx}" y="${ty - (lines.length - 1) * 8 - (sub ? 6 : 0)}" text-anchor="middle">${lines.map((l, k) => `<tspan x="${tx}" dy="${k ? 16 : 0}">${esc(l)}</tspan>`).join('')}${sub ? `<tspan class="fan-sub" x="${tx}" dy="16">${esc(sub)}</tspan>` : ''}</text>`);
          } else {
            let rot = mid; let flip = mid > 0;
            const label = arcLen < 20 ? '' : (arcLen < 34 ? words[0] : p.name);
            if (label) parts.push(`<text class="fan-t g${g}" transform="translate(${tx},${ty}) rotate(${flip ? rot - 90 : rot + 90})" text-anchor="middle" dy="4">${esc(label.length > 16 ? label.slice(0, 15) + '…' : label)}</text>`);
          }
        } else if (s.child && canEdit() && g <= 3) {
          parts.push(`<text class="fan-add" x="${tx}" y="${ty + 5}" text-anchor="middle">+ ${s.role}</text>`);
        }
      });
    }
    // the person in the middle
    const fp = P(focus);
    clipDefs.push(`<clipPath id="fanClip"><circle r="${FAN_R0 - 34}" cy="-18"/></clipPath>`);
    const photo = fp.photo ? `<image href="${esc(fp.photo)}" x="${-(FAN_R0 - 34)}" y="${-(FAN_R0 - 34) - 18}" width="${2 * (FAN_R0 - 34)}" height="${2 * (FAN_R0 - 34)}" clip-path="url(#fanClip)" preserveAspectRatio="xMidYMid slice"/>`
      : '';
    parts.push(`<g class="fan-center" data-fan="${esc(focus)}"><circle class="seg center ${fp.gender}" r="${FAN_R0 - 4}"/>${photo}
      ${fp.photo ? `<text class="fan-name" y="${FAN_R0 - 38}" text-anchor="middle">${esc(fp.name.length > 20 ? fp.name.split(' ')[0] : fp.name)}</text>`
        : `<text class="fan-name big" y="-4" text-anchor="middle"><tspan x="0">${esc(fp.name.split(' ')[0])}</tspan><tspan x="0" dy="22">${esc(fp.name.split(' ').slice(1).join(' '))}</tspan></text>`}</g>`);
    const R = FAN_R0 + Math.max(1, maxG) * FAN_RING;
    const kids = childrenOf(focus).filter((c) => !P(c).unknown);
    host.innerHTML = `<svg class="fan-svg" viewBox="${-R - 10} ${-R - 10} ${2 * R + 20} ${R + FAN_R0 + 30}" preserveAspectRatio="xMidYMid meet">
        <defs>${clipDefs.join('')}</defs>${parts.join('')}</svg>
      <div class="fan-foot glass">
        <span class="fan-title">Ancestors of <b>${esc(fp.name)}</b></span>
        ${kids.length ? `<span class="fan-kids">Children: ${kids.map((c) => `<button class="chip" data-fan="${esc(c)}">${avatar(P(c), 'sm')}${esc(P(c).name)}</button>`).join('')}</span>` : ''}
      </div>`;
  }

  $('#fanView').addEventListener('click', (e) => {
    const add = e.target.closest('[data-fan-add]');
    if (add && canEdit()) { openEditor(null, { spouses: orderedParents(add.dataset.fanAdd).slice(0, 1) }, { childOf: add.dataset.fanAdd }); return; }
    const t = e.target.closest('[data-fan]');
    if (!t) return;
    const id = t.dataset.fan;
    if (id === fanFocus) { select(id, false); return; }
    fanFocus = id;
    renderFan();
    select(id, false);
  });

  function setView(v) {
    view = v;
    $$('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $$('#tabbar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === v));
    document.body.classList.toggle('fan-mode', v === 'fan');
    if (v === 'fan') { fanFocus = selectedId && P(selectedId) && !P(selectedId).unknown ? selectedId : fanFocus; renderFan(); }
    try { localStorage.setItem(UI_KEY + '.view', v); } catch { /* ignore */ }
  }
  $$('.view-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // ------------------------------------------------------- card size

  function setCardSize(large, rerender = true) {
    CARD_W = large ? 240 : 196;
    CARD_H = large ? 132 : 84;
    ROW_H = CARD_H + 108;
    document.body.classList.toggle('large-cards', large);
    $('[data-menu="cards"]').textContent = large ? 'Smaller profile cards' : 'Larger profile cards';
    try { localStorage.setItem(UI_KEY + '.large', large ? '1' : ''); } catch { /* ignore */ }
    if (rerender) { render(); fit(); }
  }


  // ================================================================ menu

  $('#addPersonBtn').onclick = () => openEditor(null);
  const menu = $('#menu');
  // The menu lives outside the (frosted) top bar so it can float anywhere.
  document.body.appendChild(menu);
  function toggleMenu(show = menu.hidden) {
    menu.hidden = !show;
    document.body.classList.toggle('menu-open', show);
    if (!show) return;
    if (isPhone()) { menu.style.cssText = ''; return; }
    const r = $('#menuBtn').getBoundingClientRect();
    menu.style.cssText = `top:${r.bottom + 8}px;right:${innerWidth - r.right}px;left:auto;bottom:auto`;
  }
  $('#menuBtn').onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu, #menuBtn, [data-tab="more"]')) { menu.hidden = true; document.body.classList.remove('menu-open'); } });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    menu.hidden = true;
    switch (b.dataset.menu) {
      case 'cards': setCardSize(!document.body.classList.contains('large-cards')); break;
      case 'siblings': toggleSiblings(); break;
      case 'home': goHome(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'expand': collapsed.clear(); saveUI(); render(); fit(); break;
      case 'collapse': {
        const lay = computeLayout(currentScope());
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
        if (!canEdit()) return;
        if (!confirm('Replace everything with the starter tree? Export a backup first if you want to keep your data.')) return;
        remember('reset'); state = starterTree(); collapsed.clear(); scopeId = null; closePanel(); save(); saveUI(); render(); fit();
        toast('Reset to starter tree');
        break;
    }
  });
  $('#importInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    menu.hidden = true;
    if (!f || !canEdit()) return;
    try {
      const data = normalize(JSON.parse(await f.text()));
      if (!confirm(`Replace the current tree (${realPeople().length} people) with this file (${Object.values(data.people).filter((p) => !p.unknown).length} people)?` + (sync.status === 'live' ? '\n\nThis is the shared tree, so it changes for everyone in the family.' : ''))) return;
      remember('import'); state = data; collapsed.clear(); scopeId = null; closePanel(); save(); saveUI(); render(); fit();
      toast('Imported ' + f.name);
    } catch { toast('That file is not a valid family tree backup.'); }
  });
  $$('.scope-select').forEach((sel) => sel.addEventListener('change', (e) => { setScope(e.target.value); menu.hidden = true; }));
  $('#bannerClose').onclick = () => { $('#banner').dataset.closed = '1'; $('#banner').hidden = true; saveUI(); };

  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  document.addEventListener('keydown', (e) => {
    if (dlg.open || relDlg.open) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
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
  $('#homeBtn').onclick = () => { if (view === 'fan') setView('tree'); goHome(); };
  $('#fabAdd').onclick = () => openEditor(null);
  // Phone tab bar
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    const t = b.dataset.tab;
    if (t === 'home') { if (view === 'fan') setView('tree'); goHome(); }
    else if (t === 'tree' || t === 'fan') setView(t);
    else if (t === 'rel') openRelations(meId, null);
    else if (t === 'share') openShare();
    else if (t === 'more') { e.stopPropagation(); toggleMenu(); }
  });
  $('#shareBtn').onclick = openShare;
  $('#syncPill').onclick = openShare;

  (async () => {
    await load();
    try { if (localStorage.getItem(UI_KEY + '.large')) setCardSize(true, false); } catch { /* ignore */ }
    render();
    try { if (localStorage.getItem(UI_KEY + '.view') === 'fan') setView('fan'); } catch { /* ignore */ }
    firstVisit ? goHome(false) : fit(false, readableZoom());
    startSharing();
  })();
})();
