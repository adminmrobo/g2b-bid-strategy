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
  const cov = `${m.first || '-'} ~ ${m.last || '-'} (조달청 개방표준 API는 2026-04-20 이전 낙찰 자료를 주지 않음)`;
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
const TABS = [['strategy', '가격 전략'], ['compete', '경쟁 분석'], ['fail', '유찰 분석'], ['upcoming', '진행 공고'], ['mine', '내 회사'], ['data', '데이터 목록']];
const S = {cats: ['nara'], period: '6', tab: 'strategy', floor: 'all', custom: {}};
try { Object.assign(S, JSON.parse(store.get('g2b_state') || '{}')); } catch (e) {}
if (!S.v2) { S.cats = ['nara']; S.floor = 'all'; S.v2 = 1; }   // 판 2: 기본 업종을 '전기·소방 감리'로
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
  if ($('#c_rules') && !$('#c_rules').innerHTML) $('#c_rules').innerHTML = rulesHtml();
  if ($('#c_check')) $('#c_check').onclick = () => { S.tab = 'data'; S.dpage = 0; save(); buildControls(); render(); window.scrollTo(0, 0); };
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
  const d0 = new Date(from).toISOString().slice(0, 10);
  const short = D.meta.first && d0 < D.meta.first ? ` <span class="muted">(조달청 자료는 ${D.meta.first}부터 있음)</span>` : '';
  $('#scope').innerHTML = `<b>${esc(A.categoryLabel(S.cats))}</b> · ${d0} ~ ${new Date(to).toISOString().slice(0, 10)} · 입찰 <span class="num">${fmt(sel.length)}</span>건${short}`;
  const v = $('#view');
  if (S.tab === 'upcoming') return viewUpcoming(v, A.upcoming(sel, D.upcoming.filter(cf), D.meta.today));
  if (!sel.length) { v.innerHTML = '<div class="empty">조건에 맞는 입찰이 없습니다. 업종이나 기간을 넓혀 보세요.</div>'; return; }
  if (S.tab === 'strategy') return viewStrategy(v, A.strategy(sel, {floor: S.floor, half: S.half || '0.5'}));
  if (S.tab === 'compete') return viewCompete(v, A.compete(sel));
  if (S.tab === 'fail') return viewFail(v, A.fail(sel));
  if (S.tab === 'mine') return viewMine(v, A.mine(sel));
  if (S.tab === 'data') return viewData(v, sel, D.bids.filter(b => b._d >= from && b._d <= to));
}

