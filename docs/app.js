/* 입찰 전략실 — 화면 전용 (계산은 analysis.js 의 G2B.* 가 한다).
 * 연구실 콘셉트 등으로 화면을 바꿀 때는 이 파일과 index.html 만 바꾸면 된다. */
'use strict';
const A = window.G2B;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (v, d = 0) => v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('ko-KR', {minimumFractionDigits: d, maximumFractionDigits: d});
const pct = (v, d = 1) => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d) + '%';
const eok = v => v == null ? '–' : (v / 1e8).toLocaleString('ko-KR', {maximumFractionDigits: 2}) + '억';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  sset(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
};

/* ------------------------------------------------------------ 잠금 해제 */
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

let D = null; // {meta, bids, upcoming}
async function unlock(pw) {
  const btn = $('#unlock'); btn.disabled = true; btn.textContent = '여는 중…'; $('#err').textContent = '';
  try {
    const r = await fetch('data.bin?v=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) throw new Error('nodata');
    D = A.prepare(await decrypt(await r.arrayBuffer(), pw));
    store.sset('g2b_pw', pw);
    onLoaded();
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

function onLoaded() {
  $('#lock').style.display = 'none'; $('#app').style.display = 'block';
  const m = D.meta, st = m.status || {};
  $('#asof').textContent = `${m.last || '-'} 기준 · 갱신 ${m.built}`;
  const cov = Object.entries(m.coverage || {}).map(([k, v]) => `${k} ${v.days}/${v.expected}일`).join(' · ');
  const backfill = st.left_days ? ` · 아직 못 받은 낙찰 ${fmt(st.left_days)}일치, 매일 자동으로 이어받아 약 ${fmt(st.eta_days)}일 뒤 완료 예상`
    : st.left ? ` · 남은 작업 ${fmt(st.left)}개(매일 자동으로 이어받음)` : '';
  $('#foot').innerHTML = `데이터: 조달청 공공데이터개방표준서비스(낙찰·입찰공고). 적재 현황 ${esc(cov)}${esc(backfill)}` +
    `<br>확률은 과거 자료로 추정한 값이며 낙찰을 보장하지 않습니다. 투찰은 나라장터에서 직접 하십시오.`;
  buildControls(); render();
  if (window.Guide && Guide.firstVisit()) setTimeout(Guide.open, 300);   // 처음 연 사람에게만 안내 지도
}
$('#guidebtn').addEventListener('click', () => window.Guide && Guide.open());
/* 안내 지도(guide.js)가 탭을 바꿀 때 쓰는 연결 고리 */
window.G2BUI = {go(tab) { if (S.tab !== tab) { S.tab = tab; save(); buildControls(); render(); } }};

/* ------------------------------------------------------------ 상태·조작부 */
const PERIODS = [['1', '1개월'], ['3', '3개월'], ['6', '6개월'], ['12', '1년']];
const TABS = [['strategy', '가격 전략'], ['compete', '경쟁 분석'], ['fail', '유찰 분석'], ['upcoming', '진행 공고'], ['mine', '내 회사']];
const S = {cats: ['elec'], period: '3', tab: 'strategy', floor: 'auto', cost: 80, custom: {}};
try { Object.assign(S, JSON.parse(store.get('g2b_state') || '{}')); } catch (e) {}
const save = () => store.set('g2b_state', JSON.stringify(S));

function chip(label, pressed, onclick, cls = '') {
  const b = document.createElement('button');
  b.className = 'chip ' + cls; b.type = 'button'; b.textContent = label;
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false'); b.onclick = onclick; return b;
}
function buildControls() {
  const on = k => S.cats.includes(k);
  const toggle = k => { S.cats = on(k) ? S.cats.filter(x => x !== k) : [...S.cats, k]; save(); buildControls(); render(); };
  const cr = $('#catrow'); cr.querySelectorAll('.chip').forEach(x => x.remove());
  A.CATS.forEach(c => cr.appendChild(chip(c.label, on(c.k), () => toggle(c.k))));
  cr.appendChild(chip('사용자 지정', on('custom'), () => toggle('custom')));
  const moreOn = A.MORE.some(m => on(m.k));
  cr.appendChild(chip(moreOn ? '다른 업종 ▴' : '다른 업종 ▾', false, () => $('#morerow').classList.toggle('open'), 'ghost'));
  const mr = $('#morerow'); mr.innerHTML = '<span class="lbl"></span>';
  A.MORE.forEach(c => mr.appendChild(chip(c.label, on(c.k), () => toggle(c.k))));
  if (moreOn) mr.classList.add('open');
  $('#custom').classList.toggle('open', on('custom'));
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

/* ------------------------------------------------------------ 차트 */
let charts = [];
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function mkChart(id, cfg) {
  const el = document.getElementById(id);
  if (!window.Chart) { if (el) el.parentElement.innerHTML = '<div class="empty">차트 라이브러리를 불러오지 못했습니다(인터넷 연결 확인).</div>'; return; }
  Chart.defaults.font.family = css('--sans'); Chart.defaults.color = css('--muted'); Chart.defaults.borderColor = css('--line');
  charts.push(new Chart(el, cfg));
}

/* ------------------------------------------------------------ 공용 조각 */
const kpis = items => `<div class="kpis">${items.map(([k, v, s]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`).join('')}</div>`;
const card = (title, lead, body) => `<div class="card"><h2>${title}</h2>${lead ? `<p class="lead">${lead}</p>` : ''}${body}</div>`;
const table = (head, rows) => `<div class="tablewrap"><table><tr>${head.map(h => `<th class="${h[1] || ''}">${h[0]}</th>`).join('')}</tr>${rows.join('')}</table></div>`;
const tr = cells => `<tr>${cells.map(c => Array.isArray(c) ? `<td class="${c[1]}">${c[0]}</td>` : `<td>${c}</td>`).join('')}</tr>`;
const R = v => [v, 'r num'];

/* ------------------------------------------------------------ 렌더링 */
function render() {
  if (!D) return;
  charts.forEach(c => c.destroy()); charts = [];
  const cf = A.categoryFilter(S.cats, S.custom);
  const [from, to] = A.periodRange(D.meta.last || D.meta.today, parseInt(S.period, 10));
  const sel = D.bids.filter(b => b._d >= from && b._d <= to && cf(b));
  $('#scope').innerHTML = `<b>${esc(A.categoryLabel(S.cats))}</b> · ${new Date(from).toISOString().slice(0, 10)} ~ ${new Date(to).toISOString().slice(0, 10)} · 입찰 <span class="num">${fmt(sel.length)}</span>건`;
  const v = $('#view');
  if (S.tab === 'upcoming') return viewUpcoming(v, A.upcoming(sel, D.upcoming.filter(cf), D.meta.today));
  if (!sel.length) { v.innerHTML = '<div class="empty">조건에 맞는 입찰이 없습니다. 업종이나 기간을 넓혀 보세요.</div>'; return; }
  if (S.tab === 'strategy') return viewStrategy(v, A.strategy(sel, {floor: S.floor, cost: S.cost}));
  if (S.tab === 'compete') return viewCompete(v, A.compete(sel));
  if (S.tab === 'fail') return viewFail(v, A.fail(sel));
  if (S.tab === 'mine') return viewMine(v, A.mine(sel));
}

/* ---------- 가격 전략 */
function viewStrategy(v, M) {
  S.floor = M.floor;
  const flSel = `<select id="flsel">${M.floors.map(f => `<option value="${f.value}" ${M.floor === f.value ? 'selected' : ''}>하한율 ${f.value}% (${f.count}건)</option>`).join('')}<option value="all" ${M.floor === 'all' ? 'selected' : ''}>전체 하한율 섞기</option></select>`;
  const lead = `기초금액 대비 투찰률을 하나로 고정해 과거 입찰 ${fmt(M.n)}건에 넣어 봤을 때, 1순위가 되었을 비율입니다. 하한율이 다르면 목표 지점이 달라지므로 하한율별로 나눠 봅니다. ${flSel}`;
  const flNum = M.floor !== 'all' ? +M.floor : null;
  if (!M.enough) {
    v.innerHTML = card('투찰률별 낙찰 확률', lead, `<div class="empty">표본이 ${M.n}건이라 곡선을 그리기 어렵습니다. 기간을 늘리거나 업종을 넓혀 주세요.</div>`) + calcHtml(flNum);
    bindStrategy(); bindCalc(M.bids); return;
  }
  const rec = (cls, title, r, desc) => r ? `<div class="rec ${cls}"><div class="t">${title}</div><div class="x">${r.x.toFixed(3)}%</div><div class="d">낙찰 확률 <b class="num">${pct(r.p, 2)}</b> · 하한 미달 위험 <b class="num">${pct(r.risk, 0)}</b></div><div class="note">${desc}</div></div>` : '';
  const sc = M.score;
  v.innerHTML = card('투찰률별 낙찰 확률', lead, `<div class="chartbox"><canvas id="cv"></canvas></div>
    <div class="recs">
      ${rec('main', '확률 최대형', M.recs.best, '과거 자료에서 1순위가 가장 자주 됐을 투찰률')}
      ${rec('', '안전형 (하한 미달 5% 이하)', M.recs.safe, '하한선 아래로 떨어질 위험을 5% 이하로 묶은 가장 낮은 값')}
      ${rec('', `수익형 (원가율 <input id="cost" type="number" value="${S.cost}" step="1" style="width:56px"> %)`, M.recs.profit, '낙찰 확률 × (투찰률 − 원가율)이 가장 큰 값')}
    </div>
    <div class="verdict ${sc.good ? 'good' : 'bad'}"><b>성적표</b> — 앞쪽 ${fmt(sc.trainN)}건으로 고른 ${sc.x.toFixed(3)}%를 뒤쪽 ${fmt(sc.testN)}건에 적용하면 낙찰 확률 <b class="num">${pct(sc.rate, 2)}</b> (95% 구간 ${pct(sc.lo, 1)}~${pct(sc.hi, 1)}), 무작위 기준선(1/참가업체 수)은 <b class="num">${pct(sc.base, 2)}</b>입니다.
      ${sc.good ? '투찰률 선택이 무작위보다 나았습니다.' : '<b>이 업종·기간에서는 투찰률만으로 무작위보다 낫다고 볼 근거가 없습니다.</b> 경쟁이 적은 공고를 고르는 쪽(진행 공고 탭)이 확률을 더 바꿉니다.'}
    </div>`) + kpis([
    ['분석 입찰', fmt(M.n) + '건', M.floor === 'all' ? '하한율 혼합' : `하한율 ${M.floor}%`],
    ['무작위 기준선', pct(M.base, 2), '평균 1/참가업체 수'],
    ['하한선 위치 (중앙값)', fmt(M.stats.tMed, 3) + '%', `기초 대비 · 5~95%: ${fmt(M.stats.t05, 2)}~${fmt(M.stats.t95, 2)}`],
    ['1순위 여유폭 (중앙값)', fmt(M.stats.margin, 3) + '%p', '1순위 투찰률 − 하한선'],
  ]) + calcHtml(flNum, M.recs.best.x);
  const C = M.curve, every = (arr, f) => Array.from(arr).filter((_, i) => i % 5 === 0).map(f);
  const xs = every(C.xs, x => x), base = +(M.base * 100).toFixed(3);
  mkChart('cv', {type: 'line', data: {labels: xs, datasets: [
    {label: '낙찰 확률 (±0.05%p 평활)', data: every(C.sm, p => +(p * 100).toFixed(3)), borderColor: css('--chart1'), borderWidth: 2, pointRadius: 0, yAxisID: 'y'},
    {label: '무작위 기준선', data: xs.map(() => base), borderColor: css('--chart3'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y'},
    {label: '하한 미달 위험', data: every(C.below, p => +(p * 100).toFixed(3)), borderColor: css('--chart2'), borderWidth: 1.5, pointRadius: 0, yAxisID: 'y2'},
  ]}, options: {maintainAspectRatio: false, animation: false, interaction: {mode: 'index', intersect: false},
    scales: {x: {title: {display: true, text: '투찰률 (기초금액 대비 %)'}, ticks: {maxTicksLimit: 10}},
      y: {title: {display: true, text: '낙찰 확률 (%)'}, beginAtZero: true},
      y2: {position: 'right', min: 0, max: 100, title: {display: true, text: '하한 미달 위험 (%)'}, grid: {drawOnChartArea: false}}},
    plugins: {tooltip: {callbacks: {title: i => `투찰률 ${i[0].label}%`, label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%`}}}}});
  bindStrategy(); bindCalc(M.bids);
}
function bindStrategy() {
  const f = $('#flsel'); if (f) f.onchange = () => { S.floor = f.value; save(); render(); };
  const c = $('#cost'); if (c) c.onchange = () => { S.cost = +c.value; save(); render(); };
}
function calcHtml(fl, x) {
  return card('투찰금액 계산기', '공고의 기초금액과 하한율을 넣으면 투찰금액과, 복수예가 추첨(15개 중 4개 평균)을 2만 번 돌려 본 하한 미달 위험을 계산합니다.', `
  <div class="calc">
    <div class="field"><label>기초금액 (원)</label><input id="k_bss" inputmode="numeric" value="${esc(store.get('g2b_kbss') || '')}" placeholder="예: 512,300,000"></div>
    <div class="field"><label>낙찰하한율 (%)</label><input id="k_fl" type="number" step="0.001" value="${fl ?? 87.745}"></div>
    <div class="field"><label>예비가격 범위</label><select id="k_sp"><option value="0.02">±2% (국가기관·조달청)</option><option value="0.03">±3% (지자체 등)</option></select></div>
    <div class="field"><label>투찰률 (기초 대비 %)</label><input id="k_x" type="number" step="0.001" value="${x ? x.toFixed(3) : ''}"></div>
  </div>
  <div class="two"><div><div class="note">투찰금액</div><div class="out" id="k_amt">–</div><div class="note" id="k_note"></div></div>
  <div><div class="note">하한 미달 위험 (추첨 시뮬레이션)</div><div class="out" id="k_risk">–</div><div class="note" id="k_hist"></div></div></div>
  <p class="note">공고문에서 예비가격 범위와 하한율을 반드시 확인하세요. 같은 업종이라도 발주기관에 따라 다릅니다.</p>`);
}
function bindCalc(hist) {
  if (!$('#k_bss')) return;
  const go = () => {
    store.set('g2b_kbss', $('#k_bss').value);
    const r = A.calc({bss: parseFloat(($('#k_bss').value || '').replace(/[^\d.]/g, '')), fl: +$('#k_fl').value,
      span: +$('#k_sp').value, x: +$('#k_x').value}, hist);
    $('#k_risk').textContent = r.risk != null ? pct(r.risk, 1) : '–';
    $('#k_hist').textContent = r.floorBand ? `하한선 위치(기초 대비) 5~95%: ${r.floorBand[0].toFixed(3)}% ~ ${r.floorBand[1].toFixed(3)}%` +
      (r.pastN ? ` · 과거 같은 조건 ${fmt(r.pastN)}건 중 이 투찰률이었으면 1순위 ${r.pastWins}건` : '') : '';
    $('#k_amt').textContent = r.amount ? fmt(r.amount) + '원' : '–';
    $('#k_note').textContent = r.floorPrice ? `하한가 범위 ${fmt(r.floorPrice[0])} ~ ${fmt(r.floorPrice[1])}원` : '';
  };
  ['k_bss', 'k_fl', 'k_sp', 'k_x'].forEach(id => { const el = $('#' + id); el.oninput = el.onchange = go; });
  go();
}

