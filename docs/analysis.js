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

  /** 사용자 지정 조건 → 판별 함수. c = {inc, exc, div, ind, inst, rgn, min, max, mth} (min/max 억원) */
  function customFilter(c) {
    c = c || {};
    const list = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
    const inc = list(c.inc), exc = list(c.exc), ind = list(c.ind), inst = list(c.inst), rgn = list(c.rgn), mth = list(c.mth);
    const mn = parseFloat(c.min) * 1e8, mx = parseFloat(c.max) * 1e8;
    return b => {
      if (inc.length && !inc.some(k => (b.nm || '').includes(k))) return false;
      if (exc.some(k => (b.nm || '').includes(k))) return false;
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
    if (set.has('custom')) fs.push(customFilter(custom));
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

  /* ---------------------------------------------------------- 모델: 가격 전략 */
  /** opts = {floor: 'auto'|'all'|'87.745', cost: 원가율 %} */
  function strategy(sel, opts = {}) {
    let ok = sel.filter(b => b.t && b.wr && !isFail(b) && b.wr >= b.t - 0.01);
    const cnt = {};
    ok.forEach(b => { const k = b.fl?.toFixed(3); if (k) cnt[k] = (cnt[k] || 0) + 1; });
    const floors = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({value, count}));
    let floor = opts.floor || 'auto';
    if (floor === 'auto' || (floor !== 'all' && !cnt[floor])) floor = floors.length ? floors[0].value : 'all';
    if (floor !== 'all') ok = ok.filter(b => b.fl?.toFixed(3) === floor);
    ok.sort((a, b) => a._d - b._d);
    const res = {floors, floor, bids: ok, n: ok.length, base: mean(ok.map(b => 1 / b.n)), enough: ok.length >= 20};
    if (!res.enough) return res;

    const lo = Math.floor((quantile(ok.map(b => b.t), .01) - 0.6) * 10) / 10;
    const hi = Math.ceil((quantile(ok.map(b => b.wr), .99) + 0.6) * 10) / 10;
    const C = curve(ok, lo, hi);
    const at = i => i < 0 ? null : {x: C.xs[i], p: C.sm[i], risk: C.below[i]};
    const cost = +opts.cost || 0;
    res.curve = C;
    res.recs = {
      best: at(argmax(C.sm)),                                   // 확률 최대형
      safe: at(C.below.findIndex(r => r <= 0.05)),               // 안전형: 하한 미달 5% 이하 중 가장 낮은 값
      profit: at(argmax(C.sm.map((p, i) => p * Math.max(0, C.xs[i] - cost)))), // 수익형
    };
    // 성적표: 앞 70%로 고르고 뒤 30%로 채점
    const cut = Math.floor(ok.length * 0.7), tr = ok.slice(0, cut), te = ok.slice(cut);
    const iTr = argmax(curve(tr, lo, hi).sm), rate = curve(te, lo, hi).sm[iTr];
    const [wl, wh] = wilson(Math.round(rate * te.length), te.length);
    const teBase = mean(te.map(b => 1 / b.n));
    res.score = {trainN: tr.length, testN: te.length, x: C.xs[iTr], rate, lo: wl, hi: wh, base: teBase, good: wl > teBase};
    const ts = ok.map(b => b.t);
    res.stats = {tMed: median(ts), t05: quantile(ts, .05), t95: quantile(ts, .95), margin: median(ok.map(b => b.wr - b.t))};
    return res;
  }

  /** 투찰금액 계산기. q = {bss 원, fl %, span 0.02|0.03, x %}, hist = 같은 조건 과거 입찰 */
  function calc(q, hist) {
    const out = {};
    if (q.fl && q.x) {
      const sims = simSj(q.span);
      let k = 0; for (const s of sims) if (q.x < q.fl * s) k++;
      out.risk = k / sims.length;
      const qq = p => sims[Math.floor(p * (sims.length - 1))];
      out.floorBand = [q.fl * qq(.05), q.fl * qq(.95)];
      if (hist && hist.length) { out.pastN = hist.length; out.pastWins = hist.filter(b => b.t <= q.x && q.x < b.wr).length; }
    }
    if (q.bss && q.x) {
      out.amount = Math.ceil(q.bss * q.x / 100);
      if (q.fl) out.floorPrice = [Math.ceil(q.bss * q.fl / 100 * (1 - q.span)), Math.ceil(q.bss * q.fl / 100 * (1 + q.span))];
    }
    return out;
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
  function prepare(data) {
    return {
      meta: data.meta,
      bids: toObjects(data.bids).map(b => ({...b, nm: b.nm || '', ind: b.ind || '', rgn: b.rgn || '', _d: Date.parse(b.dt)})),
      upcoming: toObjects(data.upcoming).map(n => ({...n, nm: n.nm || '', ind: n.ind || '', rgn: n.rgn || ''})),
    };
  }

  const G2B = {CATS, MORE, BUCKETS, customFilter, categoryFilter, categoryLabel, periodRange,
    quantile, median, mean, wilson, isFail, ymKey, bssBucket, curve, argmax, simSj,
    strategy, calc, compete, fail, upcoming, mine, prepare};
  if (typeof module !== 'undefined' && module.exports) module.exports = G2B;
  else root.G2B = G2B;
})(typeof window !== 'undefined' ? window : globalThis);
