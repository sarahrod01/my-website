/* ==========================================================================
   Nursiecare · Candidate Profile Builder
   --------------------------------------------------------------------------
   Plain JavaScript, no libraries, no server. Organised in five modules so
   the storage layer can later be swapped for an API (e.g. HubSpot) without
   touching the editor or the CV:

     1. CandidateModel  – the candidate data structure, defaults, helpers
     2. Storage         – LocalStorageRepository (+ an ApiRepository sketch)
     3. CvRenderer      – candidate object → CV blocks → paginated A4 pages
     4. FormController  – right-hand editor ↔ candidate object
     5. App             – toolbar, candidate library, print / export, toasts
   ========================================================================== */
'use strict';

/* ==========================================================================
   0. Small shared utilities
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));
const clone = (obj) => JSON.parse(JSON.stringify(obj));
const makeUid = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** "2026-09-25T…" → "25/09/2026" */
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return [d.getDate(), d.getMonth() + 1].map((n) => String(n).padStart(2, '0')).join('/') + '/' + d.getFullYear();
}
/** "2027-05-31" → "31/05/2027" (date inputs) */
function formatInputDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (v || '');
}
/** "2021-03" → "Mar 2021" (month inputs) */
function formatMonth(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(v || '');
  if (!m) return v || '';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m[2]) - 1]} ${m[1]}`;
}

/** Read a value by dotted path: getPath(c, 'card.strengths.0') */
function getPath(obj, path) {
  return path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj);
}
/** Write a value by dotted path, creating objects/arrays as needed */
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((key, i) => {
    if (o[key] == null) o[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[key];
  });
  o[keys[keys.length - 1]] = value;
}

/* ==========================================================================
   1. CandidateModel — the data structure
   --------------------------------------------------------------------------
   One candidate = one plain JSON object. Grouped the same way as the CV so
   each CV section maps to one branch of the object. This is also the shape
   you would send to / receive from an API later.
   ========================================================================== */
const SCHEMA_VERSION = 1;

/** Fact markers used throughout the profile */
const MARKERS = {
  verified: { symbol: '✔', label: 'Verified by Nursiecare' },
  reported: { symbol: '◐', label: 'Candidate-reported' },
  pending:  { symbol: '○', label: 'Pending' },
};

/** Fact markers drawn as inline SVG so they look the same in every font, printer and PDF */
const MARKER_SVG = {
  verified: '<path d="M2.2 6.4l2.5 2.5L9.8 3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  reported: '<circle cx="6" cy="6" r="4.1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 1.9a4.1 4.1 0 0 0 0 8.2z" fill="currentColor"/>',
  pending:  '<circle cx="6" cy="6" r="4.1" fill="none" stroke="currentColor" stroke-width="1.3"/>',
};
const markIcon = (status, extraClass = '') => (MARKERS[status]
  ? `<span class="mk mk-${status} ${extraClass}" title="${MARKERS[status].label}" role="img" aria-label="${MARKERS[status].label}"><svg viewBox="0 0 12 12" aria-hidden="true">${MARKER_SVG[status]}</svg></span>`
  : '');

/** Rows of section "Verification": [key, label, placeholder] */
const VERIFICATION_ITEMS = [
  ['ahpra',         'AHPRA',         'date checked on register'],
  ['qualification', 'Qualification', 'what was sighted'],
  ['employment',    'Employment',    'period verified / Partial'],
  ['references',    'References',    'x of 2: roles'],
  ['police',        'Police check',  'Status'],
  ['vaccinations',  'Vaccinations',  'Status; employer to confirm requirements'],
];

/** Blank shapes for repeatable ("Add …") entries */
const LIST_ITEM_BLANKS = {
  text: '',
  textarea: '',
  capability:    { capability: '', practice: '', evidence: '' },
  employment:    { position: '', facility: '', location: '', start: '', end: '', current: false, description: '', responsibilities: '' },
  qualification: { qualification: '', institution: '', year: '' },
  registration:  { name: '', number: '', expiry: '', status: '' },
};

/** Which list lives at which path (used when normalising stored data) */
const OBJECT_LISTS = {
  employmentHistory: 'employment',
  capabilities: 'capability',
  qualifications: 'qualification',
  registrations: 'registration',
};

const DEFAULT_SUPPORT = 'Interview coordination, visa liaison, settlement support, 30/60/90-day check-ins';

const CandidateModel = {
  /** A new, empty candidate */
  blank(id = '') {
    return {
      schemaVersion: SCHEMA_VERSION,
      uid: makeUid(),            // internal key (never shown)
      id,                        // Nursiecare candidate ID, e.g. NCR-004
      firstName: '',
      lastName: '',
      consentShared: false,
      createdAt: null,
      updatedAt: null,

      // PART A — Shortlist card
      card: {
        statusBadge: '',
        location: '', openTo: '',
        bestSuitedTo: '',
        ahpra: '',
        experience: { rn: '', olderPersons: '', ausAgedCare: '' },
        earliestStart: '', subjectTo: '',
        sponsorship: '', sponsorshipStatus: '',
        shifts: '',
        markers: { location: '', bestSuitedTo: '', ahpra: '', experience: '', earliestStart: '', sponsorship: '', shifts: '' },
        recommendation: '',
        strengths: ['', '', ''],
        watchouts: ['', ''],
      },
      checks: { ahpra: '', englishTest: '', english: '', references: '', police: '', licence: '' },

      // PART B — Full profile
      assessment: { strengths: ['', '', ''], watchouts: ['', ''], questions: ['', '', ''] },
      clinical: { currentRole: '', employmentType: '', practising: '', summary: '', typicalShift: '', systems: '' },
      employmentHistory: [],
      capabilities: Array.from({ length: 6 }, () => clone(LIST_ITEM_BLANKS.capability)),
      qualifications: [],
      registrations: [],
      verification: Object.fromEntries(VERIFICATION_ITEMS.map(([key]) => [key, { status: '', note: '' }])),
      preferences: { role: '', hours: '', shifts: '', pay: '' },
      readiness: { agedCarePrep: '', english: '', interview: '', whatWeSaw: '', introVideo: '' },
      relocation: { relocating: '', commitment: '', areas: '', supportNeeded: '', driving: '', visa: '', mobilisation: '' },
      support: { included: DEFAULT_SUPPORT, recruiterName: '', recruiterEmail: '', recruiterPhone: '' },
    };
  },

  /** Fill any missing fields (e.g. data saved by an older version) */
  normalize(raw) {
    const base = CandidateModel.blank();
    const merge = (b, r) => {
      if (Array.isArray(b)) return Array.isArray(r) ? r : b;
      if (b && typeof b === 'object') {
        const out = {};
        const src = r && typeof r === 'object' ? r : {};
        Object.keys(b).forEach((k) => { out[k] = merge(b[k], src[k]); });
        Object.keys(src).forEach((k) => { if (!(k in out)) out[k] = src[k]; }); // keep unknown fields
        return out;
      }
      return r === undefined || r === null ? b : r;
    };
    const c = merge(base, raw || {});
    Object.entries(OBJECT_LISTS).forEach(([path, kind]) => {
      c[path] = (c[path] || []).map((item) => ({ ...LIST_ITEM_BLANKS[kind], ...item }));
    });
    c.uid = raw && raw.uid ? raw.uid : base.uid;
    c.schemaVersion = SCHEMA_VERSION;
    return c;
  },

  newListItem(kind) { return clone(LIST_ITEM_BLANKS[kind] ?? ''); },

  /** "Maria S." — first name + last initial, as the template requires */
  displayName(c) {
    const first = (c.firstName || '').trim();
    const last = (c.lastName || '').trim();
    if (!first && !last) return '';
    return [first, last ? last[0].toUpperCase() + '.' : ''].filter(Boolean).join(' ');
  },
  fullName(c) { return [c.firstName, c.lastName].map((s) => (s || '').trim()).filter(Boolean).join(' '); },

  /** Quality checks shown in the editor (mirrors the template's guidance) */
  checks(c) {
    const issues = [];
    const need = (ok, msg, section) => { if (!ok) issues.push({ msg, section }); };
    const tooLong = (v, n) => (v || '').trim().length > n;

    need(has(c.firstName) && has(c.lastName), 'Add first and last name', 'details');
    need(has(c.id), 'Add a candidate ID', 'details');
    need(c.consentShared, 'Record candidate consent before sharing', 'details');
    need(has(c.card.statusBadge), 'Choose a status badge', 'card');
    const facts = [
      ['Location', c.card.location], ['Best suited to', c.card.bestSuitedTo], ['AHPRA', c.card.ahpra],
      ['Experience', [c.card.experience.rn, c.card.experience.olderPersons, c.card.experience.ausAgedCare].every(has) ? 'ok' : ''],
      ['Earliest start', c.card.earliestStart], ['Sponsorship', c.card.sponsorship], ['Shifts', c.card.shifts],
    ];
    facts.forEach(([label, v]) => need(has(v), `Key fact missing: ${label}`, 'card'));
    need(!tooLong(c.card.bestSuitedTo, 60), '“Best suited to” is over 60 characters', 'card');
    need(has(c.card.recommendation), 'Write the one-sentence recommendation', 'card-summary');
    need(!tooLong(c.card.recommendation, 160), 'Recommendation is over 160 characters', 'card-summary');
    need(c.card.watchouts.some(has), 'Every card needs at least one watch-out', 'card-summary');
    need(!c.card.strengths.some((s) => tooLong(s, 60)), 'A card strength is over 60 characters', 'card-summary');
    need(!c.card.watchouts.some((s) => tooLong(s, 60)), 'A card watch-out is over 60 characters', 'card-summary');
    return issues;
  },
};

/* ==========================================================================
   2. Storage — LocalStorageRepository
   --------------------------------------------------------------------------
   Every method is async (returns a Promise) on purpose: an API-backed
   repository has exactly the same interface, so the rest of the app does
   not change when storage moves to a server / HubSpot.
   ========================================================================== */
const STORAGE_KEY = 'nursiecare.cvbuilder.candidates.v1';
const SETTINGS_KEY = 'nursiecare.cvbuilder.settings.v1';

const storageAvailable = (() => {
  try {
    const k = '__nc_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) { return false; }
})();

const LocalStorageRepository = (() => {
  function readAll() {
    if (!storageAvailable) return {};
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return data && data.candidates ? data.candidates : {};
    } catch (e) {
      console.warn('Could not read saved candidates', e);
      return {};
    }
  }
  function writeAll(map) {
    if (!storageAvailable) throw new Error('This browser is blocking local storage.');
    // May throw QuotaExceededError (~5 MB limit) — the caller shows the message.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, candidates: map }));
  }
  const idNumber = (id) => { const m = /(\d+)\s*$/.exec(id || ''); return m ? Number(m[1]) : 0; };

  return {
    label: 'this browser',
    async list() {
      return Object.values(readAll())
        .map(CandidateModel.normalize)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    },
    async get(uid) {
      const raw = readAll()[uid];
      return raw ? CandidateModel.normalize(raw) : null;
    },
    async save(candidate) {
      const map = readAll();
      map[candidate.uid] = clone(candidate);
      writeAll(map);
      return candidate;
    },
    async remove(uid) {
      const map = readAll();
      delete map[uid];
      writeAll(map);
    },
    async nextId() {
      const max = Object.values(readAll()).reduce((m, c) => Math.max(m, idNumber(c.id)), 0);
      return 'NCR-' + String(max + 1).padStart(3, '0');
    },
    async importMany(list) {
      const map = readAll();
      list.forEach((raw) => { const c = CandidateModel.normalize(raw); map[c.uid] = c; });
      writeAll(map);
      return list.length;
    },
  };
})();

/*  Sketch of a future API repository (not used yet).
    Point it at a small serverless function that talks to HubSpot (or any
    database). NEVER put a HubSpot private-app token in browser code.

const ApiRepository = {
  label: 'Nursiecare database',
  base: '/api/candidates',
  async list()      { return (await fetch(this.base)).json(); },
  async get(uid)    { return (await fetch(`${this.base}/${uid}`)).json(); },
  async save(c)     { return (await fetch(`${this.base}/${c.uid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })).json(); },
  async remove(uid) { await fetch(`${this.base}/${uid}`, { method: 'DELETE' }); },
  async nextId()    { return (await fetch(`${this.base}/next-id`)).text(); },
  async importMany(list) { for (const c of list) await this.save(c); return list.length; },
};
*/

