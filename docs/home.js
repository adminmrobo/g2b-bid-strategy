/* 입찰 봇 — 첫 화면과 메뉴 1·2·4 (화면 전용, 계산 규칙은 analysis.js 의 G2B.* 를 그대로 쓴다).
 *
 *   #home      첫 화면: 메뉴 4개와 오늘의 요약
 *   #today     1) 오늘의 입찰(전기·소방 감리 먼저) + 낙찰 결과(오늘부터 30일 전까지)
 *   #week      2) 이번 주 낙찰 사정률(낙찰한 기업이 쓴 사정률)
 *   #strategy  3) 입찰 전략 — 기존 화면(app.js)
 *   #all       4) 전체 낙찰 결과 — 저장된 내역 전부
 *
 * app.js 의 공용 도구($, esc, fmt, pct, eok, kpis, card, table, tr, R, mkChart, css, store, D, A)를 쓴다.
 * 사정률(낙찰한 기업이 쓴 것) = 1순위 투찰금액 ÷ (기초금액 × 하한율) × 100  (가격 전략 탭과 같은 정의)
 */
'use strict';
(function () {
  const NARA = A.categoryFilter(['nara'], {});
  const H = {tCat: 'pri', tStat: 'open', tq: '', tPage: 0, rCat: 'pri', rPage: 0,
    wCat: 'nara', wPer: 'this', aCat: 'all', aRes: 'all', aq: '', aFrom: '', aTo: '', aSort: 'dt', aPage: 0};
  try { Object.assign(H, JSON.parse(store.get('g2b_home') || '{}')); } catch (e) {}
  ['tPage', 'rPage', 'aPage'].forEach(k => { H[k] = 0; });
  const saveH = () => store.set('g2b_home', JSON.stringify(H));

  /* ---------------------------------------------------------- 날짜 (한국시간) */
  const todayKST = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul'}).format(new Date());
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const monday = iso => addDays(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const md = iso => iso ? `${+iso.slice(5, 7)}.${+iso.slice(8, 10)}(${DOW[new Date(iso + 'T00:00:00Z').getUTCDay()]})` : '–';
  const dday = (iso, today) => { const n = Math.round((Date.parse(iso) - Date.parse(today)) / 864e5); return n === 0 ? '오늘' : n > 0 ? `D-${n}` : `${-n}일 지남`; };

  /* ---------------------------------------------------------- 낙찰 레코드 해석 */
  const winSj = b => (!A.isFail(b) && b.wr && b.fl) ? b.wr / b.fl * 100 : null;      // 낙찰 기업이 쓴 사정률
  const actSj = b => (b.pre && b.bss) ? b.pre / b.bss * 100 : null;                    // 실제(예정가격) 사정률
  const winAmt = b => b.wa != null ? b.wa : (b.wr && b.bss ? Math.round(b.wr * b.bss / 100) : null);
  const winner = b => b.fw || b.wc || '';
  const resPill = b => A.isFail(b) ? `<span class="pill warn">${esc(b.res && /유찰/.test(b.res) ? b.res : '유찰')}</span>` : '<span class="pill ok">낙찰</span>';
  const naraPill = '<span class="pill ok">전기·소방 감리</span>';
  const link = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${text}</a>` : text;
  const priFirst = (rows, isPri, then) => rows.slice().sort((a, b) => (isPri(b) - isPri(a)) || then(a, b));
  const match = (q, ...xs) => !q || xs.some(x => String(x || '').includes(q));

  /* ---------------------------------------------------------- 공용 조각 */
  const seg = (name, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) =>
    `<button type="button" class="segbtn" data-h="${name}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
  function bindSeg(v) {
    v.querySelectorAll('.segbtn[data-h]').forEach(b => b.onclick = () => {
      H[b.dataset.h] = b.dataset.v; ['tPage', 'rPage', 'aPage'].forEach(k => { H[k] = 0; }); saveH(); draw();
    });
  }
  function pager(id, page, total, size) {
    const pages = Math.max(1, Math.ceil(total / size));
    if (pages <= 1) return '';
    return `<div class="pager" data-pg="${id}"><button class="btn mini" data-d="-1" ${page <= 0 ? 'disabled' : ''}>◀ 이전</button>
      <span class="num muted">${page + 1} / ${pages}</span><button class="btn mini" data-d="1" ${page >= pages - 1 ? 'disabled' : ''}>다음 ▶</button></div>`;
  }
  function bindPager(v) {
    v.querySelectorAll('.pager[data-pg]').forEach(p => p.querySelectorAll('button').forEach(b => b.onclick = () => {
      const k = p.dataset.pg; H[k] = Math.max(0, (H[k] || 0) + +b.dataset.d); saveH(); draw();
      const top = p.closest('.card'); if (top) top.scrollIntoView({block: 'start'});
    }));
  }
  function bindInput(v, id, key, delay = 250) {
    const el = v.querySelector('#' + id); if (!el) return;
    el.oninput = () => { H[key] = el.value; ['tPage', 'rPage', 'aPage'].forEach(k => { H[k] = 0; }); saveH();
      clearTimeout(el._t); el._t = setTimeout(() => { draw(); const n = document.getElementById(id); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, delay); };
  }
  function staleNote(today) {
    const built = (D.meta.built || '').slice(0, 10);
    return built && built < today ? `<div class="stale">자료가 <b>${esc(D.meta.built)}</b>에 마지막으로 갱신되었습니다(오늘은 ${today}). 매일 05:23 자동 갱신이 멈췄다면 GitHub Actions를 확인하세요.</div>` : '';
  }

  /* ---------------------------------------------------------- 집계 */
  function todayData() {
    const today = todayKST();
    const ups = D.upcoming.filter(n => n.odt && n.odt >= today);
    const open = ups.filter(n => !n.cls || n.cls >= today);              // 마감 전 = 오늘 투찰 가능
    const from30 = addDays(today, -30);
    const res30 = D.bids.filter(b => b.dt >= from30 && b.dt <= today);
    return {today, ups, open, from30, res30};
  }
  function weekRange(per, today) {
    if (per === 'last') { const m = addDays(monday(today), -7); return [m, addDays(m, 6), '지난주']; }
    if (per === '7d') return [addDays(today, -6), today, '최근 7일'];
    return [monday(today), today, '이번 주'];
  }
  const WCATS = [['nara', '전기·소방 감리'], ['sup', '감리'], ['fire', '소방'], ['elec', '전기공사'], ['all', '전체']];
  const wFilter = k => k === 'all' ? (() => true) : A.categoryFilter([k], {});
  function weekData(cat, per, today) {
    const [from, to, label] = weekRange(per, today);
    const f = wFilter(cat);
    const inR = (a, z) => D.bids.filter(b => b.dt >= a && b.dt <= z && f(b));
    const all = inR(from, to), wins = all.filter(b => winSj(b) != null);
    const pf = addDays(from, -7), pt = addDays(to, -7);
    const prev = inR(pf, pt).filter(b => winSj(b) != null);
    return {from, to, label, all, wins, sj: wins.map(winSj), prev, prevSj: prev.map(winSj), pf, pt};
  }

  /* ========================================================== 첫 화면 */
  function viewHome(v) {
    const T = todayData(), today = T.today;
    const openN = T.open.filter(NARA).length, todayClose = T.open.filter(n => n.cls === today).length;
    const res30N = T.res30.filter(NARA).length;
    const W = weekData('nara', 'this', today), Wall = weekData('all', 'this', today);
    const wMed = A.median(W.sj), wAll = A.median(Wall.sj);
    const last = D.meta.last, first = D.meta.first;
    const hcard = (href, who, img, no, title, stats, desc) => `<a class="hcard" href="#${href}" style="--who:var(--c-${who})">
      <img src="img/char/${img}.webp" alt="" aria-hidden="true"><div><div class="hno">MENU ${no}</div><h2>${title}</h2>
      <div class="hstats">${stats.map(([l, n]) => `<span class="hstat"><b>${n}</b>${l}</span>`).join('')}</div>
      <div class="hdesc">${desc}</div><div class="go">열기 →</div></div></a>`;
    v.innerHTML = staleNote(today) + `<div class="hero"><img src="img/char/asst_e01.webp" alt="" aria-hidden="true"><div>
      <h1>${today.slice(0, 4)}년 ${md(today)} 입찰 봇입니다</h1>
      <p>전기·소방 감리 공고를 먼저 보여 드립니다. 공고 자료 ${esc(D.meta.built || '-')} 갱신 · 낙찰 자료 ${esc(first || '-')} ~ ${esc(last || '-')}</p></div></div>
      <div class="homegrid">
      ${hcard('today', 'asst', 'asst_e13', 1, '오늘의 입찰 · 낙찰 결과',
        [['투찰 가능 전기·소방 감리', fmt(openN) + '건'], ['오늘 마감(전체)', fmt(todayClose) + '건'], ['30일 낙찰 결과(감리)', fmt(res30N) + '건']],
        `마감 전 공고를 전기·소방 감리부터 보여 주고, ${md(T.from30)}부터 오늘까지의 개찰 결과를 함께 봅니다.`)}
      ${hcard('week', 'doc', 'doc_e07', 2, '이번 주 낙찰 사정률',
        [['전기·소방 감리 낙찰', fmt(W.wins.length) + '건'], ['사정률 중앙값', wMed != null ? fmt(wMed, 3) : '–'], ['전체 업종 중앙값', wAll != null ? fmt(wAll, 3) : '–']],
        `${md(W.from)} ~ ${md(W.to)}에 낙찰한 기업이 실제로 쓴 사정률(투찰금액 ÷ (기초금액 × 하한율))의 분포입니다.`)}
      ${hcard('strategy', 'robo', 'robo_e09', 3, '입찰 전략',
        [['전기·소방 감리 낙찰 자료', fmt(D.bids.filter(b => NARA(b) && winSj(b) != null).length) + '건'], ['진행 공고(전체)', fmt(D.upcoming.length) + '건']],
        '확률이 높은 사정률 구간, 성적표, 투찰금액 계산기, 경쟁·유찰 분석, 진행 공고 추천, 내 회사 성적을 봅니다.')}
      ${hcard('all', 'fly', 'fly_e07', 4, '전체 낙찰 결과',
        [['저장된 입찰', fmt(D.bids.length) + '건'], ['처음', first || '–'], ['마지막', last || '–']],
        '지금 저장된 낙찰 내역 전부를 검색·정렬하고 CSV로 내려받습니다.')}
      </div>`;
  }

  /* ========================================================== 1) 오늘의 입찰 · 낙찰 결과 */
  const PS_T = 30, PS_R = 30;
  function viewToday(v) {
    const T = todayData(), today = T.today, q = (H.tq || '').trim();
    const nOpenNara = T.open.filter(NARA).length;
    // 오늘의 입찰
    let list = H.tStat === 'opening' ? T.ups.filter(n => n.odt === today) : H.tStat === 'all' ? T.ups : T.open;
    if (H.tCat === 'nara') list = list.filter(NARA);
    list = list.filter(n => match(q, n.nm, n.inst, n.dinst, n.id));
    list = priFirst(list, NARA, (a, b) => (a.cls || a.odt).localeCompare(b.cls || b.odt) || a.odt.localeCompare(b.odt));
    const tp = Math.min(H.tPage || 0, Math.max(0, Math.ceil(list.length / PS_T) - 1));
    const stat = n => n.odt === today ? '<span class="pill warn">오늘 개찰</span>'
      : n.cls && n.cls < today ? '<span class="pill">마감·개찰 대기</span>'
      : n.cls === today ? '<span class="pill warn">오늘 마감</span>' : `<span class="pill ok">마감 ${dday(n.cls || n.odt, today)}</span>`;
    const tRows = list.slice(tp * PS_T, (tp + 1) * PS_T).map(n => `<tr class="${NARA(n) ? 'pri' : ''}">${[
      `${stat(n)}${n.ndt === today ? '<br><span class="pill">오늘 게시</span>' : ''}`,
      `<div class="nm">${link(n.url || A.g2bUrl(n.id), esc(n.nm))} ${NARA(n) ? naraPill : ''}<br><span class="muted">${esc(n.id)} · ${esc(n.div)}${n.rgn ? ' · ' + esc(n.rgn.slice(0, 24)) : ''}</span></div>`,
      esc(n.inst), `<span class="num">${eok(n.ps || n.ab)}</span>`,
      `<span class="num">${md(n.ndt)}</span>`, `<span class="num">${md(n.cls)}</span>`, `<span class="num">${md(n.odt)}</span>`,
    ].map((c, i) => `<td class="${i === 3 ? 'r' : ''}">${c}</td>`).join('')}</tr>`);
    // 낙찰 결과 (최근 30일)
    let res = T.res30;
    if (H.rCat === 'nara') res = res.filter(NARA);
    res = res.filter(b => match(q, b.nm, b.inst, b.wc, b.fw, b.id));
    res = priFirst(res, NARA, (a, b) => b.dt.localeCompare(a.dt));
    const rp = Math.min(H.rPage || 0, Math.max(0, Math.ceil(res.length / PS_R) - 1));
    const rRows = res.slice(rp * PS_R, (rp + 1) * PS_R).map(b => { const s = winSj(b); return `<tr class="${NARA(b) ? 'pri' : ''}">${[
      `<span class="num">${md(b.dt)}</span>`,
      `<div class="nm">${link(A.g2bUrl(b.id), esc(b.nm))} ${NARA(b) ? naraPill : ''}<br><span class="muted">${esc(b.id)} · ${esc(b.div)}</span></div>`,
      esc(b.inst), [eok(b.bss ?? b.ps), 'r num'], [fmt(b.n), 'r num'],
      A.isFail(b) ? '<span class="muted">–</span>' : esc(winner(b)),
      [winAmt(b) != null && !A.isFail(b) ? fmt(winAmt(b)) : '–', 'r num'], [s != null ? `<b>${fmt(s, 3)}</b>` : '–', 'r num'], resPill(b),
    ].map(c => Array.isArray(c) ? `<td class="${c[1]}">${c[0]}</td>` : `<td>${c}</td>`).join('')}</tr>`; });
    const th = hs => `<tr>${hs.map(h => `<th class="${h[1] || ''}">${h[0]}</th>`).join('')}</tr>`;
    const resN = T.res30.length, resNara = T.res30.filter(NARA).length, fails = T.res30.filter(A.isFail).length;
    v.innerHTML = staleNote(today) + kpis([
      ['투찰 가능 공고', fmt(T.open.length) + '건', `전기·소방 감리 ${fmt(nOpenNara)}건 · 마감 전, 개찰 ${md(today)} 이후`],
      ['오늘 마감', fmt(T.open.filter(n => n.cls === today).length) + '건', `전기·소방 감리 ${fmt(T.open.filter(n => n.cls === today && NARA(n)).length)}건`],
      ['오늘 개찰', fmt(T.ups.filter(n => n.odt === today).length) + '건', `전기·소방 감리 ${fmt(T.ups.filter(n => n.odt === today && NARA(n)).length)}건`],
      ['낙찰 결과 (30일)', fmt(resN) + '건', `전기·소방 감리 ${fmt(resNara)}건 · 유찰 ${fmt(fails)}건`],
    ]) + `<div class="toolbar"><div class="field"><label>검색 (공고명·기관·업체·공고번호)</label><input id="h_tq" value="${esc(H.tq || '')}" placeholder="예: 감리자(전기), 교육청"></div></div>` +
    card(`오늘의 입찰 <span class="muted" style="font-weight:400;font-size:14px">${md(today)}</span>`,
      `전기·소방 감리(공고명에 '감리'와 '전기' 또는 '소방') 공고를 맨 위에 두고, 그다음은 마감이 가까운 순서입니다. 공고 자료는 ${esc(D.meta.built || '-')}에 받은 것이라 그 뒤에 올라온 공고는 내일 반영됩니다.
        <span class="ctlrow"><span class="ctl">보기 ${seg('tStat', H.tStat, [['open', '투찰 가능(마감 전)'], ['opening', '오늘 개찰'], ['all', '개찰 전 전체']])}</span>
        <span class="ctl">업종 ${seg('tCat', H.tCat, [['pri', '전기·소방 감리 먼저 + 전체'], ['nara', '전기·소방 감리만']])}</span></span>`,
      list.length ? `<p class="note">${fmt(list.length)}건 중 ${fmt(tp * PS_T + 1)}–${fmt(Math.min(list.length, (tp + 1) * PS_T))}번째</p>
        <div class="tablewrap"><table>${th([['상태'], ['공고명'], ['공고기관'], ['추정가격', 'r'], ['게시'], ['입찰 마감'], ['개찰']])}${tRows.join('')}</table></div>${pager('tPage', tp, list.length, PS_T)}`
        : '<div class="empty">조건에 맞는 공고가 없습니다.</div>') +
    card(`낙찰 결과 <span class="muted" style="font-weight:400;font-size:14px">${md(T.from30)} ~ ${md(today)} (30일)</span>`,
      `개찰이 끝난 입찰입니다. 전기·소방 감리를 맨 위에, 그다음은 개찰일 최신순입니다. 사정률은 낙찰(1순위) 기업이 쓴 값 = 1순위 투찰금액 ÷ (기초금액 × 하한율) × 100 입니다.
        <span class="ctlrow"><span class="ctl">업종 ${seg('rCat', H.rCat, [['pri', '전기·소방 감리 먼저 + 전체'], ['nara', '전기·소방 감리만']])}</span></span>`,
      res.length ? `<p class="note">${fmt(res.length)}건 중 ${fmt(rp * PS_R + 1)}–${fmt(Math.min(res.length, (rp + 1) * PS_R))}번째</p>
        <div class="tablewrap"><table>${th([['개찰일'], ['공고명'], ['공고기관'], ['기초금액', 'r'], ['참가', 'r'], ['낙찰 업체'], ['1순위 투찰금액', 'r'], ['사정률', 'r'], ['결과']])}${rRows.join('')}</table></div>${pager('rPage', rp, res.length, PS_R)}`
        : '<div class="empty">최근 30일 개찰 결과가 없습니다.</div>');
    bindSeg(v); bindPager(v); bindInput(v, 'h_tq', 'tq');
  }

  /* ========================================================== 2) 이번 주 낙찰 사정률 */
  function viewWeek(v) {
    const today = todayKST(), W = weekData(H.wCat, H.wPer, today);
    const med = A.median(W.sj), pmed = A.median(W.prevSj), mean = A.mean(W.sj);
    const lo = W.sj.length ? Math.min(...W.sj) : null, hi = W.sj.length ? Math.max(...W.sj) : null;
    const diff = med != null && pmed != null ? med - pmed : null;
    const catLabel = (WCATS.find(c => c[0] === H.wCat) || WCATS[0])[1];
    const short = D.meta.last && D.meta.last < W.to ? ` · 낙찰 자료는 ${md(D.meta.last)}까지 들어와 있습니다` : '';
    // 하한율별
    const byFl = {};
    W.wins.forEach(b => { const k = b.fl.toFixed(3); (byFl[k] = byFl[k] || []).push(winSj(b)); });
    const flRows = Object.entries(byFl).sort((a, b) => b[1].length - a[1].length);
    // 날짜별
    const byDay = {};
    W.wins.forEach(b => { (byDay[b.dt] = byDay[b.dt] || []).push(winSj(b)); });
    const days = Object.keys(byDay).sort();
    const list = W.wins.slice().sort((a, b) => b.dt.localeCompare(a.dt) || winSj(b) - winSj(a));
    v.innerHTML = staleNote(today) + `<div class="toolbar"><span class="ctl">업종 ${seg('wCat', H.wCat, WCATS)}</span>
        <span class="ctl">기간 ${seg('wPer', H.wPer, [['this', '이번 주'], ['last', '지난주'], ['7d', '최근 7일']])}</span></div>
      <div class="scope"><b>${esc(catLabel)}</b> · ${W.label} ${W.from} ~ ${W.to} · 개찰 ${fmt(W.all.length)}건 중 낙찰 ${fmt(W.wins.length)}건${short}</div>` +
      kpis([
        ['낙찰 건수', fmt(W.wins.length) + '건', `유찰·정보 없음 ${fmt(W.all.length - W.wins.length)}건`],
        ['사정률 중앙값', med != null ? fmt(med, 3) : '–', `평균 ${mean != null ? fmt(mean, 3) : '–'}`],
        ['범위 (최저 ~ 최고)', lo != null ? `${fmt(lo, 2)}~${fmt(hi, 2)}` : '–', `가운데 50%: ${W.sj.length ? fmt(A.quantile(W.sj, .25), 3) + ' ~ ' + fmt(A.quantile(W.sj, .75), 3) : '–'}`],
        ['한 주 전과 비교', diff != null ? (diff >= 0 ? '+' : '') + fmt(diff, 3) : '–', `${W.pf} ~ ${W.pt} 중앙값 ${pmed != null ? fmt(pmed, 3) : '–'} (${fmt(W.prev.length)}건)`],
      ]) +
      (W.wins.length ? `<div class="two">${card('사정률 분포', '막대 하나는 사정률 0.25 폭 칸이고, 높이는 그 칸에 든 낙찰 건수입니다. 점선은 한 주 전 같은 기간입니다.', '<div class="chartbox"><canvas id="w1"></canvas></div>')}
        ${card('날짜별 낙찰 사정률', '점 하나가 낙찰 1건입니다. 선은 그날의 중앙값입니다.', '<div class="chartbox"><canvas id="w2"></canvas></div>')}</div>` +
      card('하한율별', '하한율이 다르면 같은 금액이라도 사정률이 달라지므로 하한율별로 나눠 봅니다.', table(
        [['하한율'], ['낙찰', 'r'], ['사정률 중앙값', 'r'], ['평균', 'r'], ['최저', 'r'], ['최고', 'r']],
        flRows.map(([k, a]) => tr([`${k}%`, R(fmt(a.length)), R(`<b>${fmt(A.median(a), 3)}</b>`), R(fmt(A.mean(a), 3)), R(fmt(Math.min(...a), 3)), R(fmt(Math.max(...a), 3))])))) +
      card('낙찰 내역', `낙찰(1순위) 기업이 쓴 사정률 = 1순위 투찰금액 ÷ (기초금액 × 하한율) × 100. '실제 사정률'은 추첨으로 정해진 예정가격 ÷ 기초금액 × 100 입니다.`, table(
        [['개찰일'], ['공고명'], ['공고기관'], ['기초금액', 'r'], ['하한율', 'r'], ['참가', 'r'], ['낙찰 업체'], ['1순위 투찰금액', 'r'], ['낙찰 사정률', 'r'], ['실제 사정률', 'r']],
        list.map(b => tr([[md(b.dt), 'num'], `<div class="nm">${link(A.g2bUrl(b.id), esc(b.nm))}${H.wCat !== 'nara' && NARA(b) ? ' ' + naraPill : ''}</div>`, esc(b.inst),
          R(eok(b.bss)), R(fmt(b.fl, 3)), R(fmt(b.n)), esc(winner(b)), R(fmt(winAmt(b))), R(`<b>${fmt(winSj(b), 3)}</b>`), R(actSj(b) != null ? fmt(actSj(b), 3) : '–')]))))
      : card('사정률 분포', '', `<div class="empty">${W.label}에 ${esc(catLabel)} 낙찰이 아직 없습니다. 기간을 '최근 7일'이나 '지난주'로 바꾸거나 업종을 넓혀 보세요.</div>`));
    bindSeg(v);
    if (!W.wins.length) return;
    const all = W.sj.concat(W.prevSj), span = Math.max(...all) - Math.min(...all);
    const step = span > 20 ? 1 : span > 8 ? 0.5 : 0.25;
    const a0 = Math.floor(Math.min(...all) / step) * step, z0 = Math.ceil((Math.max(...all) + 1e-9) / step) * step;
    const nb = Math.max(1, Math.round((z0 - a0) / step)), labels = Array.from({length: nb}, (_, i) => (a0 + i * step).toFixed(2));
    const hist = arr => { const h = new Array(nb).fill(0); arr.forEach(x => { h[Math.min(nb - 1, Math.floor((x - a0) / step + 1e-9))]++; }); return h; };
    mkChart('w1', {data: {labels, datasets: [
      {type: 'bar', label: `${W.label} (${W.wins.length}건)`, data: hist(W.sj), backgroundColor: css('--chart1')},
      {type: 'line', label: `한 주 전 (${W.prev.length}건)`, data: hist(W.prevSj), borderColor: css('--chart3'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, stepped: 'middle'}]},
      options: {maintainAspectRatio: false, animation: false, scales: {x: {title: {display: true, text: `낙찰 사정률 (%) · 칸 폭 ${step}`}}, y: {beginAtZero: true, ticks: {precision: 0}, title: {display: true, text: '건수'}}},
        plugins: {tooltip: {callbacks: {title: i => `${i[0].label} ~ ${(+i[0].label + step).toFixed(2)}`}}}}});
    const dl = days.map(md);
    mkChart('w2', {data: {labels: dl, datasets: [
      {type: 'scatter', label: '낙찰 1건', data: W.wins.map(b => ({x: md(b.dt), y: +winSj(b).toFixed(3)})), backgroundColor: css('--chart1'), pointRadius: 4},
      {type: 'line', label: '그날 중앙값', data: days.map(d => +A.median(byDay[d]).toFixed(3)), borderColor: css('--chart2'), borderWidth: 2, pointRadius: 3}]},
      options: {maintainAspectRatio: false, animation: false, scales: {x: {type: 'category', labels: dl}, y: {title: {display: true, text: '낙찰 사정률 (%)'}}}}});
  }

  /* ========================================================== 4) 전체 낙찰 결과 */
  const PS_A = 50;
  const ASORT = {dt: (a, b) => b.dt.localeCompare(a.dt), n: (a, b) => (b.n || 0) - (a.n || 0), bss: (a, b) => (b.bss || 0) - (a.bss || 0),
    sj: (a, b) => (winSj(b) ?? -1) - (winSj(a) ?? -1)};
  function allRows() {
    const q = (H.aq || '').trim();
    let rows = D.bids;
    if (H.aCat === 'nara') rows = rows.filter(NARA);
    else if (H.aCat === '공사' || H.aCat === '용역') rows = rows.filter(b => b.div === H.aCat);
    if (H.aRes === 'win') rows = rows.filter(b => !A.isFail(b)); else if (H.aRes === 'fail') rows = rows.filter(A.isFail);
    if (H.aFrom) rows = rows.filter(b => b.dt >= H.aFrom);
    if (H.aTo) rows = rows.filter(b => b.dt <= H.aTo);
    if (q) rows = rows.filter(b => match(q, b.nm, b.inst, b.dinst, b.wc, b.fw, b.wb, b.id));
    return rows.slice().sort(ASORT[H.aSort] || ASORT.dt);
  }
  function viewAll(v) {
    const today = todayKST(), rows = allRows();
    const pg = Math.min(H.aPage || 0, Math.max(0, Math.ceil(rows.length / PS_A) - 1));
    const fails = rows.filter(A.isFail).length, sjs = rows.map(winSj).filter(x => x != null);
    const cov = D.meta.coverage || {};
    const covTxt = Object.entries(cov).map(([k, c]) => `${k} ${fmt(c.days)}일치`).join(' · ');
    v.innerHTML = staleNote(today) + kpis([
      ['저장된 입찰', fmt(D.bids.length) + '건', `${D.meta.first || '–'} ~ ${D.meta.last || '–'}${covTxt ? ' · ' + covTxt : ''}`],
      ['지금 목록', fmt(rows.length) + '건', `낙찰 ${fmt(rows.length - fails)} · 유찰 ${fmt(fails)}`],
      ['낙찰 사정률 중앙값', sjs.length ? fmt(A.median(sjs), 3) : '–', '지금 목록의 낙찰 건 기준'],
    ]) + card('전체 낙찰 결과', '조달청에서 받아 저장한 낙찰 내역 전부입니다(조달청 개방표준 API는 2026-04-20 이전 자료를 주지 않습니다). 공고명을 누르면 나라장터 원문이 열립니다.', `
      <div class="dtools">
        <div class="field"><label>검색 (공고명·기관·업체·사업자번호·공고번호)</label><input id="h_aq" value="${esc(H.aq || '')}" placeholder="예: 감리자(소방), 한국전력"></div>
        <div class="field"><label>개찰일 부터</label><input id="h_af" type="date" value="${esc(H.aFrom || '')}" min="${esc(D.meta.first || '')}" max="${esc(D.meta.last || '')}"></div>
        <div class="field"><label>개찰일 까지</label><input id="h_at" type="date" value="${esc(H.aTo || '')}" min="${esc(D.meta.first || '')}" max="${esc(D.meta.last || '')}"></div>
        <div class="field"><label>정렬</label><select id="h_as"><option value="dt">개찰일 최신</option><option value="sj">낙찰 사정률 높은 순</option><option value="n">참가업체 많은 순</option><option value="bss">기초금액 큰 순</option></select></div>
        <div class="field"><label>&nbsp;</label><button class="btn" id="h_csv" type="button">CSV 내려받기 (${fmt(rows.length)}건)</button></div>
      </div>
      <div class="ctlrow"><span class="ctl">업종 ${seg('aCat', H.aCat, [['all', '전체'], ['nara', '전기·소방 감리'], ['공사', '공사'], ['용역', '용역']])}</span>
        <span class="ctl">결과 ${seg('aRes', H.aRes, [['all', '전체'], ['win', '낙찰'], ['fail', '유찰']])}</span>
        ${H.aq || H.aFrom || H.aTo || H.aCat !== 'all' || H.aRes !== 'all' ? '<button class="btn mini" id="h_reset" type="button">조건 지우기</button>' : ''}</div>
      <p class="note">${fmt(rows.length)}건 중 ${fmt(rows.length ? pg * PS_A + 1 : 0)}–${fmt(Math.min(rows.length, (pg + 1) * PS_A))}번째</p>
      ${rows.length ? table([['개찰일'], ['공고명'], ['공고기관'], ['기초금액', 'r'], ['하한율', 'r'], ['참가', 'r'], ['낙찰 업체'], ['1순위 투찰금액', 'r'], ['낙찰 사정률', 'r'], ['실제 사정률', 'r'], ['결과']],
        rows.slice(pg * PS_A, (pg + 1) * PS_A).map(b => tr([[b.dt, 'num'], `<div class="nm">${link(A.g2bUrl(b.id), esc(b.nm))} ${NARA(b) ? naraPill : ''}<br><span class="muted">${esc(b.id)} · ${esc(b.div)} · ${esc(b.mth)}</span></div>`,
          esc(b.inst), R(eok(b.bss ?? b.ps)), R(b.fl != null ? fmt(b.fl, 3) : '–'), R(fmt(b.n)), A.isFail(b) ? '<span class="muted">–</span>' : esc(winner(b)),
          R(!A.isFail(b) && winAmt(b) != null ? fmt(winAmt(b)) : '–'), R(winSj(b) != null ? `<b>${fmt(winSj(b), 3)}</b>` : '–'), R(actSj(b) != null ? fmt(actSj(b), 3) : '–'), resPill(b)])))
        : '<div class="empty">조건에 맞는 낙찰 결과가 없습니다.</div>'}
      ${pager('aPage', pg, rows.length, PS_A)}`);
    bindSeg(v); bindPager(v); bindInput(v, 'h_aq', 'aq');
    const fdate = (id, key) => { const el = v.querySelector('#' + id); el.onchange = () => { H[key] = el.value; H.aPage = 0; saveH(); draw(); }; };
    fdate('h_af', 'aFrom'); fdate('h_at', 'aTo');
    const so = v.querySelector('#h_as'); so.value = H.aSort; so.onchange = () => { H.aSort = so.value; H.aPage = 0; saveH(); draw(); };
    const rs = v.querySelector('#h_reset'); if (rs) rs.onclick = () => { Object.assign(H, {aq: '', aFrom: '', aTo: '', aCat: 'all', aRes: 'all', aPage: 0}); saveH(); draw(); };
    v.querySelector('#h_csv').onclick = () => {
      const blob = new Blob([A.toCsv(A.listRows(rows))], {type: 'text/csv;charset=utf-8'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `g2b_all_${H.aCat}_${H.aFrom || D.meta.first || ''}_${H.aTo || D.meta.last || ''}.csv`.replace(/[^\w.가-힣-]+/g, '_');
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
  }

  /* ---------------------------------------------------------- 진입점 */
  let cur = 'home', host = null;
  function draw() {
    if (!host) return;
    charts.forEach(c => c.destroy()); charts = [];
    ({home: viewHome, today: viewToday, week: viewWeek, all: viewAll}[cur] || viewHome)(host);
  }
  window.Home = {render(mode, v) { cur = mode; host = v; draw(); }};
})();
