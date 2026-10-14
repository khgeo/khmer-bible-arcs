/* Khmer Bible cross-reference arc diagram
 * Cross-references: OpenBible.info (CC-BY) · Khmer text: ព្រះគម្ពីរបរិសុទ្ធ ១៩៥៤ (ពគប), loaded live.
 */
'use strict';

// ---------- live text sources (first that works wins; ?text=URL overrides) ----------
const TEXT_SOURCES = [
  'https://cdn.jsdelivr.net/gh/Beblia/Holy-Bible-XML-Format@master/KhmerBFBSBible.xml',
  'https://raw.githubusercontent.com/Beblia/Holy-Bible-XML-Format/master/KhmerBFBSBible.xml',
];
const CACHE_NAME = 'pkb1954-v1';

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const KD = '០១២៣៤៥៦៧៨៩';
const kmNum = n => String(n).replace(/\d/g, d => KD[d]);
const toAscii = s => s.replace(/[០-៩]/g, d => KD.indexOf(d));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// colour ramp: short arcs magenta → blue → teal → red → tan → green → yellow (long)
const STOPS = [[0, [214, 92, 214]], [.16, [110, 128, 245]], [.3, [80, 196, 200]], [.45, [214, 70, 70]],
  [.6, [205, 165, 105]], [.78, [60, 190, 90]], [1, [214, 210, 60]]];
function ramp(t) {
  for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) {
    const [t0, a] = STOPS[i - 1], [t1, b] = STOPS[i], k = (t - t0) / (t1 - t0);
    return a.map((v, j) => Math.round(v + (b[j] - v) * k));
  }
  return STOPS[STOPS.length - 1][1];
}

// ---------- state ----------
let META, LINKS, NC, NB, OT_CH;
let chBook, chNum, chFirstVerse, bookFirstCh, verseCh; // lookups
let adj;                                              // chapter -> link indices
let TEXT = null;                                      // verse index -> Khmer text
const XREF = new Map();                               // osis -> Int32Array
const S = { minVotes: 5, otnt: false, book: -1, hover: -1, sel: -1, selVerse: -1, tab: 'refs' };
let G = {};                                           // geometry

// ---------- boot ----------
(async function init() {
  [META, LINKS] = await Promise.all([fetch('data/meta.json').then(r => r.json()), fetch('data/chapter_links.json').then(r => r.json())]);
  NB = META.books.length; NC = META.chapters;
  chBook = new Int16Array(NC); chNum = new Int16Array(NC); chFirstVerse = new Int32Array(NC + 1);
  bookFirstCh = new Int32Array(NB + 1); verseCh = new Int16Array(META.verses);
  let c = 0, v = 0;
  META.books.forEach((b, bi) => {
    bookFirstCh[bi] = c;
    b.ch.forEach((n, k) => { chBook[c] = bi; chNum[c] = k + 1; chFirstVerse[c] = v; verseCh.fill(c, v, v + n); v += n; c++; });
  });
  chFirstVerse[NC] = v; bookFirstCh[NB] = c; OT_CH = bookFirstCh[39];
  adj = Array.from({ length: NC }, () => []);
  LINKS.forEach((l, i) => { adj[l[0]].push(i); adj[l[1]].push(i); });

  const sel = $('#book');
  META.books.forEach((b, i) => sel.add(new Option(`${b.km} · ${b.en}`, i)));
  bindUI();
  layout();
  window.addEventListener('resize', debounce(layout, 150));
  loadText();
  route();
  window.addEventListener('hashchange', route);
})().catch(e => { console.error(e); setStatus('err', 'មិនអាចផ្ទុកទិន្នន័យបានទេ: ' + e.message); });

function debounce(f, ms) { let t; return () => { clearTimeout(t); t = setTimeout(f, ms); }; }