/** Swap this one line to change where candidates are stored. */
const Repository = LocalStorageRepository;

/** Per-browser preferences (zoom, last opened candidate, recruiter details) */
const Settings = {
  data: {},
  load() {
    try { this.data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { this.data = {}; }
  },
  set(key, value) {
    this.data[key] = value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  },
};

/* ==========================================================================
   3. CvRenderer — candidate → CV pages
   --------------------------------------------------------------------------
   build() turns the candidate into an ordered list of "blocks" (HTML
   fragments). paginate() pours those blocks into A4 pages, repeating the
   header and footer, splitting long tables/lists across pages and keeping
   headings with the content that follows.
   The CV's own styles live here (CV_THEME_CSS) so the preview, the print
   output and the downloaded HTML all share exactly the same design.
   ========================================================================== */
const CV_THEME_CSS = `
.cv-page{--navy:#1F3A5F;--teal:#2A7F7A;--grey:#7A7A7A;--tint:#EEF4F4;--line:#C9D6D6;
  position:relative;box-sizing:border-box;width:210mm;height:297mm;padding:20mm 20mm;background:#fff;overflow:hidden;
  font-family:Arial,"Helvetica Neue",Helvetica,"Liberation Sans",sans-serif;font-size:10pt;line-height:1.3;color:#1a1a1a;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;text-align:left}
.cv-page *{box-sizing:border-box}
.cv-head{position:absolute;top:12.5mm;left:20mm;right:20mm;display:flex;justify-content:space-between;align-items:baseline;
  border-bottom:.5pt solid var(--line);padding-bottom:4pt;font-size:8pt;color:var(--grey)}
.cv-head .brand{color:var(--teal);font-weight:bold;font-size:9pt}
.cv-foot{position:absolute;bottom:12.5mm;left:20mm;right:20mm;display:flex;justify-content:space-between;font-size:8pt;color:var(--grey)}
.cv-foot .ref{font-style:italic}
.cv-body{height:257mm;overflow:hidden;display:flow-root}
.cv-body>:first-child{margin-top:0!important}
.cv-page p{margin:0}
.kicker{color:var(--teal);font-size:9pt;font-weight:bold;letter-spacing:2pt;text-transform:uppercase;margin:0 0 1pt}
.cv-title{margin:0 0 8pt}
.cv-name{font-size:20pt;line-height:1.2;color:var(--navy);margin:0 0 2pt}
.cv-meta{font-size:11pt;color:var(--grey)}
.legend{font-size:9pt;color:var(--grey);margin:6pt 0 4pt!important}
.part-head{margin:10pt 0 6pt}
.part-title{font-size:16pt;font-weight:bold;color:var(--navy);line-height:1.2;margin:0 0 2pt}
.part-sub{font-size:9pt;font-style:italic;color:var(--grey)}
h2.sec{font-size:13pt;font-weight:bold;color:var(--navy);margin:14pt 0 6pt;padding-bottom:2pt;border-bottom:1pt solid var(--teal)}
h3.sub{font-size:10.5pt;font-weight:bold;color:var(--navy);margin:7pt 0 3pt}
.cv-page ul{margin:0 0 0;padding-left:20pt}
.cv-page li{margin:0 0 3pt;padding-left:2pt}
.cv-page table{width:100%;border-collapse:collapse;margin:0;table-layout:fixed}
.cv-page td,.cv-page th{border:.5pt solid var(--line);padding:3.5pt 5.5pt;vertical-align:top;text-align:left;font-weight:normal;overflow-wrap:break-word}
.cv-page p,.cv-page li,.cv-name{overflow-wrap:break-word}
table.kv th{width:31%;background:var(--tint);color:var(--navy);font-weight:bold}
table.grid thead th{background:var(--navy);color:#fff;font-weight:bold;border-color:var(--navy)}
table.grid tbody td{font-size:9.5pt}
table.split{margin-bottom:0}
.callout{background:var(--tint);border-left:3pt solid var(--teal);padding:5pt 9pt;margin:10pt 0 4pt}
.callout-title{font-size:10.5pt;font-weight:bold;color:var(--navy);margin-bottom:3pt}
.callout-body{font-size:9.5pt}
.checks-line{margin:0 0 4pt}
.note{font-size:8.5pt;font-style:italic;color:var(--grey);margin:3pt 0 0!important}
.ph{color:var(--grey);font-style:italic}
.ph.warn{color:#B45309}
.empty{color:#9AA5A5}
.sep{color:#1a1a1a}
.mk{display:inline-block;width:.95em;height:.95em;margin-left:2.5pt;vertical-align:-.1em;line-height:0}
.mk svg{width:100%;height:100%;display:block}
.mk.lead{margin:0 4pt 0 0}
.legend .mk{margin:0 1pt 0 0}
.mk-verified{color:var(--teal)}
.mk-reported{color:#B7791F}
.mk-pending{color:var(--grey)}
.badge{display:inline-block;padding:0 6pt;border-radius:8pt;font-size:8.5pt;font-weight:bold;line-height:14pt}
.badge-go{background:#E1F1EE;color:#1E6B66}
.badge-later{background:#FFF1D6;color:#8A5A00}
.badge-other{background:#EEF1F4;color:var(--navy)}
.job{margin:0 0 8pt;padding:0 0 6pt;border-bottom:.5pt solid var(--line)}
.job-top{display:flex;justify-content:space-between;gap:10pt;align-items:baseline}
.job-title{font-weight:bold;color:var(--navy);font-size:10.5pt}
.job-dates{font-size:9pt;color:var(--grey);white-space:nowrap}
.job-org{font-size:9.5pt;color:#444;margin:1pt 0 3pt!important}
.job-desc{font-size:9.5pt;margin:0 0 3pt!important}
.job ul{font-size:9.5pt}
.job ul li{margin-bottom:1.5pt}
`;

const CvRenderer = (() => {
  let prompts = true; // show grey [placeholders] for empty fields?

  const text = (s) => esc(String(s).trim()).replace(/\n/g, '<br>');
  const ph = (p) => (prompts ? `<span class="ph">[${esc(p)}]</span>` : '');
  const DASH = '<span class="empty">—</span>';
  const val = (v, p) => (has(v) ? text(v) : ph(p));
  const or = (html) => html || (prompts ? '' : DASH);

  /** Join segments with " · ". Segment = raw HTML string, or [value, placeholder, prefix, suffix] */
  function parts(list) {
    const out = list.map((item) => {
      if (typeof item === 'string') return item;
      const [v, p, pre = '', post = ''] = item;
      if (has(v)) return pre + text(v) + post;
      return prompts ? pre + ph(p) + post : '';
    }).filter(Boolean);
    return out.join('<span class="sep"> · </span>');
  }

  function marker(status, showPrompt) {
    if (MARKERS[status]) return markIcon(status);
    return showPrompt ? ` ${ph('✔/○')}` : '';
  }

  function badge(v) {
    if (!has(v)) return ph('Recommend interview / Future intake');
    const cls = /recommend/i.test(v) ? 'badge-go' : /future/i.test(v) ? 'badge-later' : 'badge-other';
    return `<span class="badge ${cls}">${esc(v)}</span>`;
  }

  const kvTable = (rows) =>
    `<table class="kv"><tbody>${rows.map(([label, html]) =>
      `<tr><th scope="row">${label}</th><td>${or(html)}</td></tr>`).join('')}</tbody></table>`;

  function gridTable(headers, widths, rows) {
    const cols = widths.map((w) => `<col style="width:${w}">`).join('');
    return `<table class="grid"><colgroup>${cols}</colgroup><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
      `<tbody>${rows.map((r) => `<tr>${r.map((cell) => `<td>${or(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  /** Bullet list from an array of strings; empty items become prompts */
  function bullets(items, placeholder) {
    const list = (items || []).map((v, i) => ({ v, i })).filter((x) => prompts || has(x.v));
    if (!list.length) return prompts ? `<ul><li>${ph(placeholder(0))}</li></ul>` : `<p>${DASH}</p>`;
    return `<ul>${list.map(({ v, i }) => `<li>${val(v, placeholder(i))}</li>`).join('')}</ul>`;
  }

  const yrs = (v, label) => (has(v) ? `${text(v)} ${Number(v) === 1 ? 'yr' : 'yrs'} ${label}` : (prompts ? `${ph('X')} yrs ${label}` : ''));

  /** Candidate → ordered list of blocks */
  function build(c) {
    const B = [];
    const add = (html, section, opts = {}) => B.push({ html, section, ...opts });
    let n = 0;
    const sec = (title, section) => add(`<h2 class="sec">${++n}. ${title}</h2>`, section, { keepWithNext: true });
    const sub = (title, section) => add(`<h3 class="sub">${title}</h3>`, section, { keepWithNext: true });
    const card = c.card;
    const mk = card.markers || {};
    const name = CandidateModel.displayName(c);

    // ---- Title block ---------------------------------------------------
    const consent = c.consentShared ? 'Shared with candidate consent'
      : (prompts ? '<span class="ph warn">[Candidate consent not yet recorded]</span>' : '');
    add(`<div class="cv-title"><div class="kicker">Candidate profile</div>
      <div class="cv-name">${name ? esc(name) : ph('First name + last initial')}</div>
      <div class="cv-meta">${parts([[c.id, 'NCR-000'], [formatDate(c.updatedAt), 'DD/MM/YYYY', 'Profile updated '], consent])}</div></div>`, 'details');

    add(`<p class="legend">Legend: ${markIcon('verified')} Verified by Nursiecare &nbsp;·&nbsp; ${markIcon('reported')} Candidate-reported &nbsp;·&nbsp; ${markIcon('pending')} Pending</p>`, 'details');

    // ---- PART A: Shortlist card ----------------------------------------
    add(`<div class="part-head"><div class="kicker">Part A</div><div class="part-title">Shortlist card</div>
      <div class="part-sub">Shown in the employer's applicant list. Should answer 'interview or not?' in under a minute.</div></div>`, 'card', { keepWithNext: true });

    const e = card.experience;
    const subjectTo = has(card.subjectTo) ? `, subject to ${text(card.subjectTo)}` : (prompts ? `, subject to ${ph('visa / notice')}` : '');
    add(kvTable([
      ['Status badge', badge(card.statusBadge)],
      ['Location', parts([[card.location, 'City, Country or onshore location'], [card.openTo, 'states / regions', 'Open to ']]) + marker(mk.location)],
      ['Best suited to', val(card.bestSuitedTo, 'Role + focus, ≤ 60 characters') + marker(mk.bestSuitedTo)],
      ['AHPRA', val(card.ahpra, 'General · conditions / Application in progress') + marker(mk.ahpra)],
      ['Experience', parts([yrs(e.rn, 'RN'), yrs(e.olderPersons, 'older persons'), yrs(e.ausAgedCare, 'Australian aged care')].filter(Boolean)) + marker(mk.experience)],
      ['Earliest start', (has(card.earliestStart) || prompts ? val(card.earliestStart, 'Month YYYY or notice period') + subjectTo : '') + marker(mk.earliestStart)],
      ['Sponsorship', parts([[card.sponsorship, 'Required / Not required'], [card.sponsorshipStatus, 'assessment status']]) + marker(mk.sponsorship)],
      ['Shifts', val(card.shifts, 'Which shifts; say clearly if no nights or weekends') + marker(mk.shifts)],
    ]), 'card', { splittable: true });

    add(`<div class="callout"><div class="callout-title">Recommendation</div>
      <div class="callout-body">${or(val(card.recommendation, 'One sentence, ≤ 160 characters: what they fit and the main support they need.'))}</div></div>`, 'card-summary');

    const countOf = (list) => (prompts ? list.length : list.filter(has).length);
    sub(`Strengths (${countOf(card.strengths)})`, 'card-summary');
    add(bullets(card.strengths, (i) => (i === 0 ? 'Strength 1, ≤ 60 characters' : `Strength ${i + 1}`)), 'card-summary', { splittable: true });
    sub(`Watch-outs (${countOf(card.watchouts)})`, 'card-summary');
    add(bullets(card.watchouts, (i) => (i === 0 ? 'Watch-out 1, ≤ 60 characters' : `Watch-out ${i + 1}`)), 'card-summary', { splittable: true });

    const ch = c.checks;
    sub('Checks line', 'checks');
    add(`<p class="checks-line">${[
      `AHPRA${marker(ch.ahpra, true)}`,
      `${has(ch.englishTest) ? esc(ch.englishTest) : (prompts ? ph('OET/IELTS') : 'English')}${marker(ch.english, true)}`,
      `References ${has(ch.references) ? esc(ch.references) : ph('x')}/2`,
      `Police check${marker(ch.police, true)}`,
      `Licence${marker(ch.licence, true)}`,
    ].join('<span class="sep"> · </span>')}</p>`, 'checks');

    // ---- PART B: Full profile ------------------------------------------
    add(`<div class="part-head"><div class="kicker">Part B</div><div class="part-title">Full profile</div>
      <div class="part-sub">Opens from the card. Read by the employer before and during the interview.</div></div>`, 'assessment', { breakBefore: true, keepWithNext: true });

    // 1. Recruiter assessment
    const a = c.assessment;
    sec('Recruiter assessment', 'assessment');
    sub('Strengths', 'assessment');
    add(bullets(a.strengths, (i) => (i === 0 ? "Longer, evidenced version of strength 1, with source, e.g. 'confirmed by referee'" : `Strength ${i + 1}`)), 'assessment', { splittable: true });
    sub('Watch-outs and suggested support', 'assessment');
    add(bullets(a.watchouts, (i) => (i === 0 ? "Gap + suggested support, e.g. 'No Australian aged care experience. Suggest 2–4 weeks of buddied shifts.'" : `Watch-out ${i + 1} + support`)), 'assessment', { splittable: true });
    sub('Suggested interview questions', 'assessment');
    add(bullets(a.questions, (i) => (i === 0 ? 'Scenario question tied to a watch-out' : `Question ${i + 1}`)), 'assessment', { splittable: true });

    // 2. Clinical experience
    const cl = c.clinical;
    sec('Clinical experience', 'clinical');
    add(kvTable([
      ['Current role', parts([[cl.currentRole, 'Title, unit, facility type and size, country'], [cl.employmentType, 'FT/PT'], [cl.practising, 'Currently practising / last practised MM/YYYY']])],
      ['Summary', val(cl.summary, '2–3 factual sentences: population, acuity, responsibility, leadership')],
      ['Typical shift', val(cl.typicalShift, 'Ratio, acuity, staff supervised')],
      ['Systems', val(cl.systems, 'Electronic / paper care plans; medication system')],
    ]), 'clinical', { splittable: true });

    // (optional) Employment history — only when entries exist
    const jobs = c.employmentHistory.filter((j) => Object.entries(j).some(([k, v]) => k !== 'current' && has(v)));
    if (jobs.length) {
      sec('Employment history', 'employment');
      jobs.forEach((j) => {
        const dates = [formatMonth(j.start), j.current ? 'Present' : formatMonth(j.end)].filter(has).join(' – ');
        const resp = (j.responsibilities || '').split('\n').map((s) => s.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean);
        add(`<div class="job">
          <div class="job-top"><span class="job-title">${val(j.position, 'Position')}</span><span class="job-dates">${esc(dates)}</span></div>
          <p class="job-org">${parts([[j.facility, 'Company / facility'], [j.location, 'Location']])}</p>
          ${has(j.description) ? `<p class="job-desc">${text(j.description)}</p>` : ''}
          ${resp.length ? `<ul>${resp.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        </div>`, 'employment');
      });
    }

    // 3. Capability highlights
    sec('Capability highlights', 'capabilities');
    const caps = c.capabilities.filter((r) => prompts || has(r.capability) || has(r.practice) || has(r.evidence));
    const capRows = (caps.length ? caps : [LIST_ITEM_BLANKS.capability]).map((r, i) => [
      val(r.capability, `Capability ${i + 1}`), val(r.practice, 'Regular / Occasional / Limited'), val(r.evidence, 'Evidence'),
    ]);
    add(gridTable(['Capability', 'Recent practice', 'Evidence'], ['30%', '17.5%', '52.5%'], capRows), 'capabilities', { splittable: true });
    if (prompts) {
      add(`<p class="note">Pick the 6 most relevant to aged care. Regular / Occasional / Limited. Include at least one Limited row if it's true: it shows honesty and helps the employer plan orientation.</p>`, 'capabilities');
    }

    // (optional) Qualifications & registrations — only when entries exist
    const quals = c.qualifications.filter((q) => Object.values(q).some(has));
    const regs = c.registrations.filter((r) => Object.values(r).some(has));
    if (quals.length || regs.length) {
      sec('Qualifications and registrations', 'qualifications');
      if (quals.length) {
        if (regs.length) sub('Qualifications', 'qualifications');
        add(gridTable(['Qualification', 'Institution', 'Year'], ['42%', '43%', '15%'],
          quals.map((q) => [val(q.qualification, 'Qualification'), val(q.institution, 'Institution'), val(q.year, 'YYYY')])), 'qualifications', { splittable: true });
      }
      if (regs.length) {
        if (quals.length) sub('Registrations and certifications', 'qualifications');
        add(gridTable(['Registration / certification', 'Number', 'Expiry', 'Status'], ['42%', '24%', '18%', '16%'],
          regs.map((r) => [val(r.name, 'Name'), val(r.number, 'Number'), val(formatInputDate(r.expiry), 'DD/MM/YYYY'),
            MARKERS[r.status] ? `${marker(r.status)} ${MARKERS[r.status].label.replace(' by Nursiecare', '')}` : ph('Status')])), 'qualifications', { splittable: true });
      }
    }

    // 4. Verification
    sec('Verification', 'verification');
    add(gridTable(['Item', 'Status'], ['30%', '70%'], VERIFICATION_ITEMS.map(([key, label, hint]) => {
      const v = c.verification[key] || {};
      const m = markIcon(v.status, 'lead');
      const note = has(v.note) ? text(v.note) : (m ? '' : ph(hint));
      return [label, (m + note) || ''];
    })), 'verification', { splittable: true });

    // 5. Work preferences
    const p = c.preferences;
    sec('Work preferences', 'preferences');
    add(kvTable([
      ['Role', val(p.role, 'RN / Senior RN / Clinical Lead')],
      ['Hours', val(p.hours, 'FT / PT, hours')],
      ['Shifts', val(p.shifts, 'Detail')],
      ['Pay', val(p.pay, 'Range / Award or EA rate')],
    ]), 'preferences', { splittable: true });

    // 6. Readiness and communication
    const r = c.readiness;
    sec('Readiness and communication', 'readiness');
    add(kvTable([
      ['Aged care prep', has(r.agedCarePrep) ? `${esc(r.agedCarePrep)} of 10 Nursiecare modules` : ph('X of 10 Nursiecare modules')],
      ['English', val(r.english, 'OET / IELTS result / Exempt')],
      ['Our interview', val(r.interview, 'DD/MM/YYYY, format, length')],
      ['What we saw', val(r.whatWeSaw, '1–2 observed behaviours, not ratings')],
      ['Intro video', val(r.introVideo, 'Available / Not available')],
    ]), 'readiness', { splittable: true });
    add(`<p class="note">Nursiecare's aged care preparation does not replace the employer's site orientation, competency assessment and supervision.</p>`, 'readiness');

    // 7. Relocation and visa
    const rl = c.relocation;
    sec('Relocation and visa', 'relocation');
    add(kvTable([
      ['Relocating', parts([[rl.relocating, 'Alone / with partner / with family'], [rl.commitment, 'commitment sought']])],
      ['Areas', val(rl.areas, 'Specific towns discussed')],
      ['Support needed', val(rl.supportNeeded, 'Accommodation / transport / childcare / partner work / none')],
      ['Driving', val(rl.driving, 'Licence status · drives regularly')],
      ['Visa', val(rl.visa, 'Onshore/offshore · current visa · pathway · agent assessment status')],
      ['Mobilisation', val(rl.mobilisation, 'X–Y months from offer')],
    ]), 'relocation', { splittable: true });
    add(`<p class="note">Visa eligibility, costs, employer obligations and timeframes must be confirmed by a registered migration agent. Nothing here is migration advice.</p>`, 'relocation');

    // 8. Nursiecare support
    const s = c.support;
    sec('Nursiecare support', 'support');
    add(kvTable([
      ['Support included', val(s.included, 'Interview coordination, visa liaison, settlement support, 30/60/90-day check-ins')],
      ['Your recruiter', parts([[s.recruiterName, 'Name'], [s.recruiterEmail, 'email'], [s.recruiterPhone, 'phone']])],
    ]), 'support', { splittable: true });

    return B;
  }

  /* ---------------- Pagination ---------------- */
  const overflows = (body) => body.scrollHeight > body.clientHeight + 1;

  function toElement(block) {
    const t = document.createElement('template');
    t.innerHTML = block.html.trim();
    const el = t.content.firstElementChild;
    el.dataset.section = block.section || '';
    if (block.keepWithNext) el.dataset.kwn = '1';
    return el;
  }

  /** Move as many rows/items of a table or list as fit onto the current page. */
  function splitInto(body, el) {
    const isTable = el.tagName === 'TABLE';
    const list = isTable ? el.tBodies[0] : (el.tagName === 'UL' ? el : null);
    if (!list || list.children.length < 2) return false;
    const piece = el.cloneNode(false);
    let target = piece;
    if (isTable) {
      const cg = el.querySelector('colgroup');
      if (cg) piece.appendChild(cg.cloneNode(true));
      if (el.tHead) piece.appendChild(el.tHead.cloneNode(true));
      target = document.createElement('tbody');
      piece.appendChild(target);
    }
    piece.classList.add('split');
    body.appendChild(piece);
    let moved = 0;
    while (list.children.length > 1) {
      const item = list.firstElementChild;
      target.appendChild(item);
      if (overflows(body)) { list.insertBefore(item, list.firstElementChild); break; }
      moved++;
    }
    if (!moved) { piece.remove(); return false; }
    el.classList.add('cont');
    return true;
  }

  function pageShell(meta) {
    const page = document.createElement('div');
    page.className = 'cv-page';
    page.innerHTML =
      `<div class="cv-head"><span class="brand">Nursiecare</span><span>Confidential — prepared for prospective employers only</span></div>
       <div class="cv-body"></div>
       <div class="cv-foot"><span class="ref">${meta.ref}</span><span class="pno"></span></div>`;
    return page;
  }

  /** Render the candidate into A4 page elements (built inside `measureEl`). */
  function renderPages(candidate, { showPrompts = true, measureEl }) {
    prompts = showPrompts;
    const name = CandidateModel.displayName(candidate);
    const meta = {
      ref: `${esc(candidate.id) || (prompts ? '[NCR-000]' : '')}${name || prompts ? ' · ' : ''}${esc(name) || (prompts ? '[First name + last initial]' : '')}`,
    };
    measureEl.innerHTML = '';
    const pages = [];
    const newPage = () => {
      const p = pageShell(meta);
      measureEl.appendChild(p);
      pages.push(p);
      return p.querySelector('.cv-body');
    };

    let body = newPage();
    const queue = build(candidate).map((b) => ({ ...b, el: toElement(b) }));

    for (let i = 0; i < queue.length; i++) {
      const b = queue[i];
      if (b.breakBefore && body.children.length) body = newPage();
      body.appendChild(b.el);
      if (!overflows(body)) continue;

      body.removeChild(b.el);
      const placedSome = b.splittable && splitInto(body, b.el);
      if (!placedSome) {
        if (!body.children.length) { body.appendChild(b.el); continue; } // taller than a page: accept
        // keep headings with the block that follows them
        const carry = [];
        if (!b.carried) {
          while (body.children.length > 1 && body.lastElementChild.dataset.kwn === '1') {
            carry.unshift(body.removeChild(body.lastElementChild));
          }
        }
        body = newPage();
        carry.forEach((el) => body.appendChild(el));
        queue[i] = { ...b, breakBefore: false, carried: true };
      } else {
        body = newPage();
        queue[i] = { ...b, breakBefore: false, carried: false };
      }
      i--; // place the (remaining) block on the new page
    }

    pages.forEach((p, idx) => { p.querySelector('.pno').textContent = `Page ${idx + 1}`; });
    return pages;
  }

  /** Plain-text version of the profile (for "Copy CV") */
  function toPlainText(c) {
    const L = [];
    const line = (label, v) => { if (has(v)) L.push(`${label}: ${String(v).trim()}`); };
    const list = (title, items) => {
      const f = (items || []).filter(has);
      if (f.length) { L.push('', title); f.forEach((x) => L.push(`• ${String(x).trim()}`)); }
    };
    const mk = (s) => (MARKERS[s] ? ` ${MARKERS[s].symbol}` : '');
    const card = c.card; const e = card.experience;
    L.push('CANDIDATE PROFILE', CandidateModel.displayName(c), [c.id, c.updatedAt ? `Profile updated ${formatDate(c.updatedAt)}` : '', c.consentShared ? 'Shared with candidate consent' : ''].filter(Boolean).join(' · '));
    L.push('', 'PART A — SHORTLIST CARD');
    line('Status', card.statusBadge);
    line('Location', [card.location, has(card.openTo) ? `Open to ${card.openTo}` : ''].filter(Boolean).join(' · ') + mk(card.markers.location));
    line('Best suited to', card.bestSuitedTo);
    line('AHPRA', card.ahpra + mk(card.markers.ahpra));
    line('Experience', [has(e.rn) ? `${e.rn} yrs RN` : '', has(e.olderPersons) ? `${e.olderPersons} yrs older persons` : '', has(e.ausAgedCare) ? `${e.ausAgedCare} yrs Australian aged care` : ''].filter(Boolean).join(' · '));
    line('Earliest start', [card.earliestStart, has(card.subjectTo) ? `subject to ${card.subjectTo}` : ''].filter(Boolean).join(', '));
    line('Sponsorship', [card.sponsorship, card.sponsorshipStatus].filter(has).join(' · '));
    line('Shifts', card.shifts);
    if (has(card.recommendation)) L.push('', 'Recommendation', card.recommendation.trim());
    list('Strengths', card.strengths);
    list('Watch-outs', card.watchouts);
    const ch = c.checks;
    L.push('', `Checks: AHPRA${mk(ch.ahpra)} · ${ch.englishTest || 'English'}${mk(ch.english)} · References ${ch.references || '?'}/2 · Police check${mk(ch.police)} · Licence${mk(ch.licence)}`);
    L.push('', 'PART B — FULL PROFILE');
    list('Recruiter assessment — strengths', c.assessment.strengths);
    list('Watch-outs and suggested support', c.assessment.watchouts);
    list('Suggested interview questions', c.assessment.questions);
    L.push('', 'Clinical experience');
    line('Current role', [c.clinical.currentRole, c.clinical.employmentType, c.clinical.practising].filter(has).join(' · '));
    line('Summary', c.clinical.summary); line('Typical shift', c.clinical.typicalShift); line('Systems', c.clinical.systems);
    c.employmentHistory.filter((j) => has(j.position) || has(j.facility)).forEach((j, i) => {
      if (i === 0) L.push('', 'Employment history');
      L.push(`${j.position} — ${[j.facility, j.location].filter(has).join(', ')} (${[formatMonth(j.start), j.current ? 'Present' : formatMonth(j.end)].filter(has).join(' – ')})`);
      if (has(j.description)) L.push(j.description.trim());
      (j.responsibilities || '').split('\n').filter(has).forEach((r) => L.push(`  • ${r.replace(/^[\s•\-*]+/, '').trim()}`));
    });
    const caps = c.capabilities.filter((r) => has(r.capability));
    if (caps.length) { L.push('', 'Capability highlights'); caps.forEach((r) => L.push(`• ${r.capability} — ${r.practice || '?'}${has(r.evidence) ? `: ${r.evidence}` : ''}`)); }
    const quals = c.qualifications.filter((q) => has(q.qualification));
    if (quals.length) { L.push('', 'Qualifications'); quals.forEach((q) => L.push(`• ${q.qualification}${has(q.institution) ? `, ${q.institution}` : ''}${has(q.year) ? ` (${q.year})` : ''}`)); }
    const regs = c.registrations.filter((r) => has(r.name));
    if (regs.length) { L.push('', 'Registrations and certifications'); regs.forEach((r) => L.push(`• ${r.name}${has(r.number) ? ` — ${r.number}` : ''}${has(r.expiry) ? `, expires ${formatInputDate(r.expiry)}` : ''}${mk(r.status)}`)); }
    L.push('', 'Verification');
    VERIFICATION_ITEMS.forEach(([k, label]) => { const v = c.verification[k]; if (v && (has(v.note) || v.status)) L.push(`${label}:${mk(v.status)} ${v.note || ''}`.trim()); });
    L.push('', 'Work preferences');
    line('Role', c.preferences.role); line('Hours', c.preferences.hours); line('Shifts', c.preferences.shifts); line('Pay', c.preferences.pay);
    L.push('', 'Readiness and communication');
    line('Aged care prep', has(c.readiness.agedCarePrep) ? `${c.readiness.agedCarePrep} of 10 Nursiecare modules` : '');
    line('English', c.readiness.english); line('Our interview', c.readiness.interview); line('What we saw', c.readiness.whatWeSaw); line('Intro video', c.readiness.introVideo);
    L.push('', 'Relocation and visa');
    line('Relocating', [c.relocation.relocating, c.relocation.commitment].filter(has).join(' · '));
    line('Areas', c.relocation.areas); line('Support needed', c.relocation.supportNeeded); line('Driving', c.relocation.driving); line('Visa', c.relocation.visa); line('Mobilisation', c.relocation.mobilisation);
    L.push('', 'Nursiecare support');
    line('Support included', c.support.included);
    line('Your recruiter', [c.support.recruiterName, c.support.recruiterEmail, c.support.recruiterPhone].filter(has).join(' · '));
    return L.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  return { renderPages, toPlainText };
})();

/* ==========================================================================
   4. FormController — right-hand editor ↔ candidate object
   --------------------------------------------------------------------------
   Every input carries data-bind="path.in.candidate". Typing writes into the
   candidate object and asks the App to re-render. Repeatable sections are
   <div data-list="path" data-kind="…"> containers rendered from templates.
   ========================================================================== */
const ICONS = {
  up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  remove: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

const FormController = (() => {
  let root; let getCandidate; let onChange;

  const markerButtons = () => Object.entries(MARKERS).map(([value, m]) =>
    `<button type="button" data-value="${value}" title="${m.label}" aria-label="${m.label}"><svg viewBox="0 0 12 12" aria-hidden="true">${MARKER_SVG[value]}</svg></button>`).join('');

  function enhance(scope) {
    $$('.marker', scope).forEach((m) => {
      if (!m.children.length) { m.innerHTML = markerButtons(); m.setAttribute('role', 'group'); }
    });
    $$('[data-limit]', scope).forEach((el) => {
      if (!(el.nextElementSibling && el.nextElementSibling.classList.contains('counter'))) {
        el.insertAdjacentHTML('afterend', '<span class="counter" aria-live="polite"></span>');
      }
    });
  }

  function updateCounter(el) {
    const counter = el.nextElementSibling;
    if (!counter || !counter.classList.contains('counter')) return;
    const limit = Number(el.dataset.limit);
    const len = (el.value || '').trim().length;
    counter.textContent = `${len} / ${limit}`;
    counter.classList.toggle('over', len > limit);
    el.classList.toggle('is-over', len > limit);
  }

  function syncMarker(m, value) {
    $$('button', m).forEach((b) => {
      const on = b.dataset.value === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------- Repeatable list templates ---------- */
  function tools(i, total) {
    return `<div class="li-tools">
      <button type="button" class="icon-btn" data-action="up" ${i === 0 ? 'disabled' : ''} title="Move up" aria-label="Move up">${ICONS.up}</button>
      <button type="button" class="icon-btn" data-action="down" ${i === total - 1 ? 'disabled' : ''} title="Move down" aria-label="Move down">${ICONS.down}</button>
      <button type="button" class="icon-btn danger" data-action="remove" title="Remove" aria-label="Remove">${ICONS.remove}</button>
    </div>`;
  }

  function itemHTML(kind, path, i, total, opts) {
    const p = `${path}.${i}`;
    const lim = opts.limit ? ` data-limit="${opts.limit}"` : '';
    const label = opts.itemLabel || 'Item';
    switch (kind) {
      case 'text':
        return `<div class="li" data-index="${i}"><div class="li-main"><input type="text" data-bind="${p}" placeholder="${esc(label)} ${i + 1}"${lim}></div>${tools(i, total)}</div>`;
      case 'textarea':
        return `<div class="li" data-index="${i}"><div class="li-main"><textarea rows="2" data-bind="${p}" placeholder="${esc(i === 0 && opts.firstHint ? opts.firstHint : `${label} ${i + 1}`)}"${lim}></textarea></div>${tools(i, total)}</div>`;
      case 'capability':
        return `<div class="li-card" data-index="${i}">
          <div class="li-card-head"><span>Capability ${i + 1}</span>${tools(i, total)}</div>
          <div class="grid-2 grid-wide-first">
            <input type="text" data-bind="${p}.capability" placeholder="e.g. Dementia care">
            <select data-bind="${p}.practice"><option value="">Recent practice…</option><option>Regular</option><option>Occasional</option><option>Limited</option></select>
          </div>
          <textarea rows="2" data-bind="${p}.evidence" placeholder="Evidence, e.g. 30-bed dementia unit, 4 yrs; confirmed by referee"></textarea>
        </div>`;
      case 'employment':
        return `<div class="li-card" data-index="${i}">
          <div class="li-card-head"><span>Role ${i + 1}</span>${tools(i, total)}</div>
          <label class="field"><span class="label">Position</span><input type="text" data-bind="${p}.position" placeholder="e.g. Registered Nurse"></label>
          <div class="grid-2">
            <label class="field"><span class="label">Company / facility</span><input type="text" data-bind="${p}.facility"></label>
            <label class="field"><span class="label">Location</span><input type="text" data-bind="${p}.location" placeholder="City, Country"></label>
          </div>
          <div class="grid-2">
            <label class="field"><span class="label">Start</span><input type="month" data-bind="${p}.start"></label>
            <label class="field"><span class="label">End</span><input type="month" data-bind="${p}.end"></label>
          </div>
          <label class="check"><input type="checkbox" data-bind="${p}.current"> Current role (shows “Present”)</label>
          <label class="field"><span class="label">Description</span><textarea rows="2" data-bind="${p}.description" placeholder="Unit, population, acuity"></textarea></label>
          <label class="field"><span class="label">Responsibilities <em>one per line</em></span><textarea rows="3" data-bind="${p}.responsibilities" placeholder="Medication rounds for 20 residents&#10;Supervised 4 care staff per shift"></textarea></label>
        </div>`;
      case 'qualification':
        return `<div class="li-card" data-index="${i}">
          <div class="li-card-head"><span>Qualification ${i + 1}</span>${tools(i, total)}</div>
          <input type="text" data-bind="${p}.qualification" placeholder="Qualification, e.g. Bachelor of Science in Nursing">
          <div class="grid-2 grid-wide-first">
            <input type="text" data-bind="${p}.institution" placeholder="Institution">
            <input type="text" data-bind="${p}.year" placeholder="Year" inputmode="numeric" maxlength="4">
          </div>
        </div>`;
      case 'registration':
        return `<div class="li-card" data-index="${i}">
          <div class="li-card-head"><span>Registration ${i + 1}</span>${tools(i, total)}</div>
          <input type="text" data-bind="${p}.name" placeholder="e.g. AHPRA Registered Nurse, BLS certificate">
          <div class="grid-2">
            <label class="field"><span class="label">Registration number</span><input type="text" data-bind="${p}.number" placeholder="If applicable"></label>
            <label class="field"><span class="label">Expiry date</span><input type="date" data-bind="${p}.expiry"></label>
          </div>
          <div class="label-row"><span class="label">Status</span><div class="marker" data-bind="${p}.status"></div></div>
        </div>`;
      default:
        return '';
    }
  }

  function renderList(container) {
    const path = container.dataset.list;
    const kind = container.dataset.kind;
    const items = getPath(getCandidate(), path) || [];
    const opts = {
      limit: container.dataset.limit, itemLabel: container.dataset.itemLabel, firstHint: container.dataset.firstHint,
    };
    container.innerHTML =
      `<div class="list-items">${items.map((_, i) => itemHTML(kind, path, i, items.length, opts)).join('')}</div>` +
      (items.length ? '' : `<p class="list-empty">${esc(container.dataset.empty || 'Nothing added yet.')}</p>`) +
      `<button type="button" class="btn-add" data-action="add">${ICONS.plus}<span>${esc(container.dataset.add || 'Add')}</span></button>`;
    enhance(container);
    fill(container);
  }

  /** Copy values from the candidate into every bound control inside `scope` */
  function fill(scope) {
    const c = getCandidate();
    $$('[data-bind]', scope).forEach((el) => {
      const v = getPath(c, el.dataset.bind);
      if (el.classList.contains('marker')) syncMarker(el, v || '');
      else if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
      if (el.dataset.limit) updateCounter(el);
    });
    // "Current role" disables the End date
    $$('[data-bind$=".current"]', scope).forEach((cb) => {
      const end = cb.closest('.li-card')?.querySelector('[data-bind$=".end"]');
      if (end) end.disabled = cb.checked;
    });
  }

  function handleInput(e) {
    const el = e.target.closest('[data-bind]');
    if (!el || el.classList.contains('marker')) return;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    setPath(getCandidate(), el.dataset.bind, value);
    if (el.dataset.limit) updateCounter(el);
    if (el.type === 'checkbox' && el.dataset.bind.endsWith('.current')) {
      const end = el.closest('.li-card')?.querySelector('[data-bind$=".end"]');
      if (end) end.disabled = el.checked;
    }
    onChange();
  }

  function handleClick(e) {
    // Fact markers ✔ ◐ ○ (click again to clear)
    const mb = e.target.closest('.marker button');
    if (mb) {
      const m = mb.parentElement;
      const current = getPath(getCandidate(), m.dataset.bind) || '';
      const next = current === mb.dataset.value ? '' : mb.dataset.value;
      setPath(getCandidate(), m.dataset.bind, next);
      syncMarker(m, next);
      onChange();
      return;
    }
    // Repeatable list actions
    const btn = e.target.closest('[data-action]');
    const container = btn && btn.closest('[data-list]');
    if (!container) return;
    const path = container.dataset.list;
    const list = getPath(getCandidate(), path) || [];
    const idx = Number(btn.closest('[data-index]')?.dataset.index);
    switch (btn.dataset.action) {
      case 'add': list.push(CandidateModel.newListItem(container.dataset.kind)); break;
      case 'remove': list.splice(idx, 1); break;
      case 'up': if (idx > 0) [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]; break;
      case 'down': if (idx < list.length - 1) [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]]; break;
      default: return;
    }
    setPath(getCandidate(), path, list);
    renderList(container);
    if (btn.dataset.action === 'add') {
      const items = $$('.list-items > *', container);
      const first = items[items.length - 1]?.querySelector('input, textarea, select');
      if (first) first.focus();
    }
    onChange();
  }

  return {
    init(rootEl, candidateGetter, changeHandler) {
      root = rootEl; getCandidate = candidateGetter; onChange = changeHandler;
      enhance(root);
      root.addEventListener('input', handleInput);
      root.addEventListener('change', handleInput);
      root.addEventListener('click', handleClick);
    },
    /** Load the whole candidate into the editor */
    populate() {
      $$('[data-list]', root).forEach(renderList);
      fill(root);
    },
    openSection(section, { focus = false } = {}) {
      const d = $(`.ed-section[data-section="${section}"]`, root);
      if (!d) return;
      d.open = true;
      d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash');
      if (focus) setTimeout(() => d.querySelector('input, textarea, select')?.focus({ preventScroll: true }), 350);
    },
  };
})();

/* ==========================================================================
   5. App — toolbar, library, printing, exporting, UI state
   ========================================================================== */
const App = (() => {
  const state = {
    candidate: null,
    dirty: false,
    showPrompts: true,
    zoom: 'fit',
    renderTimer: null,
  };
  const els = {};

  /* ---------- Toasts & dialogs ---------- */
  function toast(msg, kind = 'ok') {
    const t = els.toast;
    t.textContent = msg;
    t.className = `toast show ${kind}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }
  const confirmDiscard = () => !state.dirty || confirm('You have unsaved changes to this candidate. Discard them?');

  /* ---------- Rendering ---------- */
  function render() {
    clearTimeout(state.renderTimer);
    const c = state.candidate;
    const pages = CvRenderer.renderPages(c, { showPrompts: state.showPrompts, measureEl: els.measure });
    els.pages.replaceChildren(...pages);
    els.pageCount.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'}`;
    applyZoom();
    updateChrome();
    renderChecks();
  }
  const scheduleRender = () => { clearTimeout(state.renderTimer); state.renderTimer = setTimeout(render, 90); };

  function applyZoom() {
    const PAGE_PX = 794; // 210mm at 96dpi
    let z = Number(state.zoom);
    if (state.zoom === 'fit') {
      const avail = els.previewScroll.clientWidth - 48;
      z = Math.max(0.35, Math.min(1, avail / PAGE_PX));
    }
    els.pages.style.zoom = z;
  }

  function updateChrome() {
    const c = state.candidate;
    const name = CandidateModel.displayName(c) || 'New candidate';
    els.currentName.textContent = name;
    els.currentId.textContent = c.id || 'No ID';
    els.editorTitle.textContent = CandidateModel.fullName(c) || 'New candidate';
    els.updatedOut.textContent = c.updatedAt ? `${formatDate(c.updatedAt)} ${new Date(c.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not saved yet';
    const s = els.saveState;
    if (state.dirty) { s.textContent = c.updatedAt ? 'Unsaved changes' : 'Not saved'; s.className = 'pill pill-warn'; }
    else { s.textContent = 'Saved'; s.className = 'pill pill-ok'; }
    document.title = `${c.id ? c.id + ' · ' : ''}${CandidateModel.displayName(c) || 'New candidate'} — Candidate Profile`;
  }

  function renderChecks() {
    const issues = CandidateModel.checks(state.candidate);
    els.checksCount.textContent = issues.length ? `${issues.length} to review` : 'All good';
    els.checksBox.classList.toggle('ok', !issues.length);
    els.checksList.innerHTML = issues.map((i) =>
      `<li><button type="button" data-goto="${i.section}">${esc(i.msg)}</button></li>`).join('') ||
      '<li class="done">Card complete: key facts, recommendation and watch-outs are in place.</li>';
  }

  function markDirty() { state.dirty = true; updateChrome(); scheduleRender(); }

  /* ---------- Candidate lifecycle ---------- */
  function setCandidate(c, { dirty = false } = {}) {
    state.candidate = c;
    state.dirty = dirty;
    FormController.populate();
    render();
  }

  async function newCandidate() {
    if (!confirmDiscard()) return;
    const c = CandidateModel.blank(await Repository.nextId());
    if (Settings.data.recruiter) Object.assign(c.support, Settings.data.recruiter);
    setCandidate(c, { dirty: true });
    FormController.openSection('details', { focus: true });
    toast('New candidate started');
  }

  async function save() {
    const c = state.candidate;
    const now = new Date().toISOString();
    const prev = { createdAt: c.createdAt, updatedAt: c.updatedAt };
    c.createdAt = c.createdAt || now;
    c.updatedAt = now;
    try {
      const existing = (await Repository.list()).find((o) => o.id === c.id && o.uid !== c.uid && has(c.id));
      if (existing && !confirm(`Another saved candidate already uses the ID ${c.id} (${CandidateModel.fullName(existing) || 'unnamed'}). Save anyway?`)) {
        Object.assign(c, prev);
        return;
      }
      await Repository.save(c);
      state.dirty = false;
      Settings.set('lastOpened', c.uid);
      Settings.set('recruiter', { recruiterName: c.support.recruiterName, recruiterEmail: c.support.recruiterEmail, recruiterPhone: c.support.recruiterPhone, included: c.support.included });
      render();
      refreshLibraryCount();
      toast(`Saved ${c.id || 'candidate'}`);
    } catch (err) {
      Object.assign(c, prev);
      console.error(err);
      toast(/quota/i.test(err.name + err.message) ? 'Browser storage is full. Export a backup and delete old candidates.' : `Could not save: ${err.message}`, 'error');
    }
  }

  async function load(uid) {
    if (uid !== state.candidate.uid && !confirmDiscard()) return false;
    const c = await Repository.get(uid);
    if (!c) { toast('Candidate not found', 'error'); return false; }
    setCandidate(c);
    Settings.set('lastOpened', uid);
    toast(`Opened ${c.id} · ${CandidateModel.displayName(c)}`);
    return true;
  }

  async function removeCandidate(uid) {
    const c = await Repository.get(uid) || (state.candidate.uid === uid ? state.candidate : null);
    const label = c ? `${c.id || ''} ${CandidateModel.fullName(c)}`.trim() : 'this candidate';
    if (!confirm(`Delete ${label || 'this candidate'}? This cannot be undone.`)) return;
    await Repository.remove(uid);
    refreshLibraryCount();
    if (state.candidate.uid === uid) {
      state.dirty = false;
      const c2 = CandidateModel.blank(await Repository.nextId());
      if (Settings.data.recruiter) Object.assign(c2.support, Settings.data.recruiter);
      setCandidate(c2, { dirty: true });
    }
    toast('Candidate deleted');
    if (els.library.open) renderLibrary();
  }

  function clearForm() {
    if (!confirm('Clear every field for this candidate? The ID is kept. Nothing is deleted until you save.')) return;
    const old = state.candidate;
    const c = CandidateModel.blank(old.id);
    c.uid = old.uid; c.createdAt = old.createdAt; c.updatedAt = old.updatedAt;
    if (Settings.data.recruiter) Object.assign(c.support, Settings.data.recruiter);
    setCandidate(c, { dirty: true });
    toast('Form cleared');
  }

  /* ---------- Library (saved candidates) ---------- */
  async function refreshLibraryCount() {
    const n = (await Repository.list()).length;
    els.libCount.textContent = n;
  }

  async function renderLibrary() {
    const q = els.libSearch.value.trim().toLowerCase();
    const all = await Repository.list();
    const rows = all.filter((c) => !q || [c.id, CandidateModel.fullName(c), c.card.bestSuitedTo, c.card.location, c.card.statusBadge]
      .join(' ').toLowerCase().includes(q));
    els.libMeta.textContent = `${all.length} saved in ${Repository.label}`;
    if (!all.length) {
      els.libList.innerHTML = `<div class="lib-empty"><p><strong>No saved candidates yet.</strong></p>
        <p>Fill in the profile and press <em>Save</em>, or load the example to see a completed profile.</p>
        <button type="button" class="btn" data-lib="example">Load example candidate</button></div>`;
      return;
    }
    if (!rows.length) { els.libList.innerHTML = '<div class="lib-empty"><p>No candidates match your search.</p></div>'; return; }
    els.libList.innerHTML = `<table class="lib-table"><thead><tr><th>ID</th><th>Candidate</th><th>Best suited to</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${
      rows.map((c) => `<tr data-uid="${esc(c.uid)}" class="${c.uid === state.candidate.uid ? 'current' : ''}">
        <td class="mono">${esc(c.id)}</td>
        <td><strong>${esc(CandidateModel.fullName(c) || '(no name)')}</strong><span class="sub">${esc(c.card.location)}</span></td>
        <td>${esc(c.card.bestSuitedTo)}</td>
        <td>${c.card.statusBadge ? `<span class="tag ${/recommend/i.test(c.card.statusBadge) ? 'tag-go' : 'tag-later'}">${esc(c.card.statusBadge)}</span>` : ''}</td>
        <td class="nowrap">${formatDate(c.updatedAt)}</td>
        <td class="nowrap actions-cell"><button type="button" class="btn btn-sm" data-lib="open">Open</button><button type="button" class="icon-btn danger" data-lib="delete" title="Delete" aria-label="Delete">${ICONS.remove}</button></td>
      </tr>`).join('')}</tbody></table>`;
  }

  async function openLibrary() {
    els.libSearch.value = '';
    await renderLibrary();
    els.library.showModal();
    setTimeout(() => els.libSearch.focus(), 50);
  }

  /* ---------- Output: print, HTML download, copy, backup ---------- */
  function fileBase() {
    const c = state.candidate;
    return [c.id, CandidateModel.displayName(c).replace(/\./g, ''), 'candidate-profile'].filter(Boolean).join('_').replace(/\s+/g, '-');
  }

  function printCv() {
    const issues = CandidateModel.checks(state.candidate);
    if (issues.length && !confirm(`${issues.length} profile check${issues.length > 1 ? 's' : ''} still open (e.g. “${issues[0].msg}”). Print anyway?`)) return;
    window.print(); // beforeprint/afterprint hide the [placeholders] while printing
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function cleanPagesHtml() {
    const tmp = document.createElement('div');
    tmp.className = 'cv-measure';
    document.body.appendChild(tmp);
    const pages = CvRenderer.renderPages(state.candidate, { showPrompts: false, measureEl: tmp });
    const html = pages.map((p) => { p.querySelectorAll('[data-section],[data-kwn]').forEach((el) => { el.removeAttribute('data-section'); el.removeAttribute('data-kwn'); }); return p.outerHTML; }).join('\n');
    tmp.remove();
    return html;
  }

  function downloadHtml() {
    const title = `${state.candidate.id} ${CandidateModel.displayName(state.candidate)} — Candidate Profile`.trim();
    const exportCss = `body{margin:0;padding:24px 0;background:#E6ECEC;display:flex;flex-direction:column;align-items:center;gap:24px}
.cv-page{box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.08)}
@media print{@page{size:A4;margin:0}body{background:none;padding:0;display:block}.cv-page{box-shadow:none;break-after:page}.cv-page:last-child{break-after:auto}}`;
    const doc = `<!DOCTYPE html>\n<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CV_THEME_CSS}${exportCss}</style></head><body>\n${cleanPagesHtml()}\n</body></html>`;
    download(`${fileBase()}.html`, doc, 'text/html');
    toast('CV downloaded as HTML');
  }

  async function copyCv() {
    const plain = CvRenderer.toPlainText(state.candidate);
    const html = `<div>${cleanPagesHtml().replace(/<div class="cv-head">[\s\S]*?<\/div>|<div class="cv-foot">[\s\S]*?<\/div>/g, '')}</div>`;
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([`<style>${CV_THEME_CSS}</style>${html}`], { type: 'text/html' }),
        })]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      toast('CV copied to clipboard');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = plain; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      toast(ok ? 'CV copied as text' : 'Copy was blocked by the browser', ok ? 'ok' : 'error');
    }
  }

  async function exportBackup() {
    const list = await Repository.list();
    if (!list.length) { toast('Nothing saved yet to back up', 'error'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    download(`nursiecare-candidates-backup-${stamp}.json`,
      JSON.stringify({ app: 'nursiecare-cv-builder', version: 1, exportedAt: new Date().toISOString(), candidates: list }, null, 2),
      'application/json');
    toast(`Backup downloaded (${list.length} candidates)`);
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.candidates;
      if (!Array.isArray(list)) throw new Error('This file is not a candidate backup.');
      const existing = new Set((await Repository.list()).map((c) => c.uid));
      const overwrite = list.filter((c) => existing.has(c.uid)).length;
      if (!confirm(`Import ${list.length} candidate${list.length === 1 ? '' : 's'}${overwrite ? ` (${overwrite} will replace the saved version)` : ''}?`)) return;
      await Repository.importMany(list);
      refreshLibraryCount();
      if (els.library.open) renderLibrary();
      toast(`Imported ${list.length} candidate${list.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast(`Import failed: ${e.message}`, 'error');
    }
  }

  function loadExample() {
    if (!confirmDiscard()) return;
    const c = CandidateModel.normalize(exampleCandidate());
    c.uid = makeUid();
    if (Settings.data.recruiter) Object.assign(c.support, Settings.data.recruiter);
    Repository.nextId().then((id) => {
      c.id = id;
      setCandidate(c, { dirty: true });
      toast('Example loaded — press Save to keep it');
    });
  }

  /* ---------- Menus & wiring ---------- */
  function closeMenu() { els.moreMenu.hidden = true; els.btnMore.setAttribute('aria-expanded', 'false'); }

  function bind() {
    $('#btnNew').addEventListener('click', newCandidate);
    $('#btnSave').addEventListener('click', save);
    $('#btnLibrary').addEventListener('click', openLibrary);
    $('#btnPrint').addEventListener('click', printCv);

    els.btnMore.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = els.moreMenu.hidden;
      els.moreMenu.hidden = !open;
      els.btnMore.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenu(); });
    els.moreMenu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b) return;
      closeMenu();
      ({
        html: downloadHtml,
        copy: copyCv,
        backup: exportBackup,
        import: () => els.importFile.click(),
        example: loadExample,
        clear: clearForm,
        delete: () => removeCandidate(state.candidate.uid),
      })[b.dataset.cmd]?.();
    });
    els.importFile.addEventListener('change', () => {
      const f = els.importFile.files[0];
      if (f) importBackup(f);
      els.importFile.value = '';
    });

    // Library dialog
    els.libSearch.addEventListener('input', renderLibrary);
    els.libList.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lib]');
      const row = e.target.closest('tr[data-uid]');
      if (b?.dataset.lib === 'example') { els.library.close(); loadExample(); return; }
      if (!row) return;
      if (b?.dataset.lib === 'delete') { await removeCandidate(row.dataset.uid); return; }
      if (await load(row.dataset.uid)) els.library.close();
    });
    $('#libClose').addEventListener('click', () => els.library.close());
    $('#libNew').addEventListener('click', () => { els.library.close(); newCandidate(); });
    $('#libBackup').addEventListener('click', exportBackup);
    $('#libImport').addEventListener('click', () => els.importFile.click());
    els.library.addEventListener('click', (e) => { if (e.target === els.library) els.library.close(); });

    // Preview controls
    els.zoomSel.addEventListener('change', () => { state.zoom = els.zoomSel.value; Settings.set('zoom', state.zoom); applyZoom(); });
    els.promptsToggle.addEventListener('change', () => { state.showPrompts = els.promptsToggle.checked; Settings.set('showPrompts', state.showPrompts); render(); });
    window.addEventListener('resize', () => { if (state.zoom === 'fit') applyZoom(); });

    // Click the CV to jump to the matching editor section
    els.pages.addEventListener('click', (e) => {
      const target = e.target.closest('[data-section]');
      if (!target || !target.dataset.section) return;
      setMobileView('edit');
      FormController.openSection(target.dataset.section);
    });
    // Profile checks → jump to section
    els.checksList.addEventListener('click', (e) => {
      const b = e.target.closest('[data-goto]');
      if (b) FormController.openSection(b.dataset.goto, { focus: true });
    });

    // Mobile: Edit / Preview switch
    $$('.mobile-tabs button').forEach((b) => b.addEventListener('click', () => setMobileView(b.dataset.view)));

    // Printing hides [placeholders]
    window.addEventListener('beforeprint', () => {
      const pages = CvRenderer.renderPages(state.candidate, { showPrompts: false, measureEl: els.measure });
      els.pages.replaceChildren(...pages);
    });
    window.addEventListener('afterprint', render);

    // Keyboard: Ctrl/Cmd+S saves
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function setMobileView(view) {
    document.body.dataset.view = view;
    $$('.mobile-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    if (view === 'preview') applyZoom();
  }

  async function start() {
    // Inject the CV design once (shared with print + export)
    const style = document.createElement('style');
    style.id = 'cv-theme';
    style.textContent = CV_THEME_CSS;
    document.head.appendChild(style);

    Object.assign(els, {
      pages: $('#pages'), measure: $('#measure'), previewScroll: $('#previewScroll'), pageCount: $('#pageCount'),
      currentName: $('#currentName'), currentId: $('#currentId'), saveState: $('#saveState'), editorTitle: $('#editorTitle'),
      updatedOut: $('#updatedOut'), checksBox: $('#checksBox'), checksCount: $('#checksCount'), checksList: $('#checksList'),
      toast: $('#toast'), btnMore: $('#btnMore'), moreMenu: $('#moreMenu'), importFile: $('#importFile'),
      library: $('#library'), libSearch: $('#libSearch'), libList: $('#libList'), libMeta: $('#libMeta'), libCount: $('#libCount'),
      zoomSel: $('#zoomSel'), promptsToggle: $('#promptsToggle'),
    });

    Settings.load();
    state.zoom = Settings.data.zoom || 'fit';
    state.showPrompts = Settings.data.showPrompts !== false;
    els.zoomSel.value = state.zoom;
    els.promptsToggle.checked = state.showPrompts;
    if (!storageAvailable) $('#storageWarning').hidden = false;

    FormController.init($('#editor'), () => state.candidate, markDirty);
    bind();
    setMobileView('edit');

    const last = Settings.data.lastOpened && await Repository.get(Settings.data.lastOpened);
    if (last) {
      setCandidate(last);
    } else {
      const c = CandidateModel.blank(await Repository.nextId());
      if (Settings.data.recruiter) Object.assign(c.support, Settings.data.recruiter);
      setCandidate(c, { dirty: true });
    }
    refreshLibraryCount();
  }

  return { start };
})();

/* ==========================================================================
   Example candidate (fictional) — "More ▸ Load example candidate"
   ========================================================================== */
function exampleCandidate() {
  return {
    firstName: 'Maria', lastName: 'Santos', consentShared: true,
    card: {
      statusBadge: 'Recommend interview',
      location: 'Cebu, Philippines', openTo: 'QLD, NSW regional',
      bestSuitedTo: 'RN, residential aged care – dementia focus',
      ahpra: 'General · no conditions',
      experience: { rn: '8', olderPersons: '5', ausAgedCare: '0' },
      earliestStart: 'March 2027', subjectTo: 'visa grant',
      sponsorship: 'Required', sponsorshipStatus: 'skills assessment complete',
      shifts: 'All shifts incl. nights and weekends',
      markers: { location: 'verified', bestSuitedTo: '', ahpra: 'verified', experience: 'reported', earliestStart: 'reported', sponsorship: 'verified', shifts: 'reported' },
      recommendation: 'Strong dementia-care RN for a regional RACF; needs 2–4 weeks of buddied shifts to learn Australian documentation.',
      strengths: ['5 yrs leading a 30-bed dementia unit', 'Calm with changed behaviours; confirmed by referee', 'Experienced with electronic medication charts'],
      watchouts: ['No Australian aged care experience yet', 'Has not driven on Australian roads'],
    },
    checks: { ahpra: 'verified', englishTest: 'OET', english: 'verified', references: '2', police: 'pending', licence: 'reported' },
    assessment: {
      strengths: [
        'Led a 30-bed secure dementia unit for 5 years, supervising 6 care staff per shift (confirmed by Director of Nursing referee).',
        'Uses person-centred de-escalation for changed behaviours; described three specific examples at interview.',
        'Comfortable with electronic medication administration and care-plan reviews.',
      ],
      watchouts: [
        'No Australian aged care experience. Suggest 2–4 weeks of buddied shifts and ACFI/AN-ACC documentation training.',
        'Will need support to obtain an Australian driver licence if the role is outside town.',
      ],
      questions: [
        'A resident with dementia refuses medication and becomes agitated. Talk us through your next 15 minutes.',
        'How would you prioritise an evening shift with two falls and a family complaint at the same time?',
        'What would help you settle into a regional community in your first three months?',
      ],
    },
    clinical: {
      currentRole: 'Charge Nurse, secure dementia unit, 120-bed private nursing home, Philippines',
      employmentType: 'FT', practising: 'Currently practising',
      summary: 'Cares for 30 residents with moderate to advanced dementia. Leads the shift, coordinates GP reviews and trains new staff.',
      typicalShift: '1 RN : 30 residents, high acuity, supervises 6 care staff',
      systems: 'Electronic care plans; electronic medication charts',
    },
    employmentHistory: [
      { position: 'Charge Nurse – Dementia Unit', facility: 'Private nursing home (120 beds)', location: 'Cebu, Philippines', start: '2021-06', end: '', current: true,
        description: 'Secure dementia unit, 30 residents.', responsibilities: 'Shift leadership and staff allocation\nMedication rounds and care-plan reviews\nFamily meetings and incident reporting' },
      { position: 'Registered Nurse – Medical Ward', facility: 'Regional public hospital', location: 'Cebu, Philippines', start: '2018-02', end: '2021-05', current: false,
        description: '32-bed general medical ward with a high proportion of older patients.', responsibilities: 'Admissions and discharges\nWound care and IV therapy' },
    ],
    capabilities: [
      { capability: 'Dementia care & changed behaviours', practice: 'Regular', evidence: '5 yrs secure dementia unit; referee confirmed' },
      { capability: 'Medication management', practice: 'Regular', evidence: 'Daily med rounds, electronic charts' },
      { capability: 'Wound care', practice: 'Regular', evidence: 'Pressure injury management, weekly reviews' },
      { capability: 'Palliative care', practice: 'Occasional', evidence: 'End-of-life care with family meetings' },
      { capability: 'Falls prevention', practice: 'Regular', evidence: 'Leads unit falls-risk reviews' },
      { capability: 'Australian aged care documentation', practice: 'Limited', evidence: 'Completed Nursiecare module; no workplace use yet' },
    ],
    qualifications: [
      { qualification: 'Bachelor of Science in Nursing', institution: 'University in Cebu', year: '2017' },
    ],
    registrations: [
      { name: 'AHPRA – Registered Nurse (Division 1)', number: 'NMW000XXXXXXX', expiry: '2027-05-31', status: 'verified' },
      { name: 'Basic Life Support', number: '', expiry: '2027-02-28', status: 'reported' },
    ],
    verification: {
      ahpra: { status: 'verified', note: 'Checked on register 12/09/2026' },
      qualification: { status: 'verified', note: 'Degree certificate sighted' },
      employment: { status: 'verified', note: '2018–2026 period verified' },
      references: { status: 'verified', note: '2 of 2: Director of Nursing, Nurse Unit Manager' },
      police: { status: 'pending', note: 'NBI clearance requested' },
      vaccinations: { status: 'reported', note: 'Employer to confirm requirements' },
    },
    preferences: { role: 'RN', hours: 'FT, 76 hrs per fortnight', shifts: 'All shifts; prefers a rotating roster', pay: 'Award rate' },
    readiness: { agedCarePrep: '7', english: 'OET B in all four sub-tests', interview: '18/09/2026, video, 45 min', whatWeSaw: 'Gave clear, specific examples; asked good questions about orientation.', introVideo: 'Available' },
    relocation: { relocating: 'With partner', commitment: '2-year commitment', areas: 'Toowoomba, Dubbo', supportNeeded: 'Accommodation for first 4 weeks; partner work', driving: 'Philippine licence · drives regularly', visa: 'Offshore · no current visa · employer-sponsored pathway · agent assessment complete', mobilisation: '4–6 months from offer' },
    support: { included: DEFAULT_SUPPORT, recruiterName: 'Anna', recruiterEmail: '', recruiterPhone: '' },
  };
}

document.addEventListener('DOMContentLoaded', App.start);
