/* 입찰 전략실 — 비밀번호로 data.bin을 복호화한 뒤 브라우저 안에서만 분석한다. */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, d = 0) => v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('ko-KR', {minimumFractionDigits: d, maximumFractionDigits: d});
const pct = (v, d = 1) => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d) + '%';
const eok = v => v == null ? '–' : (v / 1e8).toLocaleString('ko-KR', {maximumFractionDigits: 2}) + '억';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  sset(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
};

/* ------------------------------------------------------------ 복호화 */
async function decrypt(buf, pw) {
  if (!window.crypto || !crypto.subtle) throw new Error('https 주소(https://…)로 열어야 복호화할 수 있습니다');
  if (!window.DecompressionStream) throw new Error('브라우저가 오래되었습니다. 최신 Chrome·Edge·Safari로 열어 주세요');
  const u = new Uint8Array(buf);
  if (String.fromCharCode(...u.slice(0, 4)) !== 'G2B1') throw new Error('format');
  const salt = u.slice(4, 20), iv = u.slice(20, 32), ct = u.slice(32);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256'},
    base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
  const gz = await crypto.subtle.decrypt({name: 'AES-GCM', iv}, key, ct);
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

let DATA = null, BIDS = [], UP = [];
async function unlock(pw) {
  const btn = $('#unlock'); btn.disabled = true; btn.textContent = '여는 중…'; $('#err').textContent = '';
  try {
    const r = await fetch('data.bin?v=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) throw new Error('nodata');
    const d = await decrypt(await r.arrayBuffer(), pw);
    store.sset('g2b_pw', pw);
    load(d);
  } catch (e) {
    store.sset('g2b_pw', null);
    const wrong = e.name === 'OperationError' || e.message === 'format';
    if (!wrong && e.message !== 'nodata') console.error(e);
    $('#err').textContent = e.message === 'nodata' ? '아직 데이터 파일이 없습니다. 첫 수집이 끝난 뒤 다시 열어 주세요.'
      : wrong ? '비밀번호가 맞지 않습니다.' : '데이터를 여는 중 오류가 났습니다: ' + e.message;
  } finally { btn.disabled = false; btn.textContent = '열기'; }
}
$('#lockform').addEventListener('submit', e => { e.preventDefault(); unlock($('#pw').value.trim()); });
$('#lockbtn').addEventListener('click', () => { store.sset('g2b_pw', null); location.reload(); });
$('#theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  store.set('g2b_theme', document.documentElement.dataset.theme); render();
});
if (store.get('g2b_theme')) document.documentElement.dataset.theme = store.get('g2b_theme');
if (store.sget('g2b_pw')) unlock(store.sget('g2b_pw'));

function toObjs(t) { return t.rows.map(r => Object.fromEntries(t.cols.map((c, i) => [c, r[i]]))); }
function load(d) {
  DATA = d;
  BIDS = toObjs(d.bids).map(b => ({...b, ind: b.ind || '', rgn: b.rgn || '', nm: b.nm || '', _d: Date.parse(b.dt)}));
  UP = toObjs(d.upcoming).map(n => ({...n, ind: n.ind || '', rgn: n.rgn || '', nm: n.nm || ''}));
  $('#lock').style.display = 'none'; $('#app').style.display = 'block';
  const m = d.meta;
  $('#asof').textContent = `${m.last || '-'} 기준 · 갱신 ${m.built}`;
  const cov = Object.entries(m.coverage || {}).map(([k, v]) =>
    `${k} ${v.days}/${v.expected}일`).join(' · ');
  const st = m.status || {};
  $('#foot').innerHTML = `데이터: 조달청 공공데이터개방표준서비스(낙찰·입찰공고). 적재 현황 ${esc(cov)}` +
    (st.left ? ` · 백필 남은 작업 ${fmt(st.left)}개(매일 자동으로 이어받음)` : '') +
    `<br>확률은 과거 자료로 추정한 값이며 낙찰을 보장하지 않습니다. 투찰은 나라장터에서 직접 하십시오.`;
  buildControls(); render();
}

/* ------------------------------------------------------------ 업종 정의 */
const has = (s, re) => re.test(s || '');
const CATS = [
  {k: 'elec', label: '전기공사', f: b => b.div === '공사' && (has(b.ind, /전기공사/) || (has(b.nm, /전기/) && !has(b.nm, /정보통신|통신|소방/)))},
  {k: 'sup', label: '감리', f: b => has(b.nm, /감리/) || has(b.ind, /감리|전력기술관리/)},
  {k: 'fire', label: '소방', f: b => has(b.nm, /소방/) || has(b.ind, /소방/)},
];
const MORE = [
  {k: 'esup', label: '전기 감리', f: b => (has(b.nm, /감리/) && has(b.nm, /전기|전력/)) || has(b.ind, /전력기술관리/)},
  {k: 'tele', label: '정보통신', f: b => has(b.ind, /정보통신/) || has(b.nm, /정보통신|통신공사/)},
  {k: 'mech', label: '기계설비', f: b => has(b.ind, /기계설비|기계가스/) || has(b.nm, /기계설비|냉난방/)},
  {k: 'arch', label: '건축', f: b => has(b.ind, /건축공사|실내건축/)},
  {k: 'civil', label: '토목', f: b => has(b.ind, /토목|토공/)},
  {k: 'land', label: '조경', f: b => has(b.ind, /조경/)},
  {k: 'allc', label: '공사 전체', f: b => b.div === '공사'},
  {k: 'alls', label: '용역 전체', f: b => b.div === '용역'},
];
const PERIODS = [['1', '1개월'], ['3', '3개월'], ['6', '6개월'], ['12', '1년']];
const TABS = [['strategy', '가격 전략'], ['compete', '경쟁 분석'], ['fail', '유찰 분석'], ['upcoming', '진행 공고'], ['mine', '내 회사']];

const S = {cats: new Set(['elec']), period: '3', tab: 'strategy', floor: 'auto', cost: 80, custom: {}};
try { Object.assign(S, JSON.parse(store.get('g2b_state') || '{}'), {cats: new Set(JSON.parse(store.get('g2b_state') || '{}').cats || ['elec'])}); } catch (e) {}
const save = () => store.set('g2b_state', JSON.stringify({...S, cats: [...S.cats]}));

function chip(label, pressed, onclick, cls = '') {
  const b = document.createElement('button');
  b.className = 'chip ' + cls; b.type = 'button'; b.textContent = label;
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false'); b.onclick = onclick; return b;
}
function buildControls() {
  const cr = $('#catrow'); cr.querySelectorAll('.chip').forEach(x => x.remove());
  const toggle = k => { S.cats.has(k) ? S.cats.delete(k) : S.cats.add(k); save(); buildControls(); render(); };
  CATS.forEach(c => cr.appendChild(chip(c.label, S.cats.has(c.k), () => toggle(c.k))));
  cr.appendChild(chip('사용자 지정', S.cats.has('custom'), () => toggle('custom')));
  const moreOn = MORE.some(m => S.cats.has(m.k));
  cr.appendChild(chip(moreOn ? '다른 업종 ▴' : '다른 업종 ▾', false, () => { $('#morerow').classList.toggle('open'); }, 'ghost'));
  const mr = $('#morerow'); mr.innerHTML = '<span class="lbl"></span>';
  MORE.forEach(c => mr.appendChild(chip(c.label, S.cats.has(c.k), () => toggle(c.k))));
  if (moreOn) mr.classList.add('open');
  $('#custom').classList.toggle('open', S.cats.has('custom'));
  ['inc', 'exc', 'div', 'ind', 'inst', 'rgn', 'min', 'max', 'mth'].forEach(k => {
    const el = $('#c_' + k); el.value = S.custom[k] ?? '';
    el.oninput = () => { S.custom[k] = el.value; save(); clearTimeout(el._t); el._t = setTimeout(render, 250); };
  });
  const pr = $('#perrow'); pr.querySelectorAll('.chip').forEach(x => x.remove());
  PERIODS.forEach(([k, l]) => pr.appendChild(chip(l, S.period === k, () => { S.period = k; save(); buildControls(); render(); })));
  const tb = $('#tabs'); tb.innerHTML = '';
  TABS.forEach(([k, l]) => {
    const b = document.createElement('button'); b.textContent = l; b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', S.tab === k ? 'true' : 'false');
    b.onclick = () => { S.tab = k; save(); buildControls(); render(); }; tb.appendChild(b);
  });
}

function customFn() {
  const c = S.custom, list = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
  const inc = list(c.inc), exc = list(c.exc), ind = list(c.ind), inst = list(c.inst), rgn = list(c.rgn), mth = list(c.mth);
  const mn = parseFloat(c.min) * 1e8, mx = parseFloat(c.max) * 1e8;
  return b => {
    if (inc.length && !inc.some(k => b.nm.includes(k))) return false;
    if (exc.some(k => b.nm.includes(k))) return false;
    if (c.div && b.div !== c.div) return false;
    if (ind.length && !ind.some(k => b.ind.includes(k))) return false;
    if (inst.length && !inst.some(k => (b.inst || '').includes(k) || (b.dinst || '').includes(k))) return false;
    if (rgn.length && !rgn.some(k => b.rgn.includes(k))) return false;
    if (mth.length && !mth.some(k => (b.mth || '').includes(k))) return false;
    const amt = b.bss ?? b.ps;
    if (isFinite(mn) && !(amt >= mn)) return false;
    if (isFinite(mx) && !(amt <= mx)) return false;
    return true;
  };
}
function catFilter() {
  const fs = [...CATS, ...MORE].filter(c => S.cats.has(c.k)).map(c => c.f);
  if (S.cats.has('custom')) fs.push(customFn());
  if (!fs.length) return () => true;
  return b => fs.some(f => f(b));
}
function scopeLabel() {
  const names = [...CATS, ...MORE].filter(c => S.cats.has(c.k)).map(c => c.label);
  if (S.cats.has('custom')) names.push('사용자 지정');
  return names.length ? names.join(' + ') : '전체 업종';
}
function periodRange() {
  const last = Date.parse(DATA.meta.last || DATA.meta.today);
  const months = parseInt(S.period, 10);
  const from = new Date(last); from.setMonth(from.getMonth() - months);
  return [from.getTime() + 864e5, last];
}

/* ------------------------------------------------------------ 통계 도구 */
const median = a => quantile(a, .5);
function quantile(a, q) {
  const s = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y);
  if (!s.length) return null;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const mean = a => { const s = a.filter(v => v != null && isFinite(v)); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
const isFail = b => /유찰/.test(b.res || '') || (b.n || 0) < 2;
const ymKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const bssBucket = v => v == null ? '미상' : v < 1e8 ? '1억 미만' : v < 3e8 ? '1–3억' : v < 1e9 ? '3–10억' : v < 5e9 ? '10–50억' : '50억 이상';
const BUCKETS = ['1억 미만', '1–3억', '3–10억', '10–50억', '50억 이상', '미상'];

/* 고정 투찰률 x(기초 대비 %)의 낙찰 여부: t ≤ x < wr  (t=하한율×사정률, wr=1순위 투찰률) */
const STEP = 0.001, WIN = 50; // ±0.05%p 평활
function curve(bids, lo, hi) {
  const n = Math.round((hi - lo) / STEP) + 1;
  const diff = new Float64Array(n + 1), tcnt = new Float64Array(n + 1);
  bids.forEach(b => {
    const a = Math.max(0, Math.ceil((b.t - lo) / STEP - 1e-9)), z = Math.min(n, Math.ceil((b.wr - lo) / STEP - 1e-9));
    if (z > a) { diff[a] += 1; diff[z] -= 1; }
    const ti = Math.min(n, Math.max(0, Math.ceil((b.t - lo) / STEP - 1e-9))); tcnt[ti] += 1;
  });
  const raw = new Float64Array(n), below = new Float64Array(n);
  let acc = 0, tc = 0; const N = bids.length || 1;
  for (let i = 0; i < n; i++) { acc += diff[i]; raw[i] = acc / N; tc += tcnt[i]; below[i] = 1 - tc / N; }
  const sm = new Float64Array(n); let s = 0;
  for (let i = 0; i < n; i++) {
    s += raw[i]; if (i - 2 * WIN - 1 >= 0) s -= raw[i - 2 * WIN - 1];
    const j = i - WIN; if (j >= 0) sm[j] = s / Math.min(2 * WIN + 1, i + 1);
  }
  for (let j = Math.max(0, n - WIN); j < n; j++) { let a = 0, c = 0; for (let k = j - WIN; k <= Math.min(n - 1, j + WIN); k++) if (k >= 0) { a += raw[k]; c++; } sm[j] = a / c; }
  const xs = Array.from({length: n}, (_, i) => +(lo + i * STEP).toFixed(3));
  return {xs, raw, sm, below};
}
function argmax(arr, from = 0, to = arr.length) { let bi = from; for (let i = from; i < to; i++) if (arr[i] > arr[bi]) bi = i; return bi; }

/* 복수예가 시뮬레이션: ±span 범위 15구간에서 1개씩, 그중 4개 평균 */
function simSj(span, k = 20000) {
  const out = new Float64Array(k);
  for (let r = 0; r < k; r++) {
    const pts = Array.from({length: 15}, (_, i) => 1 - span + 2 * span * (i + Math.random()) / 15);
    for (let i = 14; i > 10; i--) { const j = Math.floor(Math.random() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
    out[r] = (pts[11] + pts[12] + pts[13] + pts[14]) / 4;
  }
  return Array.from(out).sort((a, b) => a - b);
}

/* ------------------------------------------------------------ 차트 */
let charts = [];
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function mkChart(id, cfg) {
  if (!window.Chart) { const el = document.getElementById(id); if (el) el.parentElement.innerHTML = '<div class="empty">차트 라이브러리를 불러오지 못했습니다(인터넷 연결 확인).</div>'; return; }
  const ink = css('--muted'), line = css('--line');
  Chart.defaults.font.family = css('--sans'); Chart.defaults.color = ink; Chart.defaults.borderColor = line;
  charts.push(new Chart(document.getElementById(id), cfg));
}
function clearCharts() { charts.forEach(c => c.destroy()); charts = []; }

/* ------------------------------------------------------------ 렌더링 */
function render() {
  if (!DATA) return;
  clearCharts();
  const cf = catFilter(), [from, to] = periodRange();
  const inCat = BIDS.filter(cf);
  const sel = inCat.filter(b => b._d >= from && b._d <= to);
  const d0 = new Date(from).toISOString().slice(0, 10), d1 = new Date(to).toISOString().slice(0, 10);
  $('#scope').innerHTML = `<b>${esc(scopeLabel())}</b> · ${d0} ~ ${d1} · 입찰 <span class="num">${fmt(sel.length)}</span>건`;
  const v = $('#view');
  if (S.tab === 'upcoming') return renderUpcoming(v, inCat.filter(b => b._d >= from && b._d <= to), cf);
  if (!sel.length) { v.innerHTML = '<div class="empty">조건에 맞는 입찰이 없습니다. 업종이나 기간을 넓혀 보세요.</div>'; return; }
  ({strategy: renderStrategy, compete: renderCompete, fail: renderFail, mine: renderMine})[S.tab](v, sel);
}

function kpis(items) {
  return `<div class="kpis">${items.map(([k, val, s]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${val}</div><div class="s">${s || ''}</div></div>`).join('')}</div>`;
}

/* ---------- 가격 전략 */
function renderStrategy(v, sel) {
  let ok = sel.filter(b => b.t && b.wr && !isFail(b) && b.wr >= b.t - 0.01);
  const floors = {};
  ok.forEach(b => { const k = b.fl?.toFixed(3); if (k) floors[k] = (floors[k] || 0) + 1; });
  const flist = Object.entries(floors).sort((a, b) => b[1] - a[1]);
  if (S.floor === 'auto' || (S.floor !== 'all' && !floors[S.floor])) S.floor = flist.length ? flist[0][0] : 'all';
  if (S.floor !== 'all') ok = ok.filter(b => b.fl?.toFixed(3) === S.floor);
  ok.sort((a, b) => a._d - b._d);
  const flSel = `<select id="flsel">${flist.map(([k, c]) => `<option value="${k}" ${S.floor === k ? 'selected' : ''}>하한율 ${k}% (${c}건)</option>`).join('')}<option value="all" ${S.floor === 'all' ? 'selected' : ''}>전체 하한율 섞기</option></select>`;
  const base = mean(ok.map(b => 1 / b.n));
  let html = `<div class="card"><h2>투찰률별 낙찰 확률</h2><p class="lead">기초금액 대비 투찰률을 하나로 고정해 과거 입찰 ${fmt(ok.length)}건에 넣어 봤을 때, 1순위가 되었을 비율입니다. 하한율이 다르면 목표 지점이 달라지므로 하한율별로 나눠 봅니다. ${flSel}</p>`;
  if (ok.length < 20) {
    v.innerHTML = html + `<div class="empty">표본이 ${ok.length}건이라 곡선을 그리기 어렵습니다. 기간을 늘리거나 업종을 넓혀 주세요.</div></div>` + calcHtml(null);
    bindStrategy(); bindCalc(null, ok); return;
  }
  const lo = Math.floor((quantile(ok.map(b => b.t), .01) - 0.6) * 10) / 10;
  const hi = Math.ceil((quantile(ok.map(b => b.wr), .99) + 0.6) * 10) / 10;
  const C = curve(ok, lo, hi);
  const iBest = argmax(C.sm);
  const iSafe = C.below.findIndex(r => r <= 0.05);
  const cost = +S.cost || 0;
  const prof = C.sm.map((p, i) => p * Math.max(0, C.xs[i] - cost));
  const iProf = argmax(prof);
  // 검증: 앞 70%로 고르고 뒤 30%로 채점
  const cut = Math.floor(ok.length * 0.7), tr = ok.slice(0, cut), te = ok.slice(cut);
  const Ctr = curve(tr, lo, hi), Cte = curve(te, lo, hi);
  const iTr = argmax(Ctr.sm);
  const teRate = Cte.sm[iTr], teN = te.length, teBase = mean(te.map(b => 1 / b.n));
  const [wl, wh] = wilson(Math.round(teRate * teN), teN);
  const good = wl > teBase;
  const rec = (cls, title, i, desc) => `<div class="rec ${cls}"><div class="t">${title}</div><div class="x">${C.xs[i]?.toFixed(3) ?? '–'}%</div><div class="d">낙찰 확률 <b class="num">${pct(C.sm[i], 2)}</b> · 하한 미달 위험 <b class="num">${pct(C.below[i], 0)}</b></div><div class="note">${desc}</div></div>`;
  html += `<div class="chartbox"><canvas id="cv"></canvas></div>
    <div class="recs">
      ${rec('main', '확률 최대형', iBest, '과거 자료에서 1순위가 가장 자주 됐을 투찰률')}
      ${iSafe >= 0 ? rec('', '안전형 (하한 미달 5% 이하)', iSafe, '하한선 아래로 떨어질 위험을 5% 이하로 묶은 가장 낮은 값') : ''}
      ${rec('', `수익형 (원가율 <input id="cost" type="number" value="${cost}" step="1" style="width:56px"> %)`, iProf, '낙찰 확률 × (투찰률 − 원가율)이 가장 큰 값')}
    </div>
    <div class="verdict ${good ? 'good' : 'bad'}"><b>성적표</b> — 앞쪽 ${fmt(tr.length)}건으로 고른 ${C.xs[iTr].toFixed(3)}%를 뒤쪽 ${fmt(teN)}건에 적용하면 낙찰 확률 <b class="num">${pct(teRate, 2)}</b> (95% 구간 ${pct(wl, 1)}~${pct(wh, 1)}), 무작위 기준선(1/참가업체 수)은 <b class="num">${pct(teBase, 2)}</b>입니다.
      ${good ? '투찰률 선택이 무작위보다 나았습니다.' : '<b>이 업종·기간에서는 투찰률만으로 무작위보다 낫다고 볼 근거가 없습니다.</b> 경쟁이 적은 공고를 고르는 쪽(진행 공고 탭)이 확률을 더 바꿉니다.'}
    </div></div>`;
  html += kpis([
    ['분석 입찰', fmt(ok.length) + '건', S.floor === 'all' ? '하한율 혼합' : `하한율 ${S.floor}%`],
    ['무작위 기준선', pct(base, 2), '평균 1/참가업체 수'],
    ['하한선 위치 (중앙값)', fmt(median(ok.map(b => b.t)), 3) + '%', `기초 대비 · 5~95%: ${fmt(quantile(ok.map(b => b.t), .05), 2)}~${fmt(quantile(ok.map(b => b.t), .95), 2)}`],
    ['1순위 여유폭 (중앙값)', fmt(median(ok.map(b => b.wr - b.t)), 3) + '%p', '1순위 투찰률 − 하한선'],
  ]);
  html += calcHtml(S.floor !== 'all' ? +S.floor : null, C.xs[iBest]);
  v.innerHTML = html;
  const xsL = C.xs.filter((_, i) => i % 5 === 0);
  const pick = arr => Array.from(arr).filter((_, i) => i % 5 === 0).map(p => +(p * 100).toFixed(3));
  mkChart('cv', {type: 'line', data: {labels: xsL, datasets: [
    {label: '낙찰 확률 (±0.05%p 평활)', data: pick(C.sm), borderColor: css('--chart1'), borderWidth: 2, pointRadius: 0, yAxisID: 'y'},
    {label: '무작위 기준선', data: xsL.map(() => +(base * 100).toFixed(3)), borderColor: css('--chart3'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y'},
    {label: '하한 미달 위험', data: pick(C.below), borderColor: css('--chart2'), borderWidth: 1.5, pointRadius: 0, yAxisID: 'y2'},
  ]}, options: {maintainAspectRatio: false, animation: false, interaction: {mode: 'index', intersect: false},
    scales: {x: {title: {display: true, text: '투찰률 (기초금액 대비 %)'}, ticks: {maxTicksLimit: 10}},
      y: {title: {display: true, text: '낙찰 확률 (%)'}, beginAtZero: true},
      y2: {position: 'right', min: 0, max: 100, title: {display: true, text: '하한 미달 위험 (%)'}, grid: {drawOnChartArea: false}}},
    plugins: {tooltip: {callbacks: {title: i => `투찰률 ${i[0].label}%`, label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%`}}}}});
  bindStrategy(); bindCalc(S.floor !== 'all' ? +S.floor : null, ok);
}
function bindStrategy() {
  const f = $('#flsel'); if (f) f.onchange = () => { S.floor = f.value; save(); render(); };
  const c = $('#cost'); if (c) c.onchange = () => { S.cost = +c.value; save(); render(); };
}
function calcHtml(fl, x) {
  return `<div class="card"><h2>투찰금액 계산기</h2><p class="lead">공고의 기초금액과 하한율을 넣으면 투찰금액과, 복수예가 추첨(15개 중 4개 평균)을 2만 번 돌려 본 하한 미달 위험을 계산합니다.</p>
  <div class="calc">
    <div class="field"><label>기초금액 (원)</label><input id="k_bss" inputmode="numeric" value="${store.get('g2b_kbss') || ''}" placeholder="예: 512,300,000"></div>
    <div class="field"><label>낙찰하한율 (%)</label><input id="k_fl" type="number" step="0.001" value="${fl ?? 87.745}"></div>
    <div class="field"><label>예비가격 범위</label><select id="k_sp"><option value="0.02">±2% (국가기관·조달청)</option><option value="0.03">±3% (지자체 등)</option></select></div>
    <div class="field"><label>투찰률 (기초 대비 %)</label><input id="k_x" type="number" step="0.001" value="${x ? x.toFixed(3) : ''}"></div>
  </div>
  <div class="two"><div><div class="note">투찰금액</div><div class="out" id="k_amt">–</div><div class="note" id="k_note"></div></div>
  <div><div class="note">하한 미달 위험 (추첨 시뮬레이션)</div><div class="out" id="k_risk">–</div><div class="note" id="k_hist"></div></div></div>
  <p class="note">공고문에서 예비가격 범위와 하한율을 반드시 확인하세요. 같은 업종이라도 발주기관에 따라 다릅니다.</p></div>`;
}
let SIM = {};
function bindCalc(fl, ok) {
  const go = () => {
    const bss = parseFloat(($('#k_bss').value || '').replace(/[^\d.]/g, '')), f = +$('#k_fl').value, sp = +$('#k_sp').value, x = +$('#k_x').value;
    store.set('g2b_kbss', $('#k_bss').value);
    SIM[sp] = SIM[sp] || simSj(sp);
    const sims = SIM[sp];
    if (f && x) {
      let k = 0; for (const s of sims) if (x < f * s) k++;
      $('#k_risk').textContent = pct(k / sims.length, 1);
      const q = p => sims[Math.floor(p * (sims.length - 1))];
      $('#k_hist').textContent = `하한선 위치(기초 대비) 5~95%: ${(f * q(.05)).toFixed(3)}% ~ ${(f * q(.95)).toFixed(3)}%`;
      if (ok && ok.length) {
        const w = ok.filter(b => b.t <= x && x < b.wr).length;
        $('#k_hist').textContent += ` · 과거 같은 조건 ${fmt(ok.length)}건 중 이 투찰률이었으면 1순위 ${w}건`;
      }
    } else { $('#k_risk').textContent = '–'; $('#k_hist').textContent = ''; }
    if (bss && x) {
      const amt = Math.ceil(bss * x / 100);
      $('#k_amt').textContent = fmt(amt) + '원';
      $('#k_note').textContent = f ? `하한가 범위 ${fmt(Math.ceil(bss * f / 100 * (1 - sp)))} ~ ${fmt(Math.ceil(bss * f / 100 * (1 + sp)))}원` : '';
    } else { $('#k_amt').textContent = '–'; $('#k_note').textContent = ''; }
  };
  ['k_bss', 'k_fl', 'k_sp', 'k_x'].forEach(id => { const el = $('#' + id); if (el) el.oninput = el.onchange = go; });
  if ($('#k_sp') && fl && fl < 85) $('#k_sp').value = '0.02';
  if ($('#k_bss')) go();
}

