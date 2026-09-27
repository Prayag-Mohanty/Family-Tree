/* Family Tree — plain JS, no build step. Data lives in localStorage; export/import JSON for backups. */
(() => {
  'use strict';

  const STORE_KEY = 'familyTree.v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** @type {{meId: string|null, people: Record<string, any>}} */
  let state = { meId: null, people: {} };
  let rel = new Map();          // id -> { label, side, dist }
  let selectedId = null;
  let zoom = 1;
  let currentView = 'tree';

  // ------------------------------------------------------------------ data

  function blankPerson(extra = {}) {
    return {
      id: uid(), name: '', callName: '', gender: '', birthYear: '', order: '',
      deceased: false, location: '', phone: '', notes: '', photo: '',
      parents: [], spouses: [], ...extra,
    };
  }

  function starterTree() {
    const people = {};
    const add = (id, o) => { people[id] = blankPerson({ id, ...o }); };
    // Father's side: paternal grandfather had 4 sons, father is the 2nd.
    add('pgf', { name: 'Paternal Grandfather', gender: 'male', spouses: ['pgm'] });
    add('pgm', { name: 'Paternal Grandmother', gender: 'female', spouses: ['pgf'] });
    add('pu1', { name: "Father's Elder Brother", gender: 'male', order: 1, parents: ['pgf', 'pgm'] });
    add('dad', { name: 'Father', gender: 'male', order: 2, parents: ['pgf', 'pgm'], spouses: ['mom'] });
    add('pu3', { name: "Father's Younger Brother", gender: 'male', order: 3, parents: ['pgf', 'pgm'] });
    add('pu4', { name: "Father's Youngest Brother", gender: 'male', order: 4, parents: ['pgf', 'pgm'] });
    // Mother's side: 3 daughters then 1 son, mother is the eldest.
    add('mgf', { name: 'Maternal Grandfather', gender: 'male', spouses: ['mgm'] });
    add('mgm', { name: 'Maternal Grandmother', gender: 'female', spouses: ['mgf'] });
    add('mom', { name: 'Mother', gender: 'female', order: 1, parents: ['mgf', 'mgm'], spouses: ['dad'] });
    add('ma2', { name: "Mother's Sister (2nd)", gender: 'female', order: 2, parents: ['mgf', 'mgm'] });
    add('ma3', { name: "Mother's Sister (3rd)", gender: 'female', order: 3, parents: ['mgf', 'mgm'] });
    add('mu4', { name: "Mother's Brother", gender: 'male', order: 4, parents: ['mgf', 'mgm'] });
    // You and your younger sibling.
    add('me', { name: 'Me', order: 1, parents: ['dad', 'mom'] });
    add('sib', { name: 'Younger Sibling', order: 2, parents: ['dad', 'mom'] });
    return { meId: 'me', people };
  }

  const PLACEHOLDER_IDS = new Set(['pgf', 'pgm', 'pu1', 'dad', 'pu3', 'pu4', 'mgf', 'mgm', 'mom', 'ma2', 'ma3', 'mu4', 'me', 'sib']);
  const PLACEHOLDER_NAMES = new Set(Object.values(starterTree().people).map((p) => p.name));

  function normalize(data) {
    if (!data || typeof data !== 'object' || typeof data.people !== 'object') throw new Error('Not a family tree file');
    const people = {};
    for (const [id, p] of Object.entries(data.people)) {
      people[id] = { ...blankPerson(), ...p, id, parents: [...(p.parents || [])], spouses: [...(p.spouses || [])] };
    }
    // Drop dangling references, enforce spouse symmetry.
    for (const p of Object.values(people)) {
      p.parents = [...new Set(p.parents.filter((x) => people[x] && x !== p.id))].slice(0, 2);
      p.spouses = [...new Set(p.spouses.filter((x) => people[x] && x !== p.id))];
      if (!/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo || '')) p.photo = '';
    }
    for (const p of Object.values(people)) {
      for (const s of p.spouses) if (!people[s].spouses.includes(p.id)) people[s].spouses.push(p.id);
    }
    return { meId: people[data.meId] ? data.meId : null, people };
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save — storage may be full (try smaller photos).'); }
  }

  async function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { state = normalize(JSON.parse(raw)); return; }
    } catch (e) { /* fall through */ }
    // Optional: a family.json committed next to index.html seeds the tree on a fresh device.
    try {
      const res = await fetch('family.json', { cache: 'no-store' });
      if (res.ok) { state = normalize(await res.json()); save(); return; }
    } catch (e) { /* ignore */ }
    state = starterTree();
    save();
  }

  const P = (id) => state.people[id];
  const all = () => Object.values(state.people);
  const childrenOf = (ids) => {
    const set = new Set(ids);
    return sortSiblings(all().filter((p) => p.parents.some((x) => set.has(x))).map((p) => p.id));
  };
  function sortSiblings(ids) {
    return ids.sort((a, b) => {
      const A = P(a), B = P(b);
      const ya = +A.birthYear || 9999, yb = +B.birthYear || 9999;
      if (ya !== yb) return ya - yb;
      const oa = +A.order || 99, ob = +B.order || 99;
      if (oa !== ob) return oa - ob;
      return A.name.localeCompare(B.name);
    });
  }
  function siblingsOf(id) {
    const p = P(id);
    if (!p.parents.length) return [];
    return childrenOf(p.parents).filter((x) => x !== id);
  }
  const displayName = (p) => p.name || '(unnamed)';
  const initials = (p) => displayName(p).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  // ------------------------------------------------------- relationships

  const WORDS = {
    parent: { male: 'father', female: 'mother', '': 'parent' },
    child: { male: 'son', female: 'daughter', '': 'child' },
    spouse: { male: 'husband', female: 'wife', '': 'spouse' },
    sibling: { male: 'brother', female: 'sister', '': 'sibling' },
  };
  const FRIENDLY = {
    "father's father": 'Paternal grandfather', "father's mother": 'Paternal grandmother',
    "mother's father": 'Maternal grandfather', "mother's mother": 'Maternal grandmother',
  };

  // Is a older than b? true / false / null (unknown)
  function isOlder(a, b) {
    if (a.birthYear && b.birthYear && +a.birthYear !== +b.birthYear) return +a.birthYear < +b.birthYear;
    if (a.order && b.order && +a.order !== +b.order) return +a.order < +b.order;
    return null;
  }

  function neighbors(id) {
    const p = P(id);
    const out = [];
    for (const x of p.parents) out.push(['parent', x]);
    for (const x of p.spouses) out.push(['spouse', x]);
    for (const c of all()) if (c.parents.includes(id)) out.push(['child', c.id]);
    return out;
  }

  function computeRelations() {
    rel = new Map();
    const me = state.meId;
    if (!me || !P(me)) return;
    const prev = new Map([[me, null]]);
    const queue = [me];
    while (queue.length) {
      const cur = queue.shift();
      for (const [type, nb] of neighbors(cur)) {
        if (!prev.has(nb)) { prev.set(nb, { from: cur, type }); queue.push(nb); }
      }
    }
    for (const id of prev.keys()) {
      if (id === me) { rel.set(id, { label: 'You', side: 'Immediate family', dist: 0 }); continue; }
      const steps = [];
      for (let c = id; c !== me;) { const s = prev.get(c); steps.unshift({ type: s.type, from: s.from, to: c }); c = s.from; }
      // parent → child (to someone else) collapses into "sibling"
      const merged = [];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i], t = steps[i + 1];
        if (s.type === 'parent' && t && t.type === 'child' && t.to !== s.from) {
          merged.push({ type: 'sibling', from: s.from, to: t.to }); i++;
        } else merged.push(s);
      }
      const parts = merged.map((s) => {
        const to = P(s.to);
        const g = to.gender === 'male' || to.gender === 'female' ? to.gender : '';
        let w = WORDS[s.type][g];
        if (s.type === 'sibling') {
          const older = isOlder(to, P(s.from));
          if (older === true) w = 'elder ' + w; else if (older === false) w = 'younger ' + w;
        }
        return w;
      });
      let label = parts.join("'s ");
      label = FRIENDLY[label] || label[0].toUpperCase() + label.slice(1);

      let side = 'Other relatives';
      const first = merged[0];
      if (merged.length === 1) side = 'Immediate family';
      else if (first.type === 'parent') {
        const g = P(first.to).gender;
        side = g === 'male' ? "Father's side" : g === 'female' ? "Mother's side" : "Parent's side";
      } else if (first.type === 'spouse') side = "Spouse's side";
      else if (first.type === 'sibling' || first.type === 'child') side = 'Immediate family';
      rel.set(id, { label, side, dist: merged.length });
    }
  }
  const relLabel = (id) => (rel.get(id) || {}).label || (state.meId ? 'Not connected to you' : '');

  // ------------------------------------------------------------ tree view

  function findRoots() {
    const hasParents = (id) => P(id).parents.length > 0;
    const roots = [];
    const taken = new Set();
    for (const p of all()) {
      if (hasParents(p.id) || taken.has(p.id)) continue;
      if (p.spouses.some(hasParents)) continue;          // married into another family
      roots.push(p.id);
      taken.add(p.id);
      p.spouses.forEach((s) => taken.add(s));
    }
    const size = (id) => { const seen = new Set(); const walk = (x) => { if (seen.has(x)) return; seen.add(x); childrenOf([x, ...P(x).spouses]).forEach(walk); }; walk(id); return seen.size; };
    return roots.sort((a, b) => size(b) - size(a));
  }

  function rootTitle(id) {
    const p = P(id);
    return [p, ...p.spouses.map(P)].map(displayName).join(' & ');
  }

  function nodeHTML(id, { marriedIn = false } = {}) {
    const p = P(id);
    const cls = ['node', p.gender, id === state.meId && 'me', id === selectedId && 'selected', p.deceased && 'deceased'].filter(Boolean).join(' ');
    const photo = p.photo ? ` style="background-image:url('${esc(p.photo)}')"` : '';
    const tag = id === state.meId ? '<span class="n-tag">You</span>' : marriedIn && p.parents.length ? '<span class="n-tag" title="Their own family is shown in another tree">in-law</span>' : '';
    return `<div class="${cls}" data-id="${esc(id)}" tabindex="0" role="button">
      ${tag}
      <div class="avatar ${p.gender}"${photo}>${p.photo ? '' : esc(initials(p))}</div>
      <div class="n-name">${esc(displayName(p))}</div>
      ${p.callName ? `<div class="n-call">“${esc(p.callName)}”</div>` : ''}
      <div class="n-rel">${esc(id === state.meId ? '' : relLabel(id))}</div>
    </div>`;
  }

  function unitHTML(id, seen) {
    seen.add(id);
    const p = P(id);
    const spouses = p.spouses.filter((s) => !seen.has(s));
    spouses.forEach((s) => seen.add(s));
    const unit = [nodeHTML(id), ...spouses.map((s) => `<span class="heart">♥</span>${nodeHTML(s, { marriedIn: true })}`)].join('');
    const kids = childrenOf([id, ...spouses]).filter((k) => !seen.has(k));
    return `<li><div class="unit">${unit}</div>${kids.length ? `<ul>${kids.map((k) => unitHTML(k, seen)).join('')}</ul>` : ''}</li>`;
  }

  function renderTree() {
    const sel = $('#rootSelect');
    const roots = findRoots();
    const prevVal = sel.value;
    sel.innerHTML = `<option value="all">All families (${roots.length})</option>` +
      roots.map((r) => `<option value="${esc(r)}">Family of ${esc(rootTitle(r))}</option>`).join('');
    sel.value = roots.includes(prevVal) ? prevVal : 'all';

    const shown = sel.value === 'all' ? roots : [sel.value];
    const canvas = $('#treeCanvas');
    if (!all().length) {
      canvas.innerHTML = '<div class="empty">No one here yet. Click <b>+ Add person</b> to start.</div>';
    } else {
      canvas.innerHTML = shown.map((r) => `
        <div class="family-block">
          ${shown.length > 1 ? `<h3 class="family-title">Family of ${esc(rootTitle(r))}</h3>` : ''}
          <div class="tree"><ul>${unitHTML(r, new Set())}</ul></div>
        </div>`).join('');
    }
    canvas.style.zoom = zoom;
    $('#zoomLabel').textContent = Math.round(zoom * 100) + '%';
    $('#placeholderBanner').hidden = !all().some((p) => PLACEHOLDER_IDS.has(p.id) && PLACEHOLDER_NAMES.has(p.name));
    applySearch();
  }

  // ---------------------------------------------------------- people view

  const SIDE_ORDER = ['Immediate family', "Father's side", "Mother's side", "Parent's side", "Spouse's side", 'Other relatives', 'Not connected'];

  function renderPeople() {
    const q = $('#search').value.trim().toLowerCase();
    const groups = new Map();
    const list = all().filter((p) => matches(p, q)).sort((a, b) => {
      const ra = rel.get(a.id), rb = rel.get(b.id);
      return ((ra?.dist ?? 99) - (rb?.dist ?? 99)) || displayName(a).localeCompare(displayName(b));
    });
    for (const p of list) {
      const side = rel.get(p.id)?.side || 'Not connected';
      if (!groups.has(side)) groups.set(side, []);
      groups.get(side).push(p);
    }
    const html = SIDE_ORDER.filter((s) => groups.has(s)).map((s) => `
      <h3 class="group-title">${esc(s)} · ${groups.get(s).length}</h3>
      <div class="cards">${groups.get(s).map((p) => `
        <div class="pcard" data-id="${esc(p.id)}" tabindex="0" role="button">
          <div class="avatar ${p.gender}"${p.photo ? ` style="background-image:url('${esc(p.photo)}')"` : ''}>${p.photo ? '' : esc(initials(p))}</div>
          <div class="meta">
            <div class="n-name">${esc(displayName(p))}${p.deceased ? ' †' : ''}</div>
            ${p.callName ? `<div class="n-call">“${esc(p.callName)}”</div>` : ''}
            <div class="n-rel">${esc(relLabel(p.id))}</div>
            ${p.location ? `<div class="n-loc">📍 ${esc(p.location)}</div>` : ''}
          </div>
        </div>`).join('')}
      </div>`).join('');
    $('#peopleList').innerHTML = html || '<div class="empty">No matches.</div>';
  }

  // --------------------------------------------------------------- search

  function matches(p, q) {
    if (!q) return true;
    return [p.name, p.callName, p.location, p.notes, p.phone, relLabel(p.id)].some((f) => String(f || '').toLowerCase().includes(q));
  }

  function applySearch() {
    const q = $('#search').value.trim().toLowerCase();
    let first = null;
    for (const el of $$('#treeCanvas .node')) {
      const hit = matches(P(el.dataset.id), q);
      el.classList.toggle('dim', !!q && !hit);
      el.classList.toggle('hit', !!q && hit);
      if (q && hit && !first) first = el;
    }
    return first;
  }

  // --------------------------------------------------------------- drawer

  function chip(id) {
    return `<button class="chip" data-goto="${esc(id)}">${esc(displayName(P(id)))}</button>`;
  }

  function openDrawer(id) {
    selectedId = id;
    const p = P(id);
    if (!p) return closeDrawer();
    const kids = childrenOf([id]);
    const sibs = siblingsOf(id);
    const facts = [
      ['Born', p.birthYear], ['Birth order', p.order ? `#${p.order} among siblings` : ''],
      ['Lives in', p.location], ['Phone', p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''],
    ].filter(([, v]) => v);
    const section = (title, ids) => ids.length ? `<div class="d-section"><h4>${title}</h4><div class="chips">${ids.map(chip).join('')}</div></div>` : '';
    $('#drawerBody').innerHTML = `
      <div class="d-head">
        <div class="avatar lg ${p.gender}"${p.photo ? ` style="background-image:url('${esc(p.photo)}')"` : ''}>${p.photo ? '' : esc(initials(p))}</div>
        <h2 class="d-name">${esc(displayName(p))}${p.deceased ? ' †' : ''}</h2>
        ${p.callName ? `<div class="d-call">You call them “${esc(p.callName)}”</div>` : ''}
        <div class="d-rel">${esc(id === state.meId ? 'This is you' : relLabel(id))}</div>
      </div>
      ${facts.length ? `<dl class="d-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${k === 'Phone' ? v : esc(v)}</dd>`).join('')}</dl>` : ''}
      ${p.notes ? `<div class="d-notes">${esc(p.notes)}</div>` : ''}
      ${section('Parents', p.parents)}
      ${section('Spouse', p.spouses)}
      ${section('Siblings', sibs)}
      ${section('Children', kids)}
      <div class="d-actions">
        <button class="btn primary wide" data-act="edit">✎ Edit details</button>
        <button class="btn" data-act="add-child">+ Child</button>
        <button class="btn" data-act="add-spouse">+ Spouse</button>
        <button class="btn" data-act="add-sibling">+ Sibling</button>
        <button class="btn" data-act="add-parent" ${p.parents.length >= 2 ? 'disabled' : ''}>+ Parent</button>
        ${id !== state.meId ? '<button class="btn wide" data-act="set-me">This is me</button>' : ''}
        <button class="btn danger wide" data-act="delete">Delete</button>
      </div>`;
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $$('.node').forEach((n) => n.classList.toggle('selected', n.dataset.id === id));
  }

  function closeDrawer() {
    selectedId = null;
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $$('.node.selected').forEach((n) => n.classList.remove('selected'));
  }

  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerBody').addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { openDrawer(go.dataset.goto); scrollToNode(go.dataset.goto); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn || !selectedId) return;
    const id = selectedId, p = P(id);
    switch (btn.dataset.act) {
      case 'edit': openEditor(id); break;
      case 'add-child': openEditor(null, { parents: [id, ...p.spouses.slice(0, 1)] }); break;
      case 'add-spouse': openEditor(null, { spouses: [id], gender: p.gender === 'male' ? 'female' : p.gender === 'female' ? 'male' : '' }); break;
      case 'add-sibling':
        if (!p.parents.length) { toast('Add a parent first, then add siblings under them.'); break; }
        openEditor(null, { parents: [...p.parents] }); break;
      case 'add-parent': openEditor(null, { spouses: p.parents.slice(0, 1) }, { childOf: id }); break;
      case 'set-me': state.meId = id; commit('Relationships now shown relative to ' + displayName(p)); openDrawer(id); break;
      case 'delete': deletePerson(id); break;
    }
  });

  function deletePerson(id) {
    const p = P(id);
    const kids = childrenOf([id]).length;
    const msg = `Delete ${displayName(p)}?` + (kids ? `\n\nTheir ${kids} child(ren) will stay, just without this parent linked.` : '');
    if (!confirm(msg)) return;
    delete state.people[id];
    for (const o of all()) {
      o.parents = o.parents.filter((x) => x !== id);
      o.spouses = o.spouses.filter((x) => x !== id);
    }
    if (state.meId === id) state.meId = null;
    closeDrawer();
    commit('Deleted ' + displayName(p));
  }

  // --------------------------------------------------------------- editor

  const dlg = $('#editDialog');
  const form = $('#editForm');
  let editing = null;   // { id|null, draft, childOf }

  function personOptions(excludeId, selected) {
    const opts = all().filter((p) => p.id !== excludeId).sort((a, b) => displayName(a).localeCompare(displayName(b)));
    return '<option value="">— none —</option>' + opts.map((p) =>
      `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(displayName(p))}${rel.get(p.id) && p.id !== state.meId ? ' · ' + esc(rel.get(p.id).label) : ''}</option>`).join('');
  }

  function renderSpouseChips() {
    const d = editing.draft;
    $('#spouseChips').innerHTML = d.spouses.map((s) => `<span class="chip">${esc(displayName(P(s)))}<button type="button" class="x" data-rm="${esc(s)}" aria-label="Remove">✕</button></span>`).join('') || '<span class="q-hint">None</span>';
    const sa = $('#spouseAdd');
    sa.innerHTML = personOptions(editing.id).replace('— none —', '+ Add a spouse…');
    [...sa.options].forEach((o) => { if (d.spouses.includes(o.value)) o.remove(); });
  }

  function renderPhoto() {
    const d = editing.draft;
    const el = $('#photoPreview');
    el.className = 'avatar lg ' + (d.gender || '');
    el.style.backgroundImage = d.photo ? `url('${d.photo}')` : '';
    el.textContent = d.photo ? '' : initials({ name: form.name.value || '?' });
  }

  function openEditor(id, preset = {}, extra = {}) {
    const base = id ? P(id) : blankPerson(preset);
    editing = { id, childOf: extra.childOf || null, draft: { ...base, parents: [...base.parents], spouses: [...base.spouses] } };
    const d = editing.draft;
    $('#editTitle').textContent = id ? 'Edit ' + displayName(base) : 'Add person';
    for (const k of ['name', 'callName', 'gender', 'birthYear', 'order', 'location', 'phone', 'notes']) form[k].value = d[k] ?? '';
    form.deceased.checked = !!d.deceased;
    // Clear placeholder names so the field is ready to type into.
    if (id && PLACEHOLDER_IDS.has(id) && PLACEHOLDER_NAMES.has(d.name)) { form.name.value = ''; form.name.placeholder = d.name; }
    else form.name.placeholder = '';
    form.parent1.innerHTML = personOptions(id, d.parents[0]);
    form.parent2.innerHTML = personOptions(id, d.parents[1]);
    renderSpouseChips();
    renderPhoto();
    dlg.showModal();
    form.name.focus();
  }

  $('#spouseChips').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    editing.draft.spouses = editing.draft.spouses.filter((s) => s !== rm.dataset.rm);
    renderSpouseChips();
  });
  $('#spouseAdd').addEventListener('change', (e) => {
    if (e.target.value) editing.draft.spouses.push(e.target.value);
    renderSpouseChips();
  });
  form.gender.addEventListener('change', () => { editing.draft.gender = form.gender.value; renderPhoto(); });
  form.name.addEventListener('input', renderPhoto);
  $('#photoInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { editing.draft.photo = await shrinkImage(f, 200); renderPhoto(); }
    catch { toast('Could not read that image.'); }
  });
  $('#photoRemove').addEventListener('click', () => { editing.draft.photo = ''; renderPhoto(); });
  $('#editCancel').addEventListener('click', () => dlg.close());

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = editing.draft;
    const name = form.name.value.trim() || form.name.placeholder;
    if (!name) { form.name.focus(); return; }
    Object.assign(d, {
      name, callName: form.callName.value.trim(), gender: form.gender.value,
      birthYear: form.birthYear.value, order: form.order.value, location: form.location.value.trim(),
      phone: form.phone.value.trim(), notes: form.notes.value.trim(), deceased: form.deceased.checked,
      parents: [...new Set([form.parent1.value, form.parent2.value].filter(Boolean))],
    });
    const id = d.id;
    const old = state.people[id];
    // Keep spouse links symmetric.
    for (const s of old?.spouses || []) if (!d.spouses.includes(s) && P(s)) P(s).spouses = P(s).spouses.filter((x) => x !== id);
    state.people[id] = d;
    for (const s of d.spouses) if (P(s) && !P(s).spouses.includes(id)) P(s).spouses.push(id);
    if (editing.childOf && P(editing.childOf)) {
      const c = P(editing.childOf);
      if (!c.parents.includes(id) && c.parents.length < 2) c.parents.push(id);
    }
    dlg.close();
    commit((old ? 'Saved ' : 'Added ') + name);
    openDrawer(id);
    requestAnimationFrame(() => scrollToNode(id));
  });

  function shrinkImage(file, size) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.width, img.height);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ----------------------------------------------------------------- quiz

  let quiz = { mode: 'name', right: 0, total: 0 };

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function renderQuiz() {
    const card = $('#quizCard');
    const isPlaceholder = (p) => PLACEHOLDER_IDS.has(p.id) && PLACEHOLDER_NAMES.has(p.name);
    const pool = all().filter((p) => p.id !== state.meId && rel.has(p.id) && !isPlaceholder(p));
    if (pool.length < 2) {
      card.innerHTML = '<div class="q-hint">Enter real names for at least two relatives (tap anyone in the Tree) and the quiz will start.</div>';
      return;
    }
    const target = pool[Math.floor(Math.random() * pool.length)];
    const answer = quiz.mode === 'name' ? displayName(target) : rel.get(target.id).label;
    const value = (p) => (quiz.mode === 'name' ? displayName(p) : rel.get(p.id).label);
    const others = shuffle(pool.filter((p) => p.id !== target.id))
      .sort((a, b) => (b.gender === target.gender) - (a.gender === target.gender));
    const options = [answer];
    for (const o of others) { const v = value(o); if (!options.includes(v)) options.push(v); if (options.length === 4) break; }
    shuffle(options);

    const avatar = `<div class="avatar lg ${target.gender}"${target.photo ? ` style="background-image:url('${esc(target.photo)}')"` : ''}>${target.photo ? '' : '?'}</div>`;
    const question = quiz.mode === 'name'
      ? `What is the name of your <u>${esc(rel.get(target.id).label.toLowerCase())}</u>?`
      : `How is <u>${esc(displayName(target))}</u> related to you?`;
    const hint = [target.location && '📍 ' + target.location, quiz.mode === 'relation' && target.callName && `You call them “${target.callName}”`].filter(Boolean).map(esc).join(' · ');
    card.innerHTML = `${quiz.mode === 'name' ? avatar : avatar.replace('>?<', `>${esc(initials(target))}<`)}
      <div class="q-text">${question}</div>
      ${hint ? `<div class="q-hint">${hint}</div>` : ''}
      <div class="q-options">${options.map((o) => `<button class="q-opt" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      <div class="q-hint" id="qFeedback"></div>`;
    card.onclick = (e) => {
      const b = e.target.closest('.q-opt');
      if (!b || b.disabled) return;
      quiz.total++;
      const ok = b.dataset.v === answer;
      if (ok) quiz.right++;
      $$('.q-opt', card).forEach((x) => { x.disabled = true; if (x.dataset.v === answer) x.classList.add('right'); });
      if (!ok) b.classList.add('wrong');
      const extra = target.callName && quiz.mode === 'name' ? ` — you call them “${target.callName}”` : '';
      $('#qFeedback').innerHTML = (ok ? '✅ Correct!' : `❌ It’s ${esc(answer)}`) + esc(extra) +
        `<div style="margin-top:12px"><button class="btn primary" id="qNext">Next →</button></div>`;
      $('#quizScore').textContent = `Score ${quiz.right} / ${quiz.total}`;
      $('#qNext').onclick = renderQuiz;
    };
  }

  $$('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    $$('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    quiz.mode = b.dataset.mode;
    renderQuiz();
  }));

  // ---------------------------------------------------------- navigation

  function setView(v) {
    if (v !== currentView) closeDrawer();
    currentView = v;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
    if (v === 'people') renderPeople();
    if (v === 'quiz') renderQuiz();
    try { localStorage.setItem(STORE_KEY + '.view', v); } catch { /* ignore */ }
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

  function commit(msg) {
    save();
    computeRelations();
    renderTree();
    if (currentView === 'people') renderPeople();
    if (msg) toast(msg);
  }

  function scrollToNode(id) {
    if (currentView !== 'tree') return;
    let el = $(`#treeCanvas .node[data-id="${CSS.escape(id)}"]`);
    if (!el) {  // not in the currently selected family — switch to "All families"
      $('#rootSelect').value = 'all'; renderTree();
      el = $(`#treeCanvas .node[data-id="${CSS.escape(id)}"]`);
    }
    el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }

  // Tree & people clicks
  const onNodeActivate = (e) => {
    const n = e.target.closest('[data-id]');
    if (!n || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    if (dragMoved) return;
    e.preventDefault();
    openDrawer(n.dataset.id);
  };
  for (const el of [$('#treeCanvas'), $('#peopleList')]) {
    el.addEventListener('click', onNodeActivate);
    el.addEventListener('keydown', onNodeActivate);
  }

  // Drag to pan the tree
  const scroller = $('#treeScroll');
  let drag = null, dragMoved = false;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop };
    dragMoved = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { dragMoved = true; scroller.classList.add('dragging'); }
    scroller.scrollLeft = drag.sl - dx; scroller.scrollTop = drag.st - dy;
  });
  window.addEventListener('pointerup', () => { drag = null; scroller.classList.remove('dragging'); setTimeout(() => { dragMoved = false; }, 0); });

  // Zoom
  const setZoom = (z) => { zoom = Math.min(1.6, Math.max(0.3, Math.round(z * 10) / 10)); $('#treeCanvas').style.zoom = zoom; $('#zoomLabel').textContent = Math.round(zoom * 100) + '%'; };
  $('#zoomIn').addEventListener('click', () => setZoom(zoom + 0.1));
  $('#zoomOut').addEventListener('click', () => setZoom(zoom - 0.1));
  scroller.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom - Math.sign(e.deltaY) * 0.1); } }, { passive: false });
  $('#findMe').addEventListener('click', () => { if (state.meId) { scrollToNode(state.meId); openDrawer(state.meId); } else toast('Open someone and tap “This is me”.'); });
  $('#rootSelect').addEventListener('change', renderTree);

  // Search
  $('#search').addEventListener('input', () => {
    if (currentView === 'people') renderPeople();
    else if (currentView === 'tree') { const first = applySearch(); first?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); }
    else if ($('#search').value) setView('people');
  });

  // Menu
  $('#addPersonBtn').addEventListener('click', () => openEditor(null));
  const closeMenu = () => $('.dropdown').removeAttribute('open');
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `family-tree-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    closeMenu();
  });
  $('#importInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    closeMenu();
    if (!f) return;
    try {
      const data = normalize(JSON.parse(await f.text()));
      if (!confirm(`Replace your current tree (${all().length} people) with this file (${Object.keys(data.people).length} people)?`)) return;
      state = data; closeDrawer(); commit('Imported ' + f.name);
    } catch (err) { toast('That file is not a valid family tree backup.'); }
  });
  $('#printBtn').addEventListener('click', () => { closeMenu(); setView('tree'); setTimeout(() => window.print(), 50); });
  $('#resetBtn').addEventListener('click', () => {
    closeMenu();
    if (!confirm('Replace everything with the starter tree? Export a backup first if you want to keep your data.')) return;
    state = starterTree(); closeDrawer(); commit('Reset to starter tree');
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.open) closeDrawer(); });

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ----------------------------------------------------------------- boot

  (async () => {
    await load();
    computeRelations();
    renderTree();
    let v = 'tree';
    try { v = localStorage.getItem(STORE_KEY + '.view') || 'tree'; } catch { /* ignore */ }
    setView(['tree', 'people', 'quiz'].includes(v) ? v : 'tree');
  })();
})();
