// node tests/test_analysis.js <data.json>  — analysis.js 모델이 모의 데이터에서 값을 내는지 확인
const A = require('../docs/analysis.js');
const D = A.prepare(require(require('path').resolve(process.argv[2])));
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } };
const cf = A.categoryFilter(['elec', 'sup', 'fire'], {});
const sel = D.bids.filter(cf);
const s = A.strategy(sel, {floor: 'all'});
assert(s.enough && s.bands.length && s.score, 'strategy');
assert(s.bands.every(b => b.to - b.from === 1 && b.p >= 0 && b.p <= 1), 'band width 1');
assert(s.bands.every((b, i) => !i || b.p <= s.bands[i - 1].p), 'bands sorted');
assert(s.bands.every((b, i) => s.bands.every((c, j) => i === j || c.to <= b.from || c.from >= b.to)), 'bands do not overlap');
// 사정률 정의 검산: 1순위 구간 가운데 사정률로 실제 1순위였던 건수
const mid = (s.bands[0].from + s.bands[0].to) / 2, direct = s.bids.filter(b => b.t <= mid && mid < b.wr).length;
assert(direct === A.calc({fl: 87.745, span: 0.03, s: mid}, s.bids).pastWins, 'calc pastWins == direct count');
for (const [h, w] of [['0.025', 0.05], ['0.01', 0.02]]) {
  const sh = A.strategy(sel, {half: h});
  assert(sh.bands.every(b => Math.abs((b.to - b.from) - w) < 1e-6), 'band width ' + h);
  assert(sh.bands.every((b, i) => sh.bands.every((c, j) => i === j || c.to <= b.from + 1e-9 || c.from >= b.to - 1e-9)), 'no overlap ' + h);
}
const c = A.compete(sel); assert(c.nMed > 0 && c.months.length && c.winners.length, 'compete');
const f = A.fail(sel); assert(f.total === sel.length && f.rate >= 0, 'fail');
const u = A.upcoming(sel, D.upcoming.filter(cf), D.meta.today); assert(u.rows.length > 0, 'upcoming');
const m = A.mine(sel); assert(!D.meta.my_set || m.count > 0, 'mine');
const k = A.calc({bss: 5e8, fl: 87.745, span: 0.03, s: 100}, s.bids); assert(k.amount === 438725000 && k.risk > 0 && k.risk < 1, 'calc');
const nara = A.categoryFilter(['nara'], {}), viaCustom = A.categoryFilter(['custom'], {inc: '전기+감리, 소방+감리'});
assert(D.bids.every(b => nara(b) === viaCustom(b)), 'preset == custom syntax');
assert(nara({nm: '주택건설공사 감리자(전기) 모집'}) && nara({nm: '소방감리자 모집'}) && nara({nm: '전기(감리자)'}) && !nara({nm: '전기공사'}) && !nara({nm: '건축 감리'}), 'nara rule');
const cu = A.categoryFilter(['custom'], {inc: '소방', min: '1'}); assert(D.bids.filter(cu).every(b => A.norm(b.nm).includes('소방') && (b.bss ?? b.ps) >= 1e8), 'custom');
assert(D.bids.filter(A.categoryFilter(['nara', 'custom'], {})).length === D.bids.filter(A.categoryFilter(['nara'], {})).length, 'empty custom ignored');
const R = (r, n) => A.matchRule(n, A.parseRule(r)) >= 0;
[['전기+감리', '감리자(전기) 모집', true], ['전기+감리', '전기공사 감리용역', true], ['전기+감리', '소방감리자', false],
 ['전기+감리자', '감리자(전기)', true], ['전기+감리자', '전기공사 감리용역', false], ['전기감리자', '감리자(전기)', false],
 ['전기감리자', '전기 감리자 모집', true], ['전기+감리, 소방+감리', '소방감리자', true]].forEach(([r, n, e]) => assert(R(r, n) === e, `rule ${r} | ${n}`));
console.log('analysis OK', {n: s.n, top: s.bands[0].label, p: s.bands[0].p, score: {rate: s.score.rate, base: s.score.base, good: s.score.good},
  nMed: c.nMed, failRate: f.rate, upcoming: u.rows.length, mine: m.count});