/* ---------- 경쟁 분석 */
function viewCompete(v, M) {
  v.innerHTML = kpis([
    ['참가업체 수 (중앙값)', fmt(M.nMed), `25~75%: ${fmt(M.nQ1)}~${fmt(M.nQ3)}`],
    ['무작위 기준선', pct(M.base, 2), '평균 1/참가업체 수'],
    ['하한 미달 비율', pct(M.belowRate, 1), '투찰했지만 하한선 아래(순위 없음)'],
    ['1순위 여유폭', fmt(M.margin, 3) + '%p', '1순위 − 하한선, 중앙값'],
    ['낙찰 집중도 (HHI)', fmt(M.hhi), M.hhiLabel],
  ]) + `<div class="two">${card('월별 경쟁 강도', '막대는 개찰 건수, 선은 참가업체 수 중앙값입니다.', '<div class="chartbox"><canvas id="c1"></canvas></div>')}
    ${card('참가업체 수 분포', '이 조건의 입찰에 보통 몇 개 업체가 들어오는지입니다.', '<div class="chartbox"><canvas id="c2"></canvas></div>')}</div>` +
    card('금액대별 경쟁', '금액이 커질수록 경쟁이 어떻게 달라지는지 봅니다.', table(
      [['기초금액'], ['입찰', 'r'], ['참가업체 중앙값', 'r'], ['무작위 기준선', 'r'], ['유찰률', 'r'], ['1순위 여유폭', 'r']],
      M.byBucket.map(r => tr([r.bucket, R(fmt(r.count)), R(fmt(r.nMed)), R(pct(r.base, 2)), R(pct(r.failRate)), R(fmt(r.margin, 3))])))) +
    `<div class="two">${card('낙찰 상위 업체', '1순위 기준, 상위 15개사.', table([['업체'], ['1순위', 'r'], ['점유율', 'r']],
      M.winners.slice(0, 15).map(w => tr([esc(w.name), R(w.wins), R(pct(w.share))]))))}
    ${card('발주기관별', '입찰이 많은 기관 15곳.', table([['기관'], ['입찰', 'r'], ['참가업체 중앙값', 'r'], ['사정률 중앙값', 'r']],
      M.insts.slice(0, 15).map(i => tr([esc(i.name), R(i.count), R(fmt(i.nMed)), R(fmt(i.sjMed, 3) + '%')]))))}</div>`;
  const mk = M.months.map(m => m.month);
  mkChart('c1', {data: {labels: mk, datasets: [
    {type: 'bar', label: '개찰 건수', data: M.months.map(m => m.count), backgroundColor: css('--line'), yAxisID: 'y'},
    {type: 'line', label: '참가업체 중앙값', data: M.months.map(m => m.nMed), borderColor: css('--chart1'), borderWidth: 2, pointRadius: 3, yAxisID: 'y2'}]},
    options: {maintainAspectRatio: false, animation: false, scales: {y: {beginAtZero: true, title: {display: true, text: '건수'}}, y2: {position: 'right', beginAtZero: true, grid: {drawOnChartArea: false}, title: {display: true, text: '업체 수'}}}}});
  mkChart('c2', {type: 'bar', data: {labels: M.nHist.map(h => h.label), datasets: [{label: '입찰 수', data: M.nHist.map(h => h.count), backgroundColor: css('--chart1')}]},
    options: {maintainAspectRatio: false, animation: false, plugins: {legend: {display: false}}, scales: {x: {title: {display: true, text: '참가업체 수'}}, y: {beginAtZero: true}}}});
}