/* ---------- 경쟁 분석 */
function renderCompete(v, sel) {
  const done = sel.filter(b => !isFail(b));
  const ns = done.map(b => b.n);
  const below = mean(done.filter(b => b.n).map(b => (b.n - b.nr) / b.n));
  const margin = median(done.filter(b => b.t && b.wr).map(b => b.wr - b.t));
  const wins = {};
  done.forEach(b => { if (b.wb || b.wc) { const k = b.wb || b.wc; (wins[k] = wins[k] || {nm: b.wc, c: 0}).c++; } });
  const wl = Object.values(wins).sort((a, b) => b.c - a.c);
  const tot = wl.reduce((s, w) => s + w.c, 0) || 1;
  const hhi = wl.reduce((s, w) => s + (100 * w.c / tot) ** 2, 0);
  let html = kpis([
    ['참가업체 수 (중앙값)', fmt(median(ns)), `25~75%: ${fmt(quantile(ns, .25))}~${fmt(quantile(ns, .75))}`],
    ['무작위 기준선', pct(mean(done.map(b => 1 / b.n)), 2), '평균 1/참가업체 수'],
    ['하한 미달 비율', pct(below, 1), '투찰했지만 하한선 아래(순위 없음)'],
    ['1순위 여유폭', fmt(margin, 3) + '%p', '1순위 − 하한선, 중앙값'],
    ['낙찰 집중도 (HHI)', fmt(hhi), hhi < 1500 ? '분산된 시장' : hhi < 2500 ? '다소 집중' : '집중된 시장'],
  ]);
  const months = {};
  sel.forEach(b => { const k = ymKey(b._d); (months[k] = months[k] || []).push(b); });
  const mk = Object.keys(months).sort();
  html += `<div class="two"><div class="card"><h2>월별 경쟁 강도</h2><p class="lead">막대는 개찰 건수, 선은 참가업체 수 중앙값입니다.</p><div class="chartbox"><canvas id="c1"></canvas></div></div>
    <div class="card"><h2>참가업체 수 분포</h2><p class="lead">이 조건의 입찰에 보통 몇 개 업체가 들어오는지입니다.</p><div class="chartbox"><canvas id="c2"></canvas></div></div></div>`;
  const byB = {};
  sel.forEach(b => { const k = bssBucket(b.bss ?? b.ps); (byB[k] = byB[k] || []).push(b); });
  html += `<div class="card"><h2>금액대별 경쟁</h2><p class="lead">금액이 커질수록 경쟁이 어떻게 달라지는지 봅니다.</p><div class="tablewrap"><table><tr><th>기초금액</th><th class="r">입찰</th><th class="r">참가업체 중앙값</th><th class="r">무작위 기준선</th><th class="r">유찰률</th><th class="r">1순위 여유폭</th></tr>${
    BUCKETS.filter(k => byB[k]).map(k => { const g = byB[k], d = g.filter(b => !isFail(b)); return `<tr><td>${k}</td><td class="r num">${fmt(g.length)}</td><td class="r num">${fmt(median(d.map(b => b.n)))}</td><td class="r num">${pct(mean(d.map(b => 1 / b.n)), 2)}</td><td class="r num">${pct(g.filter(isFail).length / g.length)}</td><td class="r num">${fmt(median(d.filter(b => b.t && b.wr).map(b => b.wr - b.t)), 3)}</td></tr>`; }).join('')
  }</table></div></div>`;
  const inst = {};
  done.forEach(b => { const k = b.inst || '미상'; (inst[k] = inst[k] || []).push(b); });
  const il = Object.entries(inst).sort((a, b) => b[1].length - a[1].length).slice(0, 15);
  html += `<div class="two"><div class="card"><h2>낙찰 상위 업체</h2><p class="lead">1순위 기준, 상위 15개사.</p><div class="tablewrap"><table><tr><th>업체</th><th class="r">1순위</th><th class="r">점유율</th></tr>${
    wl.slice(0, 15).map(w => `<tr><td>${esc(w.nm)}</td><td class="r num">${w.c}</td><td class="r num">${pct(w.c / tot)}</td></tr>`).join('')}</table></div></div>
    <div class="card"><h2>발주기관별</h2><p class="lead">입찰이 많은 기관 15곳.</p><div class="tablewrap"><table><tr><th>기관</th><th class="r">입찰</th><th class="r">참가업체 중앙값</th><th class="r">사정률 중앙값</th></tr>${
    il.map(([k, g]) => `<tr><td>${esc(k)}</td><td class="r num">${g.length}</td><td class="r num">${fmt(median(g.map(b => b.n)))}</td><td class="r num">${fmt(median(g.filter(b => b.pre && b.bss).map(b => b.pre / b.bss * 100)), 3)}%</td></tr>`).join('')}</table></div></div></div>`;
  v.innerHTML = html;
  mkChart('c1', {data: {labels: mk, datasets: [
    {type: 'bar', label: '개찰 건수', data: mk.map(k => months[k].length), backgroundColor: css('--line'), yAxisID: 'y'},
    {type: 'line', label: '참가업체 중앙값', data: mk.map(k => median(months[k].filter(b => !isFail(b)).map(b => b.n))), borderColor: css('--chart1'), borderWidth: 2, pointRadius: 3, yAxisID: 'y2'}]},
    options: {maintainAspectRatio: false, animation: false, scales: {y: {beginAtZero: true, title: {display: true, text: '건수'}}, y2: {position: 'right', beginAtZero: true, grid: {drawOnChartArea: false}, title: {display: true, text: '업체 수'}}}}});
  const bins = [[2, 10], [10, 30], [30, 100], [100, 300], [300, 1000], [1000, 1e9]], bl = ['2–9', '10–29', '30–99', '100–299', '300–999', '1000+'];
  mkChart('c2', {type: 'bar', data: {labels: bl, datasets: [{label: '입찰 수', data: bins.map(([a, z]) => ns.filter(n => n >= a && n < z).length), backgroundColor: css('--chart1')}]},
    options: {maintainAspectRatio: false, animation: false, plugins: {legend: {display: false}}, scales: {x: {title: {display: true, text: '참가업체 수'}}, y: {beginAtZero: true}}}});
}