// ---------- live Khmer text (Web Worker) ----------
const WORKER_SRC = `
self.onmessage = async ({data:{urls, cacheName, chapters}}) => {
  const bases = []; let g = 0;
  for (const chs of chapters) { const b = []; for (const n of chs) { b.push(g); g += n; } bases.push(b); }
  const out = new Array(g).fill('');
  let xml = null, from = '';
  try { if (self.caches) { const c = await caches.open(cacheName);
    for (const u of urls) { const r = await c.match(u); if (r) { xml = await r.text(); from = 'cache'; break; } } } } catch (e) {}
  if (!xml) for (const u of urls) {
    try {
      const r = await fetch(u, {mode:'cors'}); if (!r.ok) throw new Error(r.status);
      const total = +r.headers.get('content-length') || 0, reader = r.body.getReader(), parts = []; let got = 0;
      for (;;) { const {done, value} = await reader.read(); if (done) break; parts.push(value); got += value.length;
        self.postMessage({progress: got, total}); }
      const blob = new Blob(parts); xml = await blob.text(); from = new URL(u).host;
      try { if (self.caches) (await caches.open(cacheName)).put(u, new Response(blob, {headers:{'content-type':'application/xml'}})); } catch (e) {}
      break;
    } catch (e) { self.postMessage({warn: u + ' → ' + e.message}); }
  }
  if (!xml) { self.postMessage({error: 'all sources failed'}); return; }
  const re = /<book number="(\\d+)"|<chapter number="(\\d+)"|<verse number="(\\d+)"[^>]*>([\\s\\S]*?)<\\/verse>/g;
  const ent = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'"};
  let b = -1, c = 0, m, n = 0;
  while ((m = re.exec(xml))) {
    if (m[1]) { b = +m[1] - 1; c = 0; }
    else if (m[2]) c = +m[2];
    else if (b >= 0 && b < bases.length && c >= 1 && c <= chapters[b].length) {
      const v = +m[3]; if (v < 1 || v > chapters[b][c-1]) continue;
      out[bases[b][c-1] + v - 1] = m[4].replace(/&(#?\\w+);/g, (s, e) => e[0] === '#' ? String.fromCodePoint(+('0' + e.slice(1))) : (ent[e] || s)).trim();
      n++;
    }
  }
  self.postMessage({text: out, count: n, from});
};`;

function loadText() {
  const qs = new URLSearchParams(location.search).get('text');
  const urls = qs ? [new URL(qs, location.href).href] : TEXT_SOURCES;
  const w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
  w.onmessage = ({ data: d }) => {
    if (d.progress) setStatus('', `កំពុងទាញយកអត្ថបទ ពគប… ${kmNum((d.progress / 1048576).toFixed(1))} MB` + (d.total ? ` / ${kmNum((d.total / 1048576).toFixed(1))} MB` : ''));
    else if (d.warn) console.warn(d.warn);
    else if (d.error) setStatus('err', 'មិនអាចភ្ជាប់ទៅអត្ថបទ ពគប បានទេ — ធ្នូនៅតែដំណើរការ');
    else if (d.text) {
      TEXT = d.text;
      setStatus('ok', `ភ្ជាប់ផ្ទាល់ទៅ ពគប ១៩៥៤ · ${kmNum(d.count.toLocaleString('en'))} ខ` + (d.from === 'cache' ? ' (ឃ្លាំងសម្ងាត់)' : ` (${d.from})`));
      if (S.sel >= 0) renderPanel();
      w.terminate();
    }
  };
  w.postMessage({ urls, cacheName: CACHE_NAME, chapters: META.books.map(b => b.ch) });
}
function setStatus(cls, msg) { const s = $('#status'); s.className = cls; $('#statusText').textContent = msg; }

// ---------- geometry & base drawing ----------
function layout() {
  const stage = $('#stage'), cs = getComputedStyle(stage);
  const W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const pad = 6, R = (W - 2 * pad) / 2, top = 8, barH = clamp(W * 0.06, 34, 80);
  const H = Math.ceil(top + R + 4 + barH + 24);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  G = { W, H, pad, R, axisY: top + R, barH, cw: (W - 2 * pad) / NC, dpr };
  for (const id of ['#arcs', '#overlay']) {
    const cv = $(id); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }
  drawBase(); drawOverlay();
}
const chX = c => G.pad + (c + 0.5) * G.cw;
const verseX = g => { const c = verseCh[g], n = chFirstVerse[c + 1] - chFirstVerse[c]; return G.pad + (c + (g - chFirstVerse[c] + 0.5) / n) * G.cw; };

