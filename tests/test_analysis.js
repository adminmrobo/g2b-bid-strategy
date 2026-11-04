// node tests/test_analysis.js <data.json>  — analysis.js 모델이 모의 데이터에서 값을 내는지 확인
const A = require('../docs/analysis.js');
const D = A.prepare(require(require('path').resolve(process.argv[2])));
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
const cf = A.categoryFilter(['elec', 'sup', 'fire'], {});
const sel = D.bids.filter(cf);
const s = A.strategy(sel, {floor: 'auto', cost: 80});
assert(s.enough && s.recs.best && s.score, 'strategy');
assert(s.recs.best.p >= 0 && s.recs.best.p <= 1, 'prob range');
// 곡선 정의 검산: 최고점 투찰률로 실제로 몇 건 1순위였나
const x = s.recs.best.x, wins = s.bids.filter(b => b.t <= x && x < b.wr).length;
assert(Math.abs(wins / s.n - s.curve.raw[s.curve.xs.indexOf(x)]) < 1e-9, 'curve raw == direct count');
const c = A.compete(sel); assert(c.nMed > 0 && c.months.length && c.winners.length, 'compete');
const f = A.fail(sel); assert(f.total === sel.length && f.rate >= 0, 'fail');
const u = A.upcoming(sel, D.upcoming.filter(cf), D.meta.today); assert(u.rows.length > 0, 'upcoming');
const m = A.mine(sel); assert(m.count > 0, 'mine');
const k = A.calc({bss: 5e8, fl: 87.745, span: 0.03, x: 87.8}, s.bids); assert(k.amount === 439000000 && k.risk > 0 && k.risk < 1, 'calc');
const cu = A.categoryFilter(['custom'], {inc: '소방', min: '1'}); assert(D.bids.filter(cu).every(b => b.nm.includes('소방') && (b.bss ?? b.ps) >= 1e8), 'custom');
console.log('analysis OK', {n: s.n, floor: s.floor, best: s.recs.best, score: {rate: s.score.rate, base: s.score.base, good: s.score.good},
  nMed: c.nMed, failRate: f.rate, upcoming: u.rows.length, mine: m.count});