/* ---------- 유찰 분석 */
function viewFail(v, M) {
  const failTable = (rows, key, name) => table([[name], ['입찰', 'r'], ['유찰', 'r'], ['유찰률', 'r']],
    rows.map(r => tr([esc(r[key]), R(r.count), R(r.fails), R(pct(r.rate))])));
  v.innerHTML = kpis([
    ['유찰률', pct(M.rate), `${fmt(M.fails)} / ${fmt(M.total)}건`],
    ['재공고 비율', pct(M.rebidRate), '공고차수 001 이상'],
    ['유찰 건 참가업체', fmt(M.failBidders, 1), '평균 (0~1이면 무응찰·단독응찰)'],
  ]) + card('월별 유찰률', '유찰이 늘면 그 업종의 경쟁이 약해지고 있다는 신호입니다. 유찰 뒤 재공고는 참가업체가 적은 경우가 많습니다.', '<div class="chartbox"><canvas id="f1"></canvas></div>') +
    `<div class="two">${card('금액대별', '', failTable(M.byBucket, 'bucket', '기초금액'))}
    ${card('개찰결과 구분', '', table([['구분'], ['건수', 'r']], M.results.map(r => tr([esc(r.name), R(r.count)]))))}</div>` +
    card('유찰이 많은 발주기관', '', failTable(M.byInst.slice(0, 12), 'inst', '기관')) +
    card('최근 유찰 건', '재공고가 나오면 진행 공고 탭에서 확인하세요.', table(
      [['개찰일'], ['공고명'], ['기관'], ['기초금액', 'r'], ['참가', 'r'], ['결과']],
      M.recent.slice(0, 40).map(b => tr([[b.dt, 'num'], esc(b.nm), esc(b.inst), R(eok(b.bss ?? b.ps)), R(b.n), `<span class="pill warn">${esc(b.res || '유찰')}</span>`]))));
  mkChart('f1', {data: {labels: M.months.map(m => m.month), datasets: [
    {type: 'line', label: '유찰률 (%)', data: M.months.map(m => +(100 * m.rate).toFixed(1)), borderColor: css('--chart2'), borderWidth: 2, pointRadius: 3}]},
    options: {maintainAspectRatio: false, animation: false, plugins: {legend: {display: false}}, scales: {y: {beginAtZero: true, title: {display: true, text: '유찰률 (%)'}}}}});
}