function visible(l) {
  if (l[3] < S.minVotes) return false;
  if (S.otnt && !(l[0] < OT_CH && l[1] >= OT_CH)) return false;
  if (S.book >= 0) { const a = bookFirstCh[S.book], b = bookFirstCh[S.book + 1]; if (!((l[0] >= a && l[0] < b) || (l[1] >= a && l[1] < b))) return false; }
  return true;
}

function drawBase() {
  const ctx = $('#arcs').getContext('2d'), { dpr, axisY } = G;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, G.W, G.H);
  // bucket arcs by colour (distance) × strength (count) so we stroke a few big paths
  const NCB = 28, NS = 3, paths = Array.from({ length: NCB * NS }, () => new Path2D());
  let shown = 0;
  for (const l of LINKS) {
    if (!visible(l)) continue;
    shown++;
    const xa = chX(l[0]), xb = chX(l[1]), r = (xb - xa) / 2;
    const cb = Math.min(NCB - 1, Math.floor((l[1] - l[0]) / NC * NCB));
    const s = l[2] >= 12 ? 2 : l[2] >= 3 ? 1 : 0;
    const p = paths[cb * NS + s];
    p.moveTo(xa, axisY); p.arc(xa + r, axisY, r, Math.PI, 2 * Math.PI);
  }
  // alpha scales down when many arcs are visible
  const k = clamp(Math.sqrt(9000 / Math.max(shown, 1)), 0.25, 2.2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 0.6;
  paths.forEach((p, i) => {
    const cb = Math.floor(i / NS), s = i % NS, [r, g, b] = ramp((cb + 0.5) / NCB);
    const t = (cb + 0.5) / NCB, dense = 0.3 + 0.7 * Math.sqrt(t); // short arcs pile up, so dim them
    ctx.strokeStyle = `rgba(${r},${g},${b},${clamp([0.045, 0.1, 0.2][s] * k * dense, 0.012, 0.85)})`;
    ctx.stroke(p);
  });
  ctx.globalCompositeOperation = 'source-over';
  // axis line + verse-count bars, alternating grey per book (as in Harrison's chart)
  ctx.fillStyle = '#3b6fd6'; ctx.fillRect(G.pad, axisY, G.W - 2 * G.pad, 1.5);
  const maxV = 176;
  for (let c = 0; c < NC; c++) {
    const n = chFirstVerse[c + 1] - chFirstVerse[c], h = Math.max(1, n / maxV * G.barH);
    const bi = chBook[c], hi = S.book === bi;
    ctx.fillStyle = hi ? '#e7c86a' : (bi % 2 ? '#8a8a8a' : '#d8d8d8');
    ctx.fillRect(G.pad + c * G.cw, axisY + 3, Math.max(G.cw - 0.15, 0.5), h);
  }
  // testament labels
  ctx.fillStyle = '#8d8b84'; ctx.font = '12px "Kantumruy Pro", sans-serif'; ctx.textBaseline = 'top';
  const ly = axisY + 6 + G.barH;
  ctx.textAlign = 'left'; ctx.fillText('គម្ពីរសញ្ញាចាស់ · Old Testament', G.pad, ly);
  ctx.textAlign = 'right'; ctx.fillText('New Testament · គម្ពីរសញ្ញាថ្មី', G.W - G.pad, ly);
  ctx.fillStyle = '#3b6fd6'; ctx.fillRect(chX(OT_CH) - G.cw / 2, axisY + 3, 1, G.barH + 18);
  $('#stats').textContent = `${kmNum(shown.toLocaleString('en'))} ធ្នូ / ${kmNum(LINKS.length.toLocaleString('en'))}`;
}