/* ---------- 유찰 분석 */
function renderFail(v, sel) {
  const fails = sel.filter(isFail);
  const reb = sel.filter(b => (b.id || '').split('-')[1] > '000');
  const res = {};
  sel.forEach(b => { const k = b.res || '(빈 값)'; res[k] = (res[k] || 0) + 1; });
  let html = kpis([
    ['유찰률', pct(fails.length / sel.length), `${fmt(fails.length)} / ${fmt(sel.length)}건`],
    ['재공고 비율', pct(reb.length / sel.length), '공고차수 001 이상'],
    ['유찰 건 참가업체', fmt(mean(fails.map(b => b.n)), 1), '평균 (0~1이면 무응찰·단독응찰)'],
  ]);
  const months = {};
  sel.forEach(b => { const k = ymKey(b._d); (months[k] = months[k] || []).push(b); });
  const mk = Object.keys(months).sort();
  const by = (keyf, top = 12) => { const g = {}; sel.forEach(b => { const k = keyf(b); (g[k] = g[k] || []).push(b); }); return Object.entries(g).sort((a, b) => b[1].length - a[1].length).slice(0, top); };
  const tbl = (rows, name) => `<table><tr><th>${name}</th><th class="r">입찰</th><th class="r">유찰</th><th class="r">유찰률</th></tr>${rows.map(([k, g]) => { const f = g.filter(isFail).length; return `<tr><td>${esc(k)}</td><td class="r num">${g.length}</td><td class="r num">${f}</td><td class="r num">${pct(f / g.length)}</td></tr>`; }).join('')}</table>`;
  html += `<div class="card"><h2>월별 유찰률</h2><p class="lead">유찰이 늘면 그 업종의 경쟁이 약해지고 있다는 신호입니다. 유찰 뒤 재공고는 참가업체가 적은 경우가 많습니다.</p><div class="chartbox"><canvas id="f1"></canvas></div></div>
    <div class="two"><div class="card"><h2>금액대별</h2><div class="tablewrap">${tbl(BUCKETS.map(k => [k, sel.filter(b => bssBucket(b.bss ?? b.ps) === k)]).filter(x => x[1].length), '기초금액')}</div></div>
    <div class="card"><h2>개찰결과 구분</h2><div class="tablewrap"><table><tr><th>구분</th><th class="r">건수</th></tr>${Object.entries(res).sort((a, b) => b[1] - a[1]).map(([k, c]) => `<tr><td>${esc(k)}</td><td class="r num">${c}</td></tr>`).join('')}</table></div></div></div>
    <div class="card"><h2>유찰이 많은 발주기관</h2><div class="tablewrap">${tbl(by(b => b.inst || '미상').filter(x => x[1].length >= 3).sort((a, b) => b[1].filter(isFail).length / b[1].length - a[1].filter(isFail).length / a[1].length).slice(0, 12), '기관')}</div></div>
    <div class="card"><h2>최근 유찰 건</h2><p class="lead">재공고가 나오면 진행 공고 탭에서 확인하세요.</p><div class="tablewrap"><table><tr><th>개찰일</th><th>공고명</th><th>기관</th><th class="r">기초금액</th><th class="r">참가</th><th>결과</th></tr>${
      fails.slice().sort((a, b) => b._d - a._d).slice(0, 40).map(b => `<tr><td class="num">${b.dt}</td><td>${esc(b.nm)}</td><td>${esc(b.inst)}</td><td class="r num">${eok(b.bss ?? b.ps)}</td><td class="r num">${b.n}</td><td><span class="pill warn">${esc(b.res || '유찰')}</span></td></tr>`).join('')}</table></div></div>`;
  v.innerHTML = html;
  mkChart('f1', {data: {labels: mk, datasets: [
    {type: 'line', label: '유찰률 (%)', data: mk.map(k => +(100 * months[k].filter(isFail).length / months[k].length).toFixed(1)), borderColor: css('--chart2'), borderWidth: 2, pointRadius: 3}]},
    options: {maintainAspectRatio: false, animation: false, plugins: {legend: {display: false}}, scales: {y: {beginAtZero: true, title: {display: true, text: '유찰률 (%)'}}}}});
}