/* ---------- 가격 전략 (사정률 구간) */
function viewStrategy(v, M) {
  S.floor = M.floor;
  const flSel = `<select id="flsel"><option value="all" ${M.floor === 'all' ? 'selected' : ''}>하한율 전체 (사정률로 환산해 함께)</option>${M.floors.map(f => `<option value="${f.value}" ${M.floor === f.value ? 'selected' : ''}>하한율 ${f.value}%만 (${f.count}건)</option>`).join('')}</select>`;
  const skip = M.unknownFloor ? ` <span class="pill warn">하한선을 알 수 없는 공사 ${fmt(M.unknownFloor)}건 제외</span>` : '';
  const widthBtns = `<div class="seg" role="group" aria-label="구간 범위">${A.WIDTHS.map(w => `<button type="button" class="segbtn" data-half="${w.key}" aria-pressed="${M.half.key === w.key}">${w.label}</button>`).join('')}</div>`;
  const lead = `사정률(투찰금액 ÷ (기초금액 × 하한율) × 100)을 가운데 값 ${M.half.label} 구간으로 나눠, 과거 입찰 ${fmt(M.n)}건에 그 구간으로 넣었다면 1순위가 되었을 확률을 매겼습니다.${skip}
    <span class="ctlrow"><span class="ctl">구간 범위 ${widthBtns}</span><span class="ctl">${flSel}</span></span>
    <span class="hint"><b>구간 범위는 이렇게 고르세요.</b> 범위를 좁히면(±0.025, ±0.01) 사정률을 더 촘촘하게 볼 수 있습니다. 하지만 과거 1순위가 여러 칸에 흩어지기 때문에, 한 칸에 남는 근거(표의 '이 구간에 든 1순위 수')가 몇 건으로 줄어듭니다. 그러면 우연히 몇 번 맞은 칸이 1순위로 올라오기 쉬워서, 확률 숫자는 높아 보여도 믿을 만함은 떨어집니다. 넓은 범위(±0.5)로 큰 방향을 먼저 정하고, 좁은 범위는 그 안에서 참고용으로 보세요. 성적표가 범위마다 실제로 맞았는지를 따로 알려 줍니다.</span>`;
  if (!M.enough) {
    v.innerHTML = card('확률이 높은 사정률 구간', lead, `<div class="empty">표본이 ${M.n}건이라 구간을 매기기 어렵습니다. 기간을 늘리거나 업종을 넓혀 주세요.</div>`) + calcHtml(null);
    bindStrategy(); bindCalc(M.bids); return;
  }
  const B = M.bands, top = B[0], sc = M.score;
  const rng = b => { const [f, t] = b.label.split(' ~ '); return `<span>${f}</span> <span>~ ${t}</span>`; };
  const riskTxt = r => r >= 0.5 ? `<span class="pill warn">${pct(r, 0)}</span>` : `<span class="pill">${pct(r, 0)}</span>`;
  v.innerHTML = card('확률이 높은 사정률 구간', lead, `
    <div class="bands">${B.map(b => `<div class="band ${b.rank === 1 ? 'main' : ''}">
      <div class="rk">${b.rank}순위</div><div class="rng num">${rng(b)}</div><div class="pp num">약 ${pct(b.p, 1)}</div>
      <div class="cnt num">(낙찰 ${fmt(b.won)}건 / 투찰 ${fmt(b.tried)}건)</div></div>`).join('')}</div>
    <p class="bandsay">1순위 구간 <b class="num">${top.label}</b>: 이 구간으로 투찰했다면 과거 <b class="num">${fmt(top.tried)}건</b> 중 실제 낙찰(1순위)은 약 <b class="num">${fmt(top.won)}건</b>입니다.</p>
    <div class="tablewrap"><table class="bt">
      <tr><th>순위</th><th>사정률 구간</th><th class="r">낙찰 확률</th><th class="r">구간 가운데에서 하한 미달 위험</th><th class="r">이 구간에 든 1순위 수</th><th>검증</th></tr>
      ${B.map(b => tr([`${b.rank}순위`, [b.label, 'num'], R(`<b>${pct(b.p, 2)}</b><br><span class="sub">낙찰 ${fmt(b.won)} / 투찰 ${fmt(b.tried)}건</span>`), R(riskTxt(b.riskMid)), R(fmt(b.winners) + '건' + (b.winners < 10 ? ' <span class="pill warn">근거 적음</span>' : '')),
        `<button class="btn mini verify" type="button" data-s="${A.fmtS((b.from + b.to) / 2)}">목록 보기</button>`])).join('')}
    </table></div>
    <p class="note">낙찰 확률 = 낙찰 건 ÷ 투찰 건. 분석에 쓴 과거 입찰 하나하나에 이 구간 사정률로 넣었다고 치고, 그중 1순위가 됐을 건수를 셉니다(구간 안 여러 사정률의 평균이라 건수는 '약'). '이 구간에 든 1순위 수'는 실제 1순위 업체의 사정률이 이 구간에 있었던 건수입니다. 하한 미달 위험은 실제 사정률이 내 사정률보다 높게 나와 하한선 아래가 될 확률입니다. 무작위 기준선(1/참가업체 수)은 <b class="num">${pct(M.base, 2)}</b>입니다.</p>
    <div class="chartbox"><canvas id="cv"></canvas></div>
    <div class="verdict ${sc.good ? 'good' : 'bad'}"><b>성적표</b> — 앞쪽 ${fmt(sc.trainN)}건에서 고른 1순위 구간 ${sc.band ? sc.band.label : '–'}을 뒤쪽 ${fmt(sc.testN)}건에 적용하면 낙찰 확률 <b class="num">${pct(sc.rate, 2)}</b> (95% 구간 ${pct(sc.lo, 1)}~${pct(sc.hi, 1)}), 무작위 기준선은 <b class="num">${pct(sc.base, 2)}</b>입니다.
      ${sc.good ? '구간 선택이 무작위보다 나았습니다.' : '<b>아직 무작위보다 확실히 낫다고 볼 근거는 부족합니다.</b> 자료가 쌓이면 다시 확인하고, 경쟁이 적은 공고 고르기(진행 공고 탭)를 함께 쓰세요.'}
    </div>`) + kpis([
    ['분석 입찰', fmt(M.n) + '건', M.floor === 'all' ? '하한율 전체' : `하한율 ${M.floor}%`],
    ['무작위 기준선', pct(M.base, 2), '평균 1/참가업체 수'],
    ['실제 사정률 (중앙값)', fmt(M.stats.sjMed, 2), `5~95%: ${fmt(M.stats.sj05, 2)} ~ ${fmt(M.stats.sj95, 2)}`],
    ['1순위 투찰 사정률 (중앙값)', fmt(M.stats.winMed, 2), M.safe ? `하한 미달 5% 이하: ${fmt(M.safe.x, 2)} 이상` : ''],
  ]) + calcHtml(M.floor !== 'all' ? +M.floor : null, (top.from + top.to) / 2);
  const C = M.curve, every = (arr, f) => Array.from(arr).filter((_, i) => i % 10 === 0).map(f);
  const xs = every(C.xs, x => x), base = +(M.base * 100).toFixed(3);
  const smP = every(C.sm, p => +(p * 100).toFixed(3));
  const inTop = x => x >= top.from && x <= top.to;
  mkChart('cv', {type: 'line', data: {labels: xs, datasets: [
    {label: `1순위 구간 ${top.label}`, data: xs.map((x, i) => inTop(x) ? smP[i] : null),
      borderColor: 'transparent', backgroundColor: css('--accent-soft'), fill: 'origin', pointRadius: 0, yAxisID: 'y', spanGaps: false},
    {label: '낙찰 확률 (±0.05 평활)', data: smP, borderColor: css('--chart1'), borderWidth: 2, pointRadius: 0, yAxisID: 'y'},
    {label: '무작위 기준선', data: xs.map(() => base), borderColor: css('--chart3'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y'},
    {label: '하한 미달 위험', data: every(C.below, p => +(p * 100).toFixed(3)), borderColor: css('--chart2'), borderWidth: 1.5, pointRadius: 0, yAxisID: 'y2'},
  ]}, options: {maintainAspectRatio: false, animation: false, interaction: {mode: 'index', intersect: false},
    scales: {x: {title: {display: true, text: '사정률 (%)'}, ticks: {autoSkip: false, maxRotation: 0,
      callback: function (v) { const x = +this.getLabelForValue(v); return Math.abs(x - Math.round(x)) < 0.005 ? String(Math.round(x)) : null; }}},
      y: {title: {display: true, text: '낙찰 확률 (%)'}, beginAtZero: true},
      y2: {position: 'right', min: 0, max: 100, title: {display: true, text: '하한 미달 위험 (%)'}, grid: {drawOnChartArea: false}}},
    plugins: {tooltip: {filter: i => i.raw != null && i.datasetIndex > 0, callbacks: {title: i => `사정률 ${A.fmtS(+i[0].label)}`, label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%`}}}}});
  bindStrategy(); bindCalc(M.bids);
}
function bindStrategy() {
  const f = $('#flsel'); if (f) f.onchange = () => { S.floor = f.value; save(); render(); };
  document.querySelectorAll('.segbtn').forEach(b => b.onclick = () => { S.half = b.dataset.half; save(); render(); });
  document.querySelectorAll('.verify').forEach(b => b.onclick = () => {
    S.verifyS = b.dataset.s; S.dview = 'used'; S.dpage = 0; S.tab = 'data'; save(); buildControls(); render(); window.scrollTo(0, 0);
  });
}
function calcHtml(fl, s) {
  return card('투찰금액 계산기', '공고의 기초금액과 하한율, 넣을 사정률을 입력하면 투찰금액을 원 단위로 계산합니다. 하한 미달 위험은 복수예가 추첨(15개 중 4개 평균)을 2만 번 돌려 본 값입니다.', `
  <div class="calc">
    <div class="field"><label>기초금액 (원)</label><input id="k_bss" inputmode="numeric" value="${esc(store.get('g2b_kbss') || '')}" placeholder="예: 512,300,000"></div>
    <div class="field"><label>낙찰하한율 (%)</label><input id="k_fl" type="number" step="0.001" value="${fl ?? 86.745}"></div>
    <div class="field"><label>예비가격 범위</label><select id="k_sp"><option value="0.02">±2% (국가기관·조달청)</option><option value="0.03">±3% (지자체 등)</option></select></div>
    <div class="field"><label>사정률 (%)</label><input id="k_s" type="number" step="0.001" value="${s ? A.fmtS(s) : ''}"></div>
  </div>
  <div class="two"><div><div class="note">투찰금액 = 기초금액 × 하한율 × 사정률</div><div class="out" id="k_amt">–</div><div class="note" id="k_note"></div></div>
  <div><div class="note">하한 미달 위험 (추첨 시뮬레이션 · 과거 실제 비율)</div><div class="out" id="k_risk">–</div><div class="note" id="k_hist"></div></div></div>
  <p class="note">사정률 칸에는 1순위 구간의 가운데 값이 미리 들어가 있습니다. 공고문에서 예비가격 범위와 하한율을 반드시 확인하세요.</p>`);
}
function bindCalc(hist) {
  if (!$('#k_bss')) return;
  const go = () => {
    store.set('g2b_kbss', $('#k_bss').value);
    const r = A.calc({bss: parseFloat(($('#k_bss').value || '').replace(/[^\d.]/g, '')), fl: +$('#k_fl').value,
      span: +$('#k_sp').value, s: +$('#k_s').value}, hist);
    $('#k_risk').textContent = r.risk != null ? pct(r.risk, 1) + (r.pastBelow != null ? ` · 과거 자료 ${pct(r.pastBelow, 0)}` : '') : '–';
    $('#k_hist').textContent = r.sjBand ? `실제 사정률이 나올 범위 5~95%: ${r.sjBand[0].toFixed(2)} ~ ${r.sjBand[1].toFixed(2)}` +
      (r.pastN ? ` · 과거 ${fmt(r.pastN)}건 중 이 사정률이었으면 1순위 ${r.pastWins}건` : '') : '';
    $('#k_amt').textContent = r.amount ? fmt(r.amount) + '원' : '–';
    $('#k_note').textContent = r.rate ? `기초금액 대비 ${r.rate.toFixed(3)}%` : '';
  };
  ['k_bss', 'k_fl', 'k_sp', 'k_s'].forEach(id => { const el = $('#' + id); el.oninput = el.onchange = go; });
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

/* ---------- 데이터 목록 (검증용) */
const DSORT = {dt: (a, b) => (b.b._d - a.b._d), n: (a, b) => (b.b.n - a.b.n), bss: (a, b) => ((b.b.bss || 0) - (a.b.bss || 0)),
  win: (a, b) => (a.outcome === '1순위' ? 0 : 1) - (b.outcome === '1순위' ? 0 : 1) || (b.b._d - a.b._d)};
const PAGE = 50;
/* 키워드 규칙 안내 (사용자 지정 칸과 데이터 목록에서 같이 씀) */
const RULE_EXAMPLES = [
  ['전기+감리', "'전기'와 '감리'가 모두 들어간 공고 (순서·위치 상관없음)", '감리자(전기), 감리업자(전기), 전기감리자, 전기공사 감리용역', '소방감리자, 감리자(건축)'],
  ['전기+감리자', "'전기'와 '감리자'가 모두 들어간 공고", '감리자(전기), 전기감리자, 전기(감리자)', '전기공사 감리용역 (감리자 아님), 감리업자(전기)'],
  ['전기감리자', "'전기감리자'가 붙은 그대로 들어간 공고", '전기감리자 모집, 전기 감리자 모집(띄어쓰기 무시)', '감리자(전기), 전기공사 감리용역'],
  ['전기+감리, 소방+감리', "쉼표는 '하나라도' — 둘 중 하나라도 맞으면", '감리자(전기), 감리자(소방), 소방감리자', '감리자(건축), 전기공사(감리 없음)'],
];
function rulesHtml() {
  return `<div class="tablewrap"><table class="rules"><tr><th>입력</th><th>뜻</th><th>찾는 예</th><th>못 찾는 예</th></tr>${
    RULE_EXAMPLES.map(([k, m, y, n]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(m)}</td><td>${esc(y)}</td><td class="muted">${esc(n)}</td></tr>`).join('')}</table></div>
    <p class="note"><b>+</b> 는 모두, <b>쉼표(,)</b> 는 하나라도. 띄어쓰기는 무시합니다(<code>전기감리</code> = "전기 감리"). 빼고 싶은 말은 '제외 키워드' 칸에 쉼표로 넣으세요(예: 건축, 소방서).</p>`;
}
/* 공고명에서 키워드를 형광 표시 */
function hl(nm, words) {
  let h = esc(nm);
  [...new Set(words)].filter(Boolean).sort((a, b) => b.length - a.length).forEach(w => { h = h.split(esc(w)).join(`<mark>${esc(w)}</mark>`); });
  return h.replace(/<mark>([^<]*)<mark>([^<]*)<\/mark>([^<]*)<\/mark>/g, '<mark>$1$2$3</mark>');
}
function activeRules() {
  const out = [];
  if (S.cats.includes('nara')) out.push({name: "업종 버튼 '전기·소방 감리'", text: '전기+감리, 소방+감리', groups: A.NARA_GROUPS});
  if (S.cats.includes('custom') && (S.custom.inc || '').trim()) out.push({name: '사용자 지정 키워드', text: S.custom.inc, groups: A.parseRule(S.custom.inc)});
  return out;
}
function keywordCard(all) {
  const rules = activeRules();
  if (!rules.length) return card('검색어 확인', "업종 버튼 '전기·소방 감리'나 사용자 지정 키워드를 고르면, 어떤 공고가 잡히고 어떤 공고가 왜 빠졌는지 여기서 확인할 수 있습니다.", `<details class="rulehelp"><summary>키워드 규칙 보기</summary>${rulesHtml()}</details>`);
  return rules.map(r => {
    const K = A.keywordCheck(all, r.groups);
    const meaning = r.groups.map(g => g.length > 1 ? '(' + g.map(w => `'${w}'`).join(' 그리고 ') + ')' : `'${g[0]}'`).join(' 또는 ');
    const words = r.groups.flat();
    const link = b => `<a href="${esc(A.g2bUrl(b.id))}" target="_blank" rel="noopener" class="num">${esc(b.id)}</a>`;
    const miss = Object.entries(K.missCount).sort((a, b) => b[1] - a[1]);
    const recent = arr => arr.slice().sort((a, b) => b.b._d - a.b._d);
    return card(`검색어 확인 — ${esc(r.name)}`, `입력 <code>${esc(r.text)}</code> → 공고명에 ${esc(meaning)}이 들어간 공고 (띄어쓰기 무시). 지금 기간의 전체 공사·용역 입찰 ${fmt(all.length)}건에서 확인했습니다.`, `
      <div class="kpis">
        <div class="kpi"><div class="k">잡힌 공고</div><div class="v">${fmt(K.matched.length)}건</div><div class="s">아래 목록에서 낱말이 형광으로 표시됩니다</div></div>
        <div class="kpi"><div class="k">애매하게 잡힌 공고</div><div class="v">${fmt(K.ambiguous.length)}건</div><div class="s">낱말이 다른 말(전기차·소방서 등) 속에만 있음</div></div>
        <div class="kpi"><div class="k">비슷하지만 빠진 공고</div><div class="v">${fmt(K.near.length)}건</div><div class="s">${miss.slice(0, 2).map(([k, c]) => `${esc(k)} ${fmt(c)}`).join(' · ')}</div></div>
      </div>
      ${K.ambiguous.length ? `<h3 class="sub">애매하게 잡힌 공고 — 확인 후 필요하면 제외 키워드에 넣으세요</h3>` + table([['개찰일'], ['공고'], ['이유']],
        recent(K.ambiguous).slice(0, 30).map(x => tr([[x.b.dt, 'num'], `${link(x.b)}<br>${hl(x.b.nm, words)}`, `<span class="pill warn">${esc(x.why)}</span>`]))) : ''}
      ${miss.map(([why, c]) => `<details class="nearlist"><summary>빠진 공고: ${esc(why)} — ${fmt(c)}건 (최근 20건 보기)</summary>` +
        table([['개찰일'], ['공고']], recent(K.near.filter(x => x.why === why)).slice(0, 20).map(x => tr([[x.b.dt, 'num'], `${link(x.b)}<br>${hl(x.b.nm, words)}`]))) + '</details>').join('')}
      <details class="rulehelp"><summary>키워드 규칙 보기</summary>${rulesHtml()}</details>`);
  }).join('');
}
function viewData(v, sel, all) {
  const sNum = parseFloat(S.verifyS);
  const L = A.listRows(sel, isFinite(sNum) && sNum > 0 ? sNum : null);
  const q = (S.dq || '').trim();
  let rows = L.rows;
  if (S.dview === 'used') rows = rows.filter(r => r.used);
  else if (S.dview === 'excl') rows = rows.filter(r => !r.used);
  if (q) rows = rows.filter(r => [r.b.nm, r.b.inst, r.b.wc, r.b.id].some(x => (x || '').includes(q)));
  rows = rows.slice().sort(DSORT[S.dsort] || DSORT.dt);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), pg = Math.min(S.dpage || 0, pages - 1);
  const whyTxt = Object.entries(L.why).map(([k, c]) => `${k} ${fmt(c)}`).join(' · ') || '없음';
  const hlWords = activeRules().flatMap(r => r.groups.flat());
  const pill = o => o === '1순위' ? '<span class="pill ok">1순위</span>' : o === '하한 미달' ? '<span class="pill warn">하한 미달</span>' : o ? `<span class="pill">${o}</span>` : '';
  v.innerHTML = keywordCard(all || sel) + kpis([
    ['목록', fmt(L.total) + '건', esc(A.categoryLabel(S.cats))],
    ['가격 분석에 쓰인 입찰', fmt(L.used) + '건', `빠진 것: ${esc(whyTxt)}`],
    ...(L.s ? [[`사정률 ${A.fmtS(L.s)}로 넣었다면`, pct(L.rate, 2), `1순위 ${fmt(L.wins)}건 · 하한 미달 ${fmt(L.below)}건 / ${fmt(L.used)}건`]] : []),
  ]) + card('데이터 목록', '가격 전략·경쟁 분석이 실제로 쓴 입찰입니다. 공고번호를 누르면 나라장터 원문이 열리니 금액과 순위를 직접 대조해 보세요. 사정률을 넣으면 입찰마다 그 사정률이었을 때의 결과를 보여 줍니다.', `
    <div class="dtools">
      <div class="field"><label>검색 (공고명·기관·업체·공고번호)</label><input id="d_q" value="${esc(S.dq || '')}" placeholder="예: 감리자(전기)"></div>
      <div class="field"><label>보기</label><select id="d_view"><option value="all">전체</option><option value="used">가격 분석에 쓰인 것</option><option value="excl">빠진 것</option></select></div>
      <div class="field"><label>정렬</label><select id="d_sort"><option value="dt">개찰일 최신</option><option value="n">참가업체 많은 순</option><option value="bss">기초금액 큰 순</option><option value="win">검증 결과 1순위 먼저</option></select></div>
      <div class="field"><label>검증할 사정률 (%)</label><input id="d_s" type="number" step="0.001" value="${esc(S.verifyS || '')}" placeholder="예: 99.25"></div>
      <div class="field"><label>&nbsp;</label><button class="btn" id="d_csv" type="button">CSV 내려받기 (${fmt(rows.length)}건)</button></div>
    </div>
    ${L.s ? `<p class="note">검증 사정률 ${A.fmtS(L.s)}: '포함'인 입찰마다 실제 사정률(하한선)과 1순위 사정률 사이에 들면 1순위, 하한선보다 낮으면 하한 미달로 셉니다. 가격 전략의 구간 확률은 구간 안 여러 사정률의 평균이라 한 점의 값과 조금 다를 수 있습니다.</p>` : ''}
    <p class="note">${fmt(rows.length)}건 중 ${fmt(pg * PAGE + (rows.length ? 1 : 0))}–${fmt(Math.min(rows.length, (pg + 1) * PAGE))}번째. 1순위 투찰금액에 '≈'가 붙은 것은 투찰률에서 되돌려 계산한 값입니다(다음 수집부터 원 단위 그대로 저장).</p>
    ${rows.length ? '<div class="dlist">' + table([['개찰일'], ...(L.s ? [['검증']] : []), ['공고번호·공고명'], ['기관'], ['방법·결과'], ['기초금액', 'r'], ['하한율 / 실제 사정률', 'r'], ['참가', 'r'], ['1순위 업체'], ['1순위 투찰금액', 'r'], ['1순위 사정률', 'r'], ...(S.dview === 'used' ? [] : [['분석']])],
      rows.slice(pg * PAGE, (pg + 1) * PAGE).map(r => { const b = r.b; return tr([
        [b.dt, 'num'], ...(L.s ? [pill(r.outcome) || '<span class="muted">–</span>'] : []),
        [`<a href="${esc(r.url)}" target="_blank" rel="noopener" class="num">${esc(b.id)}</a><br>${hl(b.nm, hlWords)}`, 'wrap nm'],
        [esc(b.inst), 'wrap'], [`${esc(b.mth)}<br><span class="muted">${esc(b.res)}</span>`, 'wrap'],
        R(b.bss ? fmt(b.bss) : '–'), R(`${b.fl != null ? fmt(b.fl, 3) : '–'}<br><span class="muted">${fmt(r.sjActual, 3)}</span>`),
        R(`${fmt(b.n)}<br><span class="muted">순위권 ${fmt(b.nr)}</span>`), [esc(b.wc || '–'), 'wrap'],
        R(r.winAmt != null ? (r.winAmtExact ? '' : '≈') + fmt(r.winAmt) : '–'), R(fmt(r.winSj, 3)),
        ...(S.dview === 'used' ? [] : [r.used ? '<span class="pill ok">포함</span>' : `<span class="pill">${esc(r.why)}</span>`])]); })) + '</div>'
      : '<div class="empty">조건에 맞는 입찰이 없습니다.</div>'}
    <div class="pager">${pages > 1 ? `<button class="btn" id="d_prev" ${pg ? '' : 'disabled'}>← 이전</button><span class="num">${pg + 1} / ${pages}</span><button class="btn" id="d_next" ${pg < pages - 1 ? '' : 'disabled'}>다음 →</button>` : ''}</div>`);
  $('#d_view').value = S.dview || 'all'; $('#d_sort').value = S.dsort || 'dt';
  const re = () => { save(); render(); };
  $('#d_q').oninput = e => { S.dq = e.target.value; S.dpage = 0; clearTimeout(viewData._t); viewData._t = setTimeout(() => { re(); const el = $('#d_q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 300); };
  $('#d_view').onchange = e => { S.dview = e.target.value; S.dpage = 0; re(); };
  $('#d_sort').onchange = e => { S.dsort = e.target.value; S.dpage = 0; re(); };
  $('#d_s').onchange = e => { S.verifyS = e.target.value; S.dpage = 0; re(); };
  if ($('#d_prev')) { $('#d_prev').onclick = () => { S.dpage = pg - 1; re(); }; $('#d_next').onclick = () => { S.dpage = pg + 1; re(); }; }
  $('#d_csv').onclick = () => {
    const blob = new Blob([A.toCsv({...L, rows})], {type: 'text/csv;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `g2b_list_${(S.cats.join('+') || 'all').replace(/[^\w+]+/g, '_')}_${D.meta.last}${L.s ? '_s' + A.fmtS(L.s) : ''}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
}
