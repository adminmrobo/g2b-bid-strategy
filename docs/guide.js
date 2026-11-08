/* 입찰 전략실 — 연구실 안내 지도와 따라하기 (화면 전용, 데이터·계산과 무관).
 * 정거장 목록(STOPS)만 고치면 안내 문구·순서·캐릭터를 바꿀 수 있다. */
'use strict';
(function () {
  const IMG = k => `img/char/${k}.webp`;
  const WHO = {
    doc: {name: '박사', color: 'var(--c-doc)'},
    asst: {name: '조수 하루', color: 'var(--c-asst)'},
    fly: {name: '초파리 연구원', color: 'var(--c-fly)'},
    robo: {name: '주판봇', color: 'var(--c-robo)'},
  };
  // tab: 이 정거장에서 열 탭(null이면 그대로), target: 비출 곳(앞에서부터 처음 찾은 것)
  const STOPS = [
    {who: 'asst', img: 'asst_e13', title: '업종 고르기', tab: null, target: ['#catrow'],
      text: '처음엔 "전기·소방 감리"가 골라져 있어요. 공고명에 "감리"가 있고 "전기"나 "소방"이 들어간 공고예요(감리자(전기), 소방감리자 같은 것). 다른 업종 버튼도 함께 고를 수 있고, "사용자 지정"에서는 공고명 키워드를 직접 넣어요. "+"는 모두, 쉼표는 하나라도, 띄어쓰기는 무시해요. 전기+감리 · 전기+감리자 · 전기감리자가 어떻게 다른지는 "키워드 규칙 보기"에, 실제로 잡힌 공고와 빠진 공고는 "데이터 목록" 탭 맨 위 "검색어 확인"에 있어요.'},
    {who: 'asst', img: 'asst_e07', title: '기간 고르기', tab: null, target: ['#perrow'],
      text: '최근 1·3·6개월·1년 중 하나를 눌러요. 기간이 짧으면 건수가 적어서 숫자가 흔들려요. 바로 아래 줄에 지금 몇 건을 보고 있는지 나와요. 조달청 자료가 2026년 4월 20일부터 있어서, 지금은 6개월과 1년이 거의 같아요.'},
    {who: 'doc', img: 'doc_e07', title: '사정률 구간 읽기', tab: 'strategy', target: ['.bands', '#view .card'],
      text: '사정률을 히스토그램처럼 고정 칸(±0.5면 99~100, 100~101…)으로 나눠, 그 구간으로 넣었다면 1순위가 됐을 확률이 높은 순서로 5개를 보여 줍니다. 1순위 구간이 초록 칸이에요. 구간 범위는 ±0.5(기본), ±0.025, ±0.01 중에 고를 수 있어요. 좁히면 더 촘촘히 보이지만 칸마다 근거가 적어져 숫자를 덜 믿어야 합니다. \'칸을 쪼개면 어떻게 되나\' 그림의 ▶ 나눠 보기를 누르면 한 칸이 20칸, 50칸으로 쪼개지는 모습을 볼 수 있어요. 먼저 ±0.5로 방향을 잡으세요. 표에서는 구간 가운데에서 하한 미달 위험도 함께 보세요. 위험이 높으면 한 칸 위 구간이 안전합니다.'},
    {who: 'doc', img: 'doc_e10', title: '성적표 확인', tab: 'strategy', target: ['.verdict', '#view .card'],
      text: '꼭 보세요. 초록 줄이면 그 투찰률이 지난 자료에서 실제로 무작위보다 나았다는 뜻이고, 주황 줄이면 투찰률만으로는 확률을 못 올린다는 뜻입니다. 그럴 땐 경쟁이 적은 공고를 고르는 쪽이 낫습니다.'},
    {who: 'robo', img: 'robo_e09', title: '투찰금액 계산', tab: 'strategy', target: ['.calc', '#k_bss'],
      text: '공고문에 있는 기초금액, 낙찰하한율, 예비가격 범위(±2%·±3%), 넣을 사정률을 입력해. 투찰금액 = 기초금액 × 하한율 × 사정률을 원 단위로, 하한 미달 위험까지 내가 계산해 줄게. 사정률 칸에는 1순위 구간의 가운데 값이 미리 들어가 있어.'},
    {who: 'fly', img: 'fly_e07', title: '경쟁·유찰 살피기', tab: 'compete', target: ['#view .kpis'],
      text: '그 업종, 정말 경쟁이 적어? 참가업체 수 중앙값과 무작위 기준선부터 봐. "유찰 분석" 탭에는 유찰이 잦은 기관과 금액대가 나와. 유찰 뒤 재공고는 경쟁이 약한 경우가 많아.'},
    {who: 'asst', img: 'asst_e01', title: '참여할 공고 고르기', tab: 'upcoming', target: ['#view table', '#view .card'],
      text: '개찰 전 공고를 경쟁이 적을 것 같은 순서로 줄 세웠어요. 위쪽일수록 기대 확률이 높아요. 공고명을 누르면 나라장터 공고 화면이 열려요.'},
    {who: 'doc', img: 'doc_e08', title: '내 회사 점검', tab: 'mine', target: ['#view .kpis', '#view .card'],
      text: '마지막으로 우리 회사의 1순위·하한 미달 기록을 봅니다. 숫자의 근거는 "데이터 목록" 탭에서 공고별로 확인하고 CSV로 내려받을 수 있습니다. 확률은 과거 자료로 추정한 값이고 낙찰을 보장하지 않습니다. 투찰은 나라장터에서 직접 하세요.'},
  ];

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const seen = {
    get() { try { return localStorage.getItem('g2b_guide_seen') === '1'; } catch (e) { return false; } },
    set() { try { localStorage.setItem('g2b_guide_seen', '1'); } catch (e) {} },
  };

  /* ---------------------------------------------------------- 안내 지도 */
  function buildMap() {
    if ($('#guide')) return $('#guide');
    const g = document.createElement('div');
    g.id = 'guide'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-labelledby', 'guide-title');
    g.innerHTML = `
      <div class="gwrap">
        <button class="gclose" type="button" aria-label="안내 닫기">닫기 ✕</button>
        <div class="ghead">
          <div class="gcast">${['doc_e08', 'asst_e13', 'fly_e08', 'robo_e13'].map(k => `<img src="${IMG(k)}" alt="" aria-hidden="true">`).join('')}</div>
          <div>
            <p class="gkicker">연구실 안내 지도</p>
            <h2 id="guide-title">처음이세요? 정거장 8개만 따라오면 됩니다</h2>
            <p class="gsay"><b style="color:var(--c-doc)">박사</b> 업종과 기간을 고르고 → 확률과 성적표를 읽고 → 금액을 계산하고 → 경쟁이 적은 공고를 고르는 순서예요. 정거장을 누르면 실제 화면에서 그 자리를 비춰 드립니다.</p>
            <div class="gbtns"><button class="btn primary gstart" type="button">1번부터 따라하기 →</button><button class="btn gskip" type="button">지금은 건너뛰기</button></div>
          </div>
        </div>
        <div class="gmap" id="gmap">
          <svg class="groute" aria-hidden="true"></svg>
          ${STOPS.map((s, i) => `
            <button class="gstop" type="button" data-i="${i}" style="--who:${WHO[s.who].color}">
              <span class="gno">${i + 1}</span>
              <img src="${IMG(s.img)}" alt="" aria-hidden="true">
              <span class="gtitle">${esc(s.title)}</span>
              <span class="gwho">${WHO[s.who].name}</span>
            </button>`).join('')}
        </div>
        <p class="gnote">정거장을 누르면 그 단계부터 시작합니다. 언제든 Esc로 멈출 수 있어요.</p>
      </div>`;
    document.body.appendChild(g);
    g.querySelector('.gclose').onclick = closeMap;
    g.querySelector('.gskip').onclick = closeMap;
    g.querySelector('.gstart').onclick = () => startTour(0);
    g.querySelectorAll('.gstop').forEach(b => b.onclick = () => startTour(+b.dataset.i));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && g.classList.contains('open')) closeMap(); });
    window.addEventListener('resize', () => { if (g.classList.contains('open')) drawRoute(); });
    return g;
  }
  /* 정거장 번호를 잇는 점선 길 (배치가 바뀌면 다시 그림) */
  function drawRoute() {
    const map = $('#gmap'), svg = map.querySelector('.groute');
    const box = map.getBoundingClientRect();
    const pts = [...map.querySelectorAll('.gno')].map(n => {
      const r = n.getBoundingClientRect();
      return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2];
    });
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
    let d = '';
    pts.forEach(([x, y], i) => {
      if (!i) { d = `M${x} ${y}`; return; }
      const [px, py] = pts[i - 1];
      if (Math.abs(py - y) < 4) d += ` L${x} ${y}`;                 // 같은 줄: 곧게
      else { const my = (py + y) / 2; d += ` C${px} ${my} ${x} ${my} ${x} ${y}`; } // 줄 바뀜: 구불게
    });
    svg.innerHTML = `<path d="${d}"/>`;
  }
  function openMap() {
    stopTour(true);
    const g = buildMap();
    g.classList.add('open'); document.body.classList.add('noscroll');
    requestAnimationFrame(drawRoute);
    setTimeout(() => g.querySelector('.gstart').focus(), 50);
  }
  function closeMap() {
    const g = $('#guide'); if (!g) return;
    g.classList.remove('open'); document.body.classList.remove('noscroll'); seen.set();
  }

  /* ---------------------------------------------------------- 따라하기 */
  let idx = -1, spot, bub;
  function ensureTourEls() {
    if (spot) return;
    spot = document.createElement('div'); spot.id = 'tspot'; spot.setAttribute('aria-hidden', 'true');
    bub = document.createElement('div'); bub.id = 'tbub'; bub.setAttribute('role', 'dialog'); bub.setAttribute('aria-live', 'polite');
    document.body.append(spot, bub);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, {passive: true});
    document.addEventListener('keydown', e => {
      if (idx < 0) return;
      if (e.key === 'Escape') stopTour();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    });
  }
  function findTarget(s) { for (const q of s.target) { const el = document.querySelector(q); if (el && el.offsetParent !== null) return el; } return null; }
  function startTour(i) {
    closeMap(); ensureTourEls();
    document.body.classList.add('touring');
    show(i);
  }
  function step(d) { const n = idx + d; if (n < 0) return; if (n >= STOPS.length) return stopTour(); show(n); }
  function show(i) {
    idx = i; const s = STOPS[i];
    if (s.tab && window.G2BUI) window.G2BUI.go(s.tab);
    const w = WHO[s.who];
    bub.style.setProperty('--who', w.color);
    bub.innerHTML = `<img src="${IMG(s.img)}" alt="" aria-hidden="true">
      <div class="tbody"><div class="tmeta"><b>${w.name}</b><span>${i + 1} / ${STOPS.length} · ${esc(s.title)}</span></div>
      <p>${esc(s.text)}</p>
      <div class="tbtns"><button type="button" class="btn tprev" ${i ? '' : 'disabled'}>← 이전</button>
      <button type="button" class="btn tmap">지도</button><button type="button" class="btn tend">그만</button>
      <button type="button" class="btn primary tnext">${i === STOPS.length - 1 ? '끝내기 ✓' : '다음 →'}</button></div></div>`;
    bub.querySelector('.tprev').onclick = () => step(-1);
    bub.querySelector('.tnext').onclick = () => step(1);
    bub.querySelector('.tend').onclick = () => stopTour();
    bub.querySelector('.tmap').onclick = openMap;
    spot.style.display = bub.style.display = 'block';
    // 화면이 다시 그려진 뒤 대상을 찾아 가운데로 스크롤
    setTimeout(() => {
      const el = findTarget(s);
      if (el && !el.closest('header.top')) {           // 위쪽 고정 막대 안의 대상은 스크롤하지 않는다
        const hh = (document.querySelector('header.top') || {}).offsetHeight || 0;
        el.style.scrollMarginTop = (hh + 12) + 'px';      // 고정 막대 밑에 가리지 않게
        el.scrollIntoView({block: innerWidth <= 640 ? 'start' : 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
      }
      setTimeout(place, 380); place();
      bub.querySelector('.tnext').focus({preventScroll: true});
    }, 60);
  }
  function place() {
    if (idx < 0 || !spot) return;
    const el = findTarget(STOPS[idx]);
    const vw = innerWidth, vh = innerHeight, pad = 8;
    // 비추는 상자 위치는 계산값으로 쓴다(상자는 미끄러지며 움직이므로 DOM에서 다시 읽으면 중간값이 나옴)
    const sheet = vw <= 640;
    bub.classList.toggle('sheet', sheet);
    if (sheet) { bub.style.left = bub.style.top = ''; }
    const sheetTop = sheet ? vh - bub.offsetHeight - 16 : vh;   // 아래 말풍선이 차지하는 곳 위까지만 비춘다
    let sr = {left: vw / 2, top: vh / 2, right: vw / 2, bottom: vh / 2};
    if (!el) { spot.style.cssText = 'display:block;left:50%;top:50%;width:0;height:0'; }
    else {
      const r = el.getBoundingClientRect();
      const left = Math.max(4, r.left - pad), top = Math.max(4, r.top - pad);
      const w = Math.min(vw - 8, r.width + pad * 2);
      const h = Math.max(24, Math.min(sheet ? sheetTop - top : vh * 0.6, r.height + pad * 2));
      spot.style.cssText = `display:block;left:${left}px;top:${top}px;width:${w}px;height:${h}px`;
      sr = {left, top, right: left + w, bottom: top + h};
    }
    if (sheet) return;
    const bw = Math.min(460, vw - 32), bh = bub.offsetHeight || 220;
    let y = sr.bottom + 14; if (y + bh > vh - 12) y = Math.max(12, sr.top - bh - 14);
    let x = Math.min(Math.max(16, sr.left), vw - bw - 16);
    bub.style.width = bw + 'px'; bub.style.left = x + 'px'; bub.style.top = y + 'px';
  }
  function stopTour(silent) {
    if (idx < 0 && !silent) return;
    idx = -1;
    if (spot) spot.style.display = bub.style.display = 'none';
    document.body.classList.remove('touring');
    seen.set();
  }

  window.Guide = {open: openMap, start: startTour, firstVisit: () => !seen.get(), stops: STOPS};
})();