/* ---------- 진행 공고 (참여 추천) */
function renderUpcoming(v, hist, cf) {
  const today = DATA.meta.today;
  const ups = UP.filter(cf).filter(n => n.odt >= today);
  const done = hist.filter(b => !isFail(b));
  const lb = a => a ? Math.round(Math.log10(a) * 2) / 2 : null;
  const rows = ups.map(n => {
    const amt = n.ps || n.ab, k = lb(amt);
    let sim = done.filter(b => b.div === n.div && lb(b.ps ?? b.bss) === k && b.inst === n.inst), basis = '같은 기관·금액대';
    if (sim.length < 5) { sim = done.filter(b => b.div === n.div && lb(b.ps ?? b.bss) === k); basis = '같은 금액대'; }
    if (sim.length < 5) { sim = done.filter(b => b.div === n.div); basis = '업종 전체'; }
    const fl = hist.filter(b => b.inst === n.inst && b.fl).map(b => b.fl);
    return {n, amt, sim: sim.length, basis, med: median(sim.map(b => b.n)), q1: quantile(sim.map(b => b.n), .25), q3: quantile(sim.map(b => b.n), .75),
      p: mean(sim.map(b => 1 / b.n)), fail: sim.length ? hist.filter(b => b.div === n.div && lb(b.ps ?? b.bss) === k).filter(isFail).length / Math.max(1, hist.filter(b => b.div === n.div && lb(b.ps ?? b.bss) === k).length) : null,
      fl: fl.length ? median(fl) : null};
  }).filter(r => r.sim).sort((a, b) => b.p - a.p);
  const dday = s => { const d = Math.round((Date.parse(s) - Date.parse(today)) / 864e5); return d === 0 ? '오늘' : 'D-' + d; };
  v.innerHTML = kpis([
    ['진행 중 공고', fmt(ups.length) + '건', `개찰 ${today} 이후`],
    ['예상 경쟁 최저', rows.length ? fmt(Math.min(...rows.map(r => r.med))) + '개사' : '–', '참가업체 수 중앙값'],
  ]) + `<div class="card"><h2>참여 추천 순위</h2><p class="lead">비슷한 과거 입찰(같은 기관·금액대 → 금액대 → 업종 순으로 넓힘)의 참가업체 수로 기대 낙찰 확률(평균 1/참가업체 수)을 매겼습니다. 위쪽일수록 경쟁이 적을 것으로 예상됩니다.</p>
    ${rows.length ? `<div class="tablewrap"><table><tr><th>개찰</th><th>공고명</th><th>기관</th><th class="r">추정가격</th><th class="r">예상 참가</th><th class="r">기대 확률</th><th class="r">과거 유찰률</th><th>근거</th></tr>${
      rows.slice(0, 120).map(r => `<tr><td class="num">${dday(r.n.odt)}<br><span class="muted">${r.n.odt}</span></td><td>${r.n.url ? `<a href="${esc(r.n.url)}" target="_blank" rel="noopener">${esc(r.n.nm)}</a>` : esc(r.n.nm)}<br><span class="muted">${esc(r.n.ind).slice(0, 40)}${r.n.rgn ? ' · ' + esc(r.n.rgn).slice(0, 24) : ''}</span></td><td>${esc(r.n.inst)}</td><td class="r num">${eok(r.amt)}</td><td class="r num">${fmt(r.med)}<br><span class="muted">${fmt(r.q1)}~${fmt(r.q3)}</span></td><td class="r num"><b>${pct(r.p, 2)}</b></td><td class="r num">${pct(r.fail)}</td><td><span class="pill">${r.basis} ${r.sim}건</span></td></tr>`).join('')}</table></div>`
      : '<div class="empty">조건에 맞는 진행 중 공고가 없습니다.</div>'}</div>`;
}