/* ---------- 진행 공고 */
function viewUpcoming(v, M) {
  const dday = d => d === 0 ? '오늘' : 'D-' + d;
  v.innerHTML = kpis([
    ['진행 중 공고', fmt(M.open) + '건', `개찰 ${D.meta.today} 이후`],
    ['예상 경쟁 최저', M.minN != null ? fmt(M.minN) + '개사' : '–', '참가업체 수 중앙값'],
  ]) + card('참여 추천 순위', '비슷한 과거 입찰(같은 기관·금액대 → 금액대 → 업종 순으로 넓힘)의 참가업체 수로 기대 낙찰 확률(평균 1/참가업체 수)을 매겼습니다. 위쪽일수록 경쟁이 적을 것으로 예상됩니다.',
    M.rows.length ? table([['개찰'], ['공고명'], ['기관'], ['추정가격', 'r'], ['예상 참가', 'r'], ['기대 확률', 'r'], ['과거 유찰률', 'r'], ['근거']],
      M.rows.slice(0, 120).map(r => { const n = r.notice; return tr([
        [`${dday(r.dday)}<br><span class="muted">${n.odt}</span>`, 'num'],
        `${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.nm)}</a>` : esc(n.nm)}<br><span class="muted">${esc(n.ind.slice(0, 40))}${n.rgn ? ' · ' + esc(n.rgn.slice(0, 24)) : ''}</span>`,
        esc(n.inst), R(eok(r.amount)), R(`${fmt(r.nMed)}<br><span class="muted">${fmt(r.nQ1)}~${fmt(r.nQ3)}</span>`),
        R(`<b>${pct(r.p, 2)}</b>`), R(pct(r.failRate)), `<span class="pill">${r.basis} ${r.similar}건</span>`]); }))
      : '<div class="empty">조건에 맞는 진행 중 공고가 없습니다.</div>');
}

/* ---------- 내 회사 */
function viewMine(v, M) {
  if (!D.meta.my_set) {
    v.innerHTML = card('내 회사 성적', 'GitHub 저장소의 Settings → Secrets and variables → Actions 에 <b>MY_BIZNO</b>(사업자등록번호, 여러 개면 쉼표)를 넣으면 다음 수집부터 우리 회사의 투찰 기록이 이 탭에 나타납니다. 이미 받은 날짜는 다시 받을 때 반영됩니다.', '');
    return;
  }
  const res = b => b.mr === 1 ? '<span class="pill ok">1순위</span>' : b.mr === -1 ? '<span class="pill warn">하한 미달·부적격</span>' : `<span class="pill">${b.mr}위</span>`;
  v.innerHTML = kpis([
    ['참여', fmt(M.count) + '건', esc(A.categoryLabel(S.cats))],
    ['1순위', fmt(M.wins) + '건', `실제 ${pct(M.winRate)} · 무작위 기대 ${pct(M.expected)}`],
    ['하한 미달·탈락', fmt(M.lowFloor) + '건', pct(M.lowFloorRate)],
    ['아깝게 놓침', fmt(M.close) + '건', '1순위와 0.05%p 이내'],
  ]) + card('최근 참여 내역', '실제 1순위 수가 무작위 기대보다 꾸준히 적다면 투찰률 습관(하한선과의 거리)을 점검하세요.', table(
    [['개찰일'], ['공고명'], ['참가', 'r'], ['내 투찰률', 'r'], ['하한선', 'r'], ['1순위', 'r'], ['결과']],
    M.list.slice(0, 80).map(b => tr([[b.dt, 'num'], esc(b.nm), R(b.n), R(fmt(b.my, 3)), R(fmt(b.t, 3)), R(fmt(b.wr, 3)), res(b)]))));
}