function drawOverlay() {
  const ctx = $('#overlay').getContext('2d'), { dpr, axisY } = G;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, G.W, G.H);
  const strokeChapter = (c, color, lw) => {
    ctx.beginPath();
    for (const i of adj[c]) { const l = LINKS[i]; if (!visible(l)) continue;
      const xa = chX(l[0]), xb = chX(l[1]); ctx.moveTo(xa, axisY); ctx.arc((xa + xb) / 2, axisY, (xb - xa) / 2, Math.PI, 2 * Math.PI); }
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
    ctx.fillStyle = color; ctx.fillRect(G.pad + c * G.cw - 1, axisY + 2, G.cw + 2, G.barH + 2);
  };
  if (S.sel >= 0) {
    if (S.selVerse >= 0 && XREF.has(META.books[chBook[S.sel]].osis)) drawVerseArcs(ctx);
    else strokeChapter(S.sel, 'rgba(231,200,106,.55)', 0.9);
  }
  if (S.hover >= 0 && S.hover !== S.sel) strokeChapter(S.hover, 'rgba(255,255,255,.55)', 0.8);
}

function drawVerseArcs(ctx) {
  const arr = XREF.get(META.books[chBook[S.sel]].osis), { axisY } = G;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < arr.length; i += 4) {
    if (arr[i] !== S.selVerse) continue;
    const xa = verseX(arr[i]), xb = verseX(arr[i + 1]), lo = Math.min(xa, xb), r = Math.abs(xb - xa) / 2;
    const [cr, cg, cb] = ramp(Math.abs(verseCh[arr[i + 1]] - verseCh[arr[i]]) / NC);
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${clamp(0.35 + arr[i + 3] / 80, .35, 1)})`;
    ctx.beginPath(); ctx.moveTo(lo, axisY); ctx.arc(lo + r, axisY, Math.max(r, 1), Math.PI, 2 * Math.PI); ctx.stroke();
  }
  ctx.fillStyle = '#e7c86a'; ctx.beginPath(); ctx.arc(verseX(S.selVerse), axisY, 3.5, 0, 7); ctx.fill();
}

// ---------- interaction ----------
function bindUI() {
  const ov = $('#overlay'), tip = $('#tip');
  ov.addEventListener('mousemove', e => {
    const r = ov.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const c = pickChapter(x, y);
    if (c !== S.hover) { S.hover = c; drawOverlay(); }
    if (c < 0) { tip.hidden = true; return; }
    const b = META.books[chBook[c]], n = adj[c].filter(i => visible(LINKS[i])).length;
    tip.innerHTML = `<b>${esc(b.km)} ${kmNum(chNum[c])}</b> <small>${esc(b.en)} ${chNum[c]}</small><br><small>${kmNum(n)} ធ្នូ · ${kmNum(chFirstVerse[c + 1] - chFirstVerse[c])} ខ</small>`;
    tip.hidden = false;
    const tx = clamp(x + 34, 4, G.W - tip.offsetWidth + 10);
    tip.style.left = tx + 'px'; tip.style.top = Math.max(4, y - 44) + 'px';
  });
  ov.addEventListener('mouseleave', () => { S.hover = -1; tip.hidden = true; drawOverlay(); });
  ov.addEventListener('click', e => {
    const r = ov.getBoundingClientRect(), c = pickChapter(e.clientX - r.left, e.clientY - r.top);
    if (c >= 0) go(c, -1);
  });
  $('#votes').addEventListener('input', e => { S.minVotes = +e.target.value; $('#vv').textContent = kmNum(S.minVotes); drawBase(); drawOverlay(); });
  $('#otnt').addEventListener('change', e => { S.otnt = e.target.checked; drawBase(); drawOverlay(); });
  $('#book').addEventListener('change', e => { S.book = e.target.value === '' ? -1 : +e.target.value; drawBase(); drawOverlay(); });
  $('#search').addEventListener('submit', e => {
    e.preventDefault(); const r = parseRef($('#q').value);
    if (!r) { $('#q').setCustomValidity('រកមិនឃើញ'); $('#q').reportValidity(); setTimeout(() => $('#q').setCustomValidity(''), 1500); return; }
    go(r.c, r.v);
  });
  $('#vv').textContent = kmNum(S.minVotes);
}

// pick chapter: on/under axis use x directly; above, pick the chapter whose arc passes nearest
function pickChapter(x, y) {
  if (x < G.pad || x > G.W - G.pad) return -1;
  const cx = clamp(Math.floor((x - G.pad) / G.cw), 0, NC - 1);
  if (y >= G.axisY - 6) return cx;
  return cx; // arcs are dense; column hover feels natural and is predictable
}

function go(c, v) {
  const b = META.books[chBook[c]];
  const h = `#${b.osis}.${chNum[c]}` + (v >= 0 ? `.${v - chFirstVerse[c] + 1}` : '');
  if (location.hash !== h) location.hash = h; else route();
}