/* ---------- 내 회사 */
function renderMine(v, sel) {
  if (!DATA.meta.my_set) {
    v.innerHTML = `<div class="card"><h2>내 회사 성적</h2><p class="lead">GitHub 저장소의 Settings → Secrets and variables → Actions 에 <b>MY_BIZNO</b>(사업자등록번호, 여러 개면 쉼표)를 넣으면 다음 수집부터 우리 회사의 투찰 기록이 이 탭에 나타납니다. 이미 받은 날짜는 다시 받을 때 반영됩니다.</p></div>`;
    return;
  }
  const mine = sel.filter(b => b.my != null).sort((a, b) => b._d - a._d);
  const win = mine.filter(b => b.mr === 1), lowf = mine.filter(b => b.mr === -1 || (b.t && b.my < b.t));
  const close = mine.filter(b => b.mr > 1 && b.t && b.wr && b.my - b.wr < 0.05);
  const exp = mean(mine.filter(b => b.n).map(b => 1 / b.n));
  v.innerHTML = kpis([
    ['참여', fmt(mine.length) + '건', scopeLabel()],
    ['1순위', fmt(win.length) + '건', `실제 ${pct(win.length / (mine.length || 1))} · 무작위 기대 ${pct(exp)}`],
    ['하한 미달·탈락', fmt(lowf.length) + '건', pct(lowf.length / (mine.length || 1))],
    ['아깝게 놓침', fmt(close.length) + '건', '1순위와 0.05%p 이내'],
  ]) + `<div class="card"><h2>최근 참여 내역</h2><p class="lead">실제 1순위 수가 무작위 기대보다 꾸준히 적다면 투찰률 습관(하한선과의 거리)을 점검하세요.</p><div class="tablewrap"><table><tr><th>개찰일</th><th>공고명</th><th class="r">참가</th><th class="r">내 투찰률</th><th class="r">하한선</th><th class="r">1순위</th><th>결과</th></tr>${
    mine.slice(0, 80).map(b => `<tr><td class="num">${b.dt}</td><td>${esc(b.nm)}</td><td class="r num">${b.n}</td><td class="r num">${fmt(b.my, 3)}</td><td class="r num">${fmt(b.t, 3)}</td><td class="r num">${fmt(b.wr, 3)}</td><td>${b.mr === 1 ? '<span class="pill ok">1순위</span>' : b.mr === -1 ? '<span class="pill warn">하한 미달·부적격</span>' : `<span class="pill">${b.mr}위</span>`}</td></tr>`).join('')}</table></div></div>`;
}
