/* 입찰 전략실 — 계산 전용 모듈 (화면·DOM을 전혀 다루지 않음).
 *
 * 화면(app.js)은 이 모듈이 돌려주는 숫자만 받아 그린다.
 * 연구실 콘셉트 등으로 화면을 바꿀 때는 app.js / index.html 만 교체하면 되고,
 * 이 파일과 collector/ 는 그대로 둔다.
 *
 * 입찰 레코드(b) 주요 필드:
 *   nm 공고명, dt 개찰일, div 공사/용역, inst 공고기관, ind 투찰가능업종, rgn 참가지역,
 *   fl 낙찰하한율(%), bss 기초금액, pre 예정가격, ps 추정가격, n 투찰업체 수, nr 순위권 업체 수,
 *   t 하한선(기초 대비 %) = fl × pre/bss, wr 1순위 투찰률(기초 대비 %), wc/wb 1순위 상호/사업자번호,
 *   res 개찰결과, my/mr 우리 회사 투찰률·순위(-1=순위 없음)
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------- 업종 정의 */
  const has = (s, re) => re.test(s || '');

  /* ---------------------------------------------------------- 공고명 키워드 규칙
   * '+' 는 모두 들어가야 함(순서·위치 상관없음), 쉼표(,) 는 묶음 중 하나라도.
   * 띄어쓰기는 무시한다(공고명과 키워드 모두 공백을 지우고 비교).
   *   전기+감리   → '전기'와 '감리'가 모두 있는 공고 (감리자(전기), 전기감리자, 전기공사 감리용역 …)
   *   전기+감리자 → '전기'와 '감리자'가 모두 있는 공고 (감리자(전기), 전기감리자 … / 전기공사 감리용역은 빠짐)
   *   전기감리자  → '전기감리자'가 붙어 있는 그대로 있는 공고 (감리자(전기)는 빠짐)                          */
  const norm = s => String(s || '').replace(/\s+/g, '');
  function parseRule(str) {
    return String(str || '').split(',').map(g => g.split('+').map(norm).filter(Boolean)).filter(g => g.length);
  }
  /** 맞는 첫 묶음의 번호, 없으면 -1 */
  function matchRule(nm, groups) {
    const t = norm(nm);
    for (let i = 0; i < groups.length; i++) if (groups[i].every(k => t.includes(k))) return i;
    return -1;
  }
  const NARA_GROUPS = parseRule('전기+감리, 소방+감리');
  // 다른 낱말 속에 들어 있어 엉뚱하게 걸릴 수 있는 경우 (예: '전기차' 속의 '전기')
  const AMBIG = {'전기': ['전기차', '전기자동차', '전기버스'], '소방': ['소방차', '소방서'], '감리': ['감리교']};
  /** 키워드 검색 확인: 잡힌 것, 애매하게 잡힌 것, 한 낱말만 있어 빠진 것 */
  function keywordCheck(bids, groups) {
    const matched = [], ambiguous = [], near = [];
    bids.forEach(b => {
      const t = norm(b.nm), gi = matchRule(b.nm, groups);
      if (gi >= 0) {
        matched.push(b);
        // 맞은 묶음의 낱말 중, 공고명에서 그 낱말이 전부 '다른 낱말 속'에만 있으면 애매
        const why = groups[gi].filter(k => AMBIG[k] && (() => { let r = t; AMBIG[k].forEach(w => { r = r.split(w).join(''); }); return !r.includes(k); })());
        if (why.length) ambiguous.push({b, why: why.map(k => `${AMBIG[k].filter(w => t.includes(w)).map(w => `'${w}'`).join('·')} 속의 '${k}'만 있음`).join(', ')});
      } else {
        // 가장 많이 맞은 묶음 기준으로 무엇이 없어서 빠졌는지
        // 가장 많이 맞은 묶음들 기준으로 무엇이 없어서 빠졌는지 (동률이면 없는 낱말을 '또는'으로 묶음)
        const hits = groups.map(g => g.filter(k => t.includes(k))), top = Math.max(...hits.map(h => h.length));
        if (top > 0) {
          const idx = hits.map((h, i) => h.length === top ? i : -1).filter(i => i >= 0);
          const miss = [...new Set(idx.flatMap(i => groups[i].filter(k => !t.includes(k))))];
          near.push({b, has: [...new Set(idx.flatMap(i => hits[i]))], miss});
        }
      }
    });
    const missCount = {};
    near.forEach(x => { x.why = `${x.has.map(w => `'${w}'`).join('·')} 있음 · ${x.miss.map(w => `'${w}'`).join('·')} 없음`; missCount[x.why] = (missCount[x.why] || 0) + 1; });
    return {groups, matched, ambiguous, near, missCount};
  }
  const CATS = [
    // 나라기술단 기준: 공고명에 '감리'가 있고, '전기' 또는 '소방'이 있는 것
    // (감리자(전기) · 감리자(소방) · 전기(감리자) · 소방감리자 · 전기감리 용역 …)
    {k: 'nara', label: '전기·소방 감리', rule: '전기+감리, 소방+감리', f: b => matchRule(b.nm, NARA_GROUPS) >= 0},
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

  /** 사용자 지정 조건 → 판별 함수. c = {inc, exc, div, ind, inst, rgn, min, max, mth} (min/max 억원) */
  function customFilter(c) {
    c = c || {};
    const list = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
    // 공고명 키워드: 쉼표(,)는 '하나라도', 더하기(+)는 '모두', 띄어쓰기 무시. 예) 전기+감리, 소방+감리
    const inc = parseRule(c.inc);
    const exc = list(c.exc).map(norm), ind = list(c.ind), inst = list(c.inst), rgn = list(c.rgn), mth = list(c.mth);
    const mn = parseFloat(c.min) * 1e8, mx = parseFloat(c.max) * 1e8;
    return b => {
      if (inc.length && matchRule(b.nm, inc) < 0) return false;
      if (exc.some(k => norm(b.nm).includes(k))) return false;
      if (c.div && b.div !== c.div) return false;
      if (ind.length && !ind.some(k => (b.ind || '').includes(k))) return false;
      if (inst.length && !inst.some(k => (b.inst || '').includes(k) || (b.dinst || '').includes(k))) return false;
      if (rgn.length && !rgn.some(k => (b.rgn || '').includes(k))) return false;
      if (mth.length && !mth.some(k => (b.mth || '').includes(k))) return false;
      const amt = b.bss ?? b.ps;
      if (isFinite(mn) && !(amt >= mn)) return false;
      if (isFinite(mx) && !(amt <= mx)) return false;
      return true;
    };
  }
  /** 선택된 업종 키들(OR) → 판별 함수. 아무것도 없으면 전체. */
  function categoryFilter(keys, custom) {
    const set = new Set(keys);
    const fs = [...CATS, ...MORE].filter(c => set.has(c.k)).map(c => c.f);
    // 사용자 지정은 조건을 하나라도 넣었을 때만 (빈 채로 켜면 전체가 잡히는 것을 막음)
    if (set.has('custom') && Object.values(custom || {}).some(v => String(v ?? '').trim())) fs.push(customFilter(custom));
    return fs.length ? (b => fs.some(f => f(b))) : (() => true);
  }
  function categoryLabel(keys) {
    const set = new Set(keys);
    const names = [...CATS, ...MORE].filter(c => set.has(c.k)).map(c => c.label);
    if (set.has('custom')) names.push('사용자 지정');
    return names.length ? names.join(' + ') : '전체 업종';
  }
  /** 마지막 데이터 날짜 기준 최근 months개월 [from, to] (ms) */
  function periodRange(lastDate, months) {
    const last = Date.parse(lastDate);
    const from = new Date(last); from.setMonth(from.getMonth() - months);
    return [from.getTime() + 864e5, last];
  }

  /* ---------------------------------------------------------- 통계 도구 */
  function quantile(a, q) {
    const s = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y);
    if (!s.length) return null;
    const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }
  const median = a => quantile(a, .5);
  const mean = a => { const s = a.filter(v => v != null && isFinite(v)); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
  function wilson(k, n, z = 1.96) {
    if (!n) return [0, 0];
    const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
  }
  const isFail = b => /유찰/.test(b.res || '') || (b.n || 0) < 2;
  const ymKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const BUCKETS = ['1억 미만', '1–3억', '3–10억', '10–50억', '50억 이상', '미상'];
  const bssBucket = v => v == null ? '미상' : v < 1e8 ? BUCKETS[0] : v < 3e8 ? BUCKETS[1] : v < 1e9 ? BUCKETS[2] : v < 5e9 ? BUCKETS[3] : BUCKETS[4];
  const groupBy = (arr, keyf) => { const g = {}; arr.forEach(x => { const k = keyf(x); (g[k] = g[k] || []).push(x); }); return g; };

  /* ---------------------------------------------------------- 낙찰 확률 곡선
   * 고정 투찰률 x(기초 대비 %)가 1순위가 되는 조건: t ≤ x < wr                     */
  const STEP = 0.001, WIN = 50; // ±0.05%p 평활
  function curve(bids, lo, hi) {
    const n = Math.round((hi - lo) / STEP) + 1;
    const diff = new Float64Array(n + 1), tcnt = new Float64Array(n + 1);
    const idx = v => Math.ceil((v - lo) / STEP - 1e-9);
    bids.forEach(b => {
      const a = Math.max(0, idx(b.t)), z = Math.min(n, idx(b.wr));
      if (z > a) { diff[a] += 1; diff[z] -= 1; }
      tcnt[Math.min(n, Math.max(0, idx(b.t)))] += 1;
    });
    const N = bids.length || 1, raw = new Float64Array(n), below = new Float64Array(n);
    let acc = 0, tc = 0;
    for (let i = 0; i < n; i++) { acc += diff[i]; raw[i] = acc / N; tc += tcnt[i]; below[i] = 1 - tc / N; }
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + raw[i];
    const sm = new Float64Array(n);
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - WIN), z = Math.min(n, i + WIN + 1); sm[i] = (pre[z] - pre[a]) / (z - a); }
    const xs = Array.from({length: n}, (_, i) => +(lo + i * STEP).toFixed(3));
    return {xs, raw, sm, below};
  }
  function argmax(arr) { let bi = 0; for (let i = 1; i < arr.length; i++) if (arr[i] > arr[bi]) bi = i; return bi; }

  /* 복수예가 시뮬레이션: ±span 범위 15구간에서 1개씩, 그중 4개 평균 → 사정률 표본(정렬됨) */
  const _sim = {};
  function simSj(span, k = 20000) {
    if (_sim[span]) return _sim[span];
    const out = new Float64Array(k);
    for (let r = 0; r < k; r++) {
      const pts = Array.from({length: 15}, (_, i) => 1 - span + 2 * span * (i + Math.random()) / 15);
      for (let i = 14; i > 10; i--) { const j = Math.floor(Math.random() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
      out[r] = (pts[11] + pts[12] + pts[13] + pts[14]) / 4;
    }
    return (_sim[span] = Array.from(out).sort((a, b) => a - b));
  }

  /* ---------------------------------------------------------- 모델: 가격 전략 (사정률 구간)
   * 업계 관행대로 투찰금액 = 기초금액 × 하한율 × 사정률 로 본다.
   * 입찰마다 사정률 s(%)로 넣었을 때 1순위가 되는 범위는
   *   [실제 사정률(예정÷기초×100),  1순위 투찰금액÷(기초×하한율)×100)
   * 이라서, 하한율이 다른 입찰도 한 축에 모아 비교할 수 있다.                        */
  const toSj = b => ({...b, t: b.t / b.fl * 100, wr: b.wr / b.fl * 100});   // 기초 대비 % → 사정률
  const fmtS = v => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  /* 구간 폭 선택지: 가운데 값 ± half. 좁을수록 촘촘하지만 구간마다 근거(과거 1순위 수)가 줄어든다 */
  // step: 구간 경계가 놓이는 눈금(±0.025면 98.050·98.075·98.100…), dp: 표시 자리수
  const WIDTHS = [{key: '0.5', half: 0.5, step: 0.25, dp: 2, label: '±0.5'}, {key: '0.025', half: 0.025, step: 0.025, dp: 3, label: '±0.025'},
    {key: '0.01', half: 0.01, step: 0.01, dp: 3, label: '±0.01'}];

  /** 폭 width 구간을 step 간격으로 밀며 구간 평균 낙찰 확률을 구하고, 겹치지 않는 상위 k개를 고른다 */
  function bands(C, width = 1, step = 0.25, k = 5, wins = [], dp = 2) {
    const n = C.xs.length, pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + C.raw[i];
    const x0 = C.xs[0], at = v => Math.round((v - x0) / STEP);
    const all = [];
    const m0 = Math.ceil(x0 / step - 1e-9);
    for (let m = m0; ; m++) {
      const a = +(m * step).toFixed(3), b = +(a + width).toFixed(3);   // 눈금 정수배로 계산해 소수 누적 오차 없앰
      if (b > C.xs[n - 1] + 1e-9) break;
      const i = at(a), j = Math.min(n, at(b));
      if (j <= i) continue;
      all.push({from: a, to: b, p: (pre[j] - pre[i]) / (j - i),
        riskLow: C.below[i], riskMid: C.below[Math.min(n - 1, at(a + width / 2))],
        winners: wins.filter(w => w >= a && w < b).length});
    }
    all.sort((x, y) => y.p - x.p);
    const pick = [];
    for (const c of all) {
      if (pick.every(p => c.to <= p.from + 1e-9 || c.from >= p.to - 1e-9)) pick.push(c);
      if (pick.length === k) break;
    }
    pick.forEach((b, i) => { b.rank = i + 1; b.label = `${b.from.toFixed(dp)} ~ ${b.to.toFixed(dp)}`; });
    return pick;
  }

  /** opts = {floor: 'all'|'87.745', width: 1, step: 0.25} */
  function strategy(sel, opts = {}) {
    const cand = sel.filter(b => b.t && b.wr && b.fl && b.pre && b.bss && !isFail(b) && b.wr >= b.t - 0.01);
    let ok = cand.filter(b => b.tOk !== false);
    const unknownFloor = cand.length - ok.length;
    const cnt = {};
    ok.forEach(b => { const k = b.fl.toFixed(3); cnt[k] = (cnt[k] || 0) + 1; });
    const floors = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({value, count}));
    let floor = opts.floor || 'all';
    if (floor !== 'all' && !cnt[floor]) floor = 'all';
    if (floor !== 'all') ok = ok.filter(b => b.fl.toFixed(3) === floor);
    ok = ok.map(toSj).sort((a, b) => a._d - b._d);
    const W = WIDTHS.find(w => w.key === String(opts.half)) || WIDTHS[0];
    const width = W.half * 2, step = W.step;
    const res = {floors, floor, bids: ok, n: ok.length, base: mean(ok.map(b => 1 / b.n)), enough: ok.length >= 20, width, half: W, unknownFloor};
    if (!res.enough) return res;

    const lo = Math.floor(quantile(ok.map(b => b.t), .005) - 1.5);
    const hi = Math.ceil(quantile(ok.map(b => b.wr), .995) + 1.5);
    const C = curve(ok, lo, hi), wins = ok.map(b => b.wr);
    res.curve = C;
    res.bands = bands(C, width, step, 5, wins, W.dp);
    // 과거 n건에 이 구간 사정률로 넣었다면 1순위가 됐을 건수(구간 평균이라 '약'으로 표시)
    res.bands.forEach(x => { x.tried = ok.length; x.won = Math.round(x.p * ok.length); });
    const iSafe = C.below.findIndex(r => r <= 0.05);
    res.safe = iSafe < 0 ? null : {x: C.xs[iSafe], p: C.sm[iSafe]};
    // 성적표: 앞 70%로 1순위 구간을 고르고, 뒤 30%에서 그 구간의 낙찰 확률을 잰다
    const cut = Math.floor(ok.length * 0.7), tr = ok.slice(0, cut), te = ok.slice(cut);
    const bTr = bands(curve(tr, lo, hi), width, step, 1, tr.map(b => b.wr), W.dp)[0];
    const bTe = bTr ? bands1(curve(te, lo, hi), bTr.from, bTr.to) : 0;
    const [wl, wh] = wilson(Math.round(bTe * te.length), te.length);
    const teBase = mean(te.map(b => 1 / b.n));
    res.score = {trainN: tr.length, testN: te.length, band: bTr, rate: bTe, lo: wl, hi: wh, base: teBase, good: wl > teBase};
    const ts = ok.map(b => b.t);
    res.stats = {sjMed: median(ts), sj05: quantile(ts, .05), sj95: quantile(ts, .95), winMed: median(wins)};
    return res;
  }
  /** 정해진 구간 [from, to)의 평균 낙찰 확률 */
  function bands1(C, from, to) {
    const i0 = Math.max(0, Math.round((from - C.xs[0]) / STEP)), i1 = Math.min(C.xs.length, Math.round((to - C.xs[0]) / STEP));
    let s = 0; for (let i = i0; i < i1; i++) s += C.raw[i];
    return i1 > i0 ? s / (i1 - i0) : 0;
  }

  /** 투찰금액 계산기. q = {bss 원, fl 하한율 %, span 0.02|0.03, s 사정률 %}, hist = strategy().bids */
  function calc(q, hist) {
    const out = {};
    if (q.fl && q.s) {
      out.rate = q.fl * q.s / 100;                            // 기초금액 대비 투찰률(%)
      const sims = simSj(q.span);
      let k = 0; for (const v of sims) if (q.s < v * 100) k++;  // 실제 사정률이 내 사정률보다 높으면 하한 미달
      out.risk = k / sims.length;
      const qq = p => sims[Math.floor(p * (sims.length - 1))] * 100;
      out.sjBand = [qq(.05), qq(.95)];
      if (hist && hist.length) {
        out.pastN = hist.length; out.pastWins = hist.filter(b => b.t <= q.s && q.s < b.wr).length;
        out.pastBelow = hist.filter(b => q.s < b.t).length / hist.length;   // 과거 자료에서 하한 미달이었을 비율
      }
    }
    if (q.bss && q.fl && q.s) out.amount = Math.ceil(q.bss * q.fl / 100 * q.s / 100);
    return out;
  }

  /* ---------------------------------------------------------- 모델: 데이터 목록 (검증용)
   * 가격 전략이 쓰는 것과 똑같은 기준으로 입찰마다 '분석 포함 여부'와 빠진 이유를 붙인다.
   * s(사정률)를 주면 그 사정률로 넣었을 때의 결과(1순위 / 하한 미달 / 2순위 이하)도 붙인다. */
  const g2bUrl = id => { const [no, od] = String(id || '').split('-'); return no ? `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${no}&bidPbancOrd=${od || '000'}` : ''; };
  function excludeReason(b) {
    if (isFail(b)) return '유찰·참가 2개사 미만';
    if (!(b.wr && b.fl && b.pre && b.bss) || b.t == null) return '금액·하한율 정보 없음';
    if (b.tOk === false) return '하한선 불명(공사)';
    if (b.wr < b.t - 0.01) return '1순위가 하한선 아래';
    return '';
  }
  function listRows(sel, s) {
    const rows = sel.map(b => {
      const why = excludeReason(b), used = !why;
      const r = {b, used, why, url: g2bUrl(b.id),
        sjActual: b.pre && b.bss ? b.pre / b.bss * 100 : null,
        floorSj: used ? b.t / b.fl * 100 : null,
        winSj: b.wr && b.fl ? b.wr / b.fl * 100 : null,
        winAmt: b.wa != null ? b.wa : (b.wr && b.bss ? Math.round(b.wr * b.bss / 100) : null), winAmtExact: b.wa != null};
      if (s && used) r.outcome = s < r.floorSj ? '하한 미달' : s < r.winSj ? '1순위' : '2순위 이하';
      return r;
    });
    const used = rows.filter(r => r.used), why = {};
    rows.forEach(r => { if (!r.used) why[r.why] = (why[r.why] || 0) + 1; });
    const out = {rows, total: rows.length, used: used.length, why};
    if (s) {
      out.s = s;
      out.wins = used.filter(r => r.outcome === '1순위').length;
      out.below = used.filter(r => r.outcome === '하한 미달').length;
      out.rate = used.length ? out.wins / used.length : null;
    }
    return out;
  }
  const CSV_HEAD = ['개찰일', '공고번호', '공고명', '공고기관', '업무구분', '낙찰자결정방법', '개찰결과', '기초금액', '예정가격', '낙찰하한율',
    '실제사정률', '참가업체수', '순위권업체수', '1순위업체', '1순위사업자번호', '1순위투찰금액', '1순위투찰금액정확', '1순위사정률', '하한선사정률',
    '가격분석포함', '제외사유', '검증사정률', '검증결과', '나라장터'];
  function toCsv(L) {
    const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const f = (v, d) => v == null ? '' : (+v).toFixed(d);
    const lines = [CSV_HEAD.join(',')].concat(L.rows.map(r => { const b = r.b; return [b.dt, b.id, b.nm, b.inst, b.div, b.mth, b.res,
      b.bss, b.pre, b.fl, f(r.sjActual, 4), b.n, b.nr, b.wc, b.wb, r.winAmt, r.winAmtExact ? 'Y' : '환산', f(r.winSj, 4), f(r.floorSj, 4),
      r.used ? 'Y' : 'N', r.why, L.s || '', r.outcome || '', r.url].map(q).join(','); }));
    return '﻿' + lines.join('\r\n');
  }

  /* ---------------------------------------------------------- 모델: 경쟁 */
  const N_BINS = [[2, 10, '2–9'], [10, 30, '10–29'], [30, 100, '30–99'], [100, 300, '100–299'], [300, 1000, '300–999'], [1000, 1e9, '1000+']];
  function compete(sel) {
    const done = sel.filter(b => !isFail(b)), ns = done.map(b => b.n);
    const wins = {};
    done.forEach(b => { if (b.wb || b.wc) { const k = b.wb || b.wc; (wins[k] = wins[k] || {name: b.wc, wins: 0}).wins++; } });
    const winners = Object.values(wins).sort((a, b) => b.wins - a.wins);
    const tot = winners.reduce((s, w) => s + w.wins, 0) || 1;
    winners.forEach(w => { w.share = w.wins / tot; });
    const hhi = winners.reduce((s, w) => s + (100 * w.share) ** 2, 0);
    const months = groupBy(sel, b => ymKey(b._d));
    const byB = groupBy(sel, b => bssBucket(b.bss ?? b.ps));
    const inst = groupBy(done, b => b.inst || '미상');
    return {
      nMed: median(ns), nQ1: quantile(ns, .25), nQ3: quantile(ns, .75),
      base: mean(done.map(b => 1 / b.n)),
      belowRate: mean(done.filter(b => b.n).map(b => (b.n - b.nr) / b.n)),
      margin: median(done.filter(b => b.t && b.wr).map(b => b.wr - b.t)),
      hhi, hhiLabel: hhi < 1500 ? '분산된 시장' : hhi < 2500 ? '다소 집중' : '집중된 시장',
      months: Object.keys(months).sort().map(k => ({month: k, count: months[k].length, nMed: median(months[k].filter(b => !isFail(b)).map(b => b.n))})),
      nHist: N_BINS.map(([a, z, label]) => ({label, count: ns.filter(n => n >= a && n < z).length})),
      byBucket: BUCKETS.filter(k => byB[k]).map(k => {
        const g = byB[k], d = g.filter(b => !isFail(b));
        return {bucket: k, count: g.length, nMed: median(d.map(b => b.n)), base: mean(d.map(b => 1 / b.n)),
          failRate: g.filter(isFail).length / g.length, margin: median(d.filter(b => b.t && b.wr).map(b => b.wr - b.t))};
      }),
      winners,
      insts: Object.entries(inst).sort((a, b) => b[1].length - a[1].length).map(([name, g]) => ({
        name, count: g.length, nMed: median(g.map(b => b.n)), sjMed: median(g.filter(b => b.pre && b.bss).map(b => b.pre / b.bss * 100))})),
    };
  }

  /* ---------------------------------------------------------- 모델: 유찰 */
  function fail(sel) {
    const fails = sel.filter(isFail);
    const rows = (g, key) => Object.entries(g).map(([name, arr]) => {
      const f = arr.filter(isFail).length; return {[key]: name, count: arr.length, fails: f, rate: f / arr.length};
    });
    const months = groupBy(sel, b => ymKey(b._d));
    const results = groupBy(sel, b => b.res || '(빈 값)');
    const byB = groupBy(sel, b => bssBucket(b.bss ?? b.ps));
    return {
      total: sel.length, fails: fails.length, rate: sel.length ? fails.length / sel.length : null,
      rebidRate: sel.length ? sel.filter(b => (b.id || '').split('-')[1] > '000').length / sel.length : null,
      failBidders: mean(fails.map(b => b.n)),
      months: Object.keys(months).sort().map(k => ({month: k, rate: months[k].filter(isFail).length / months[k].length})),
      results: Object.entries(results).map(([name, g]) => ({name, count: g.length})).sort((a, b) => b.count - a.count),
      byBucket: BUCKETS.filter(k => byB[k]).map(k => rows({[k]: byB[k]}, 'bucket')[0]),
      byInst: rows(groupBy(sel, b => b.inst || '미상'), 'inst').filter(r => r.count >= 3).sort((a, b) => b.rate - a.rate),
      recent: fails.slice().sort((a, b) => b._d - a._d),
    };
  }

  /* ---------------------------------------------------------- 모델: 진행 공고 참여 추천 */
  function upcoming(hist, notices, today) {
    const ups = notices.filter(n => n.odt >= today);
    const done = hist.filter(b => !isFail(b));
    const lb = a => a ? Math.round(Math.log10(a) * 2) / 2 : null;
    const rows = ups.map(n => {
      const amt = n.ps || n.ab, k = lb(amt);
      const sameAmt = hist.filter(b => b.div === n.div && lb(b.ps ?? b.bss) === k);
      let sim = done.filter(b => b.div === n.div && lb(b.ps ?? b.bss) === k && b.inst === n.inst), basis = '같은 기관·금액대';
      if (sim.length < 5) { sim = sameAmt.filter(b => !isFail(b)); basis = '같은 금액대'; }
      if (sim.length < 5) { sim = done.filter(b => b.div === n.div); basis = '업종 전체'; }
      const ns = sim.map(b => b.n);
      return {notice: n, amount: amt, basis, similar: sim.length, nMed: median(ns), nQ1: quantile(ns, .25), nQ3: quantile(ns, .75),
        p: mean(ns.map(v => 1 / v)), failRate: sameAmt.length ? sameAmt.filter(isFail).length / sameAmt.length : null,
        dday: Math.round((Date.parse(n.odt) - Date.parse(today)) / 864e5)};
    }).filter(r => r.similar).sort((a, b) => b.p - a.p);
    return {open: ups.length, rows, minN: rows.length ? Math.min(...rows.map(r => r.nMed)) : null};
  }

  /* ---------------------------------------------------------- 모델: 우리 회사 */
  function mine(sel) {
    const list = sel.filter(b => b.my != null).sort((a, b) => b._d - a._d);
    const n = list.length || 1;
    const wins = list.filter(b => b.mr === 1).length;
    const lowFloor = list.filter(b => b.mr === -1 || (b.t && b.my < b.t)).length;
    const close = list.filter(b => b.mr > 1 && b.t && b.wr && b.my - b.wr < 0.05).length;
    return {list, count: list.length, wins, winRate: wins / n, expected: mean(list.filter(b => b.n).map(b => 1 / b.n)),
      lowFloor, lowFloorRate: lowFloor / n, close};
  }

  /* ---------------------------------------------------------- 공용 데이터 변환 */
  const toObjects = t => t.rows.map(r => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
  /* 하한선(기초 대비 %) 정하기: 하한율 × 사정률(t)이 기본. 1순위보다 싼데 순위가 없는 투찰(ub)이 그보다 높으면
   * 실제 하한은 ub 위에 있다(공사의 순공사원가 하한 등). 공사인데 ub가 아직 없으면(옛 요약) 하한을 모른다고 본다. */
  function fixFloor(b) {
    if (b.ub != null && b.t != null && b.ub > b.t) b.t = b.ub;
    b.tOk = b.t != null && (b.div !== '공사' || b.ub != null);
    return b;
  }
  function prepare(data) {
    return {
      meta: data.meta,
      bids: toObjects(data.bids).map(b => fixFloor({...b, nm: b.nm || '', ind: b.ind || '', rgn: b.rgn || '', _d: Date.parse(b.dt)})),
      upcoming: toObjects(data.upcoming).map(n => ({...n, nm: n.nm || '', ind: n.ind || '', rgn: n.rgn || ''})),
    };
  }

  const G2B = {CATS, MORE, BUCKETS, customFilter, categoryFilter, categoryLabel, periodRange,
    quantile, median, mean, wilson, isFail, ymKey, bssBucket, curve, argmax, simSj, fmtS, WIDTHS,
    strategy, bands, calc, listRows, toCsv, g2bUrl, parseRule, matchRule, keywordCheck, norm, NARA_GROUPS, compete, fail, upcoming, mine, prepare};
  if (typeof module !== 'undefined' && module.exports) module.exports = G2B;
  else root.G2B = G2B;
})(typeof window !== 'undefined' ? window : globalThis);