async function route() {
  const m = decodeURIComponent(location.hash.slice(1)).match(/^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) return;
  const bi = META.books.findIndex(b => b.osis === m[1]); if (bi < 0) return;
  const c = bookFirstCh[bi] + clamp(+m[2], 1, META.books[bi].ch.length) - 1;
  S.sel = c; S.selVerse = m[3] ? chFirstVerse[c] + clamp(+m[3], 1, chFirstVerse[c + 1] - chFirstVerse[c]) - 1 : -1;
  if (S.selVerse >= 0) S.tab = 'refs';
  await loadXref(bi);
  renderPanel(); drawOverlay();
}

async function loadXref(bi) {
  const o = META.books[bi].osis;
  if (!XREF.has(o)) {
    const arr = await fetch(`data/xref/${o}.json`).then(r => r.ok ? r.json() : []).catch(() => []);
    XREF.set(o, Int32Array.from(arr));
  }
  return XREF.get(o);
}

// ---------- references & search ----------
function refLabel(g, e) {
  const c = verseCh[g], b = META.books[chBook[c]], v = g - chFirstVerse[c] + 1;
  let s = `${b.km} ${kmNum(chNum[c])}:${kmNum(v)}`;
  if (e > g) { const c2 = verseCh[e], v2 = e - chFirstVerse[c2] + 1; s += c2 === c ? `-${kmNum(v2)}` : `-${kmNum(chNum[c2])}:${kmNum(v2)}`; }
  return s;
}
const verseText = g => TEXT ? (TEXT[g] || '—') : '<span class="muted">កំពុងផ្ទុក…</span>';

function parseRef(q) {
  q = toAscii(q.trim()).replace(/[៖：]/g, ':').replace(/\s+/g, ' ');
  const m = q.match(/^(.+?)\s*(\d+)(?:\s*[:.\s]\s*(\d+))?$/) || q.match(/^(.+)$/);
  if (!m) return null;
  const key = m[1].toLowerCase().replace(/[\s.]/g, '');
  const norm = s => toAscii(s).toLowerCase().replace(/[\s.]/g, '');
  let bi = META.books.findIndex(b => [b.km, b.en, b.osis].some(n => norm(n) === key));
  if (bi < 0) bi = META.books.findIndex(b => [b.km, b.en, b.osis].some(n => norm(n).startsWith(key)));
  if (bi < 0) return null;
  const ch = clamp(+(m[2] || 1), 1, META.books[bi].ch.length), c = bookFirstCh[bi] + ch - 1;
  const v = m[3] ? chFirstVerse[c] + clamp(+m[3], 1, META.books[bi].ch[ch - 1]) - 1 : -1;
  return { c, v };
}

// ---------- side panel ----------
function renderPanel() {
  const c = S.sel; if (c < 0) return;
  const bi = chBook[c], b = META.books[bi], arr = XREF.get(b.osis) || new Int32Array();
  const v0 = chFirstVerse[c], v1 = chFirstVerse[c + 1];
  const by = new Map();
  for (let i = 0; i < arr.length; i += 4) if (arr[i] >= v0 && arr[i] < v1) {
    if (!by.has(arr[i])) by.set(arr[i], []);
    by.get(arr[i]).push([arr[i + 1], arr[i + 2], arr[i + 3]]);
  }
  by.forEach(l => l.sort((a, b) => b[2] - a[2]));
  const total = [...by.values()].reduce((s, l) => s + l.length, 0);

  let h = `<h2>${esc(b.km)} ${kmNum(chNum[c])}</h2>
    <div class="muted" style="font-size:12.5px">${esc(b.en)} ${chNum[c]} · ${kmNum(v1 - v0)} ខ · ${kmNum(total)} សម្ពន្ធ</div>
    <div class="tabs"><button data-tab="refs" class="${S.tab === 'refs' ? 'on' : ''}">សម្ពន្ធ</button>
    <button data-tab="read" class="${S.tab === 'read' ? 'on' : ''}">អានជំពូក</button>
    <span style="flex:1"></span><span class="nav"><button data-nav="-1" title="ជំពូកមុន">‹</button><button data-nav="1" title="ជំពូកបន្ទាប់">›</button></span></div>`;

  if (S.tab === 'read') {
    h += '<div class="chapter-text">';
    for (let g = v0; g < v1; g++) h += `<span data-v="${g}" class="${g === S.selVerse ? 'verse-sel' : ''}"><span class="vnum">${kmNum(g - v0 + 1)}</span>${verseText(g)} </span>`;
    h += '</div>';
  } else {
    const verses = S.selVerse >= 0 ? [S.selVerse] : [...by.keys()].sort((a, b) => a - b);
    if (S.selVerse >= 0) h += `<p><button class="more" data-allv>← បង្ហាញខទាំងអស់ក្នុងជំពូក</button></p>`;
    if (!verses.length) h += '<p class="muted">គ្មានសម្ពន្ធ</p>';
    for (const g of verses) {
      const list = by.get(g) || [], lim = S.selVerse >= 0 ? 60 : 4;
      h += `<h3 id="v${g}" data-pick="${g}" style="cursor:pointer">${refLabel(g)} <span class="muted" style="font-weight:400">· ${kmNum(list.length)}</span></h3>
        <p class="src">${verseText(g)}</p>`;
      list.slice(0, lim).forEach(([t, e, votes]) => {
        let txt = ''; if (TEXT) for (let k = t; k <= Math.min(e, t + 4); k++) txt += (k > t ? ` <span class="vnum">${kmNum(k - chFirstVerse[verseCh[k]] + 1)}</span>` : '') + (TEXT[k] || '');
        if (TEXT && e > t + 4) txt += ' …';
        h += `<div class="ref" data-go="${t}"><div class="lbl"><span>${refLabel(t, e)}</span><i>▲ ${kmNum(votes)}</i></div><div class="txt">${TEXT ? txt : verseText(t)}</div></div>`;
      });
      if (list.length > lim) h += `<button class="more" data-pick="${g}">+ ${kmNum(list.length - lim)} ទៀត</button>`;
    }
  }
  const d = $('#detail'); d.innerHTML = h;
  d.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { S.tab = el.dataset.tab; renderPanel(); });
  d.querySelectorAll('[data-nav]').forEach(el => el.onclick = () => go(clamp(c + +el.dataset.nav, 0, NC - 1), -1));
  d.querySelectorAll('[data-go]').forEach(el => el.onclick = () => go(verseCh[+el.dataset.go], +el.dataset.go));
  d.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => go(c, +el.dataset.pick));
  d.querySelectorAll('[data-v]').forEach(el => el.onclick = () => { S.tab = 'refs'; go(c, +el.dataset.v); });
  d.querySelectorAll('[data-allv]').forEach(el => el.onclick = () => go(c, -1));
  $('#panel').scrollTop = 0;
}
