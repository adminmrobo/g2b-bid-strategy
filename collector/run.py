# -*- coding: utf-8 -*-
"""수집 → 암호화 저장 → 앱 데이터 빌드.

  python -m collector.run collect   # API에서 받아 store/ 에 암호화 저장 (이어받기)
  python -m collector.run build     # store/ → docs/data.bin (앱이 비밀번호로 푸는 파일)
  python -m collector.run rekey     # 비밀번호 변경: OLD_PASSWORD → APP_PASSWORD 로 store/ 재암호화

환경변수: SERVICE_KEY(공공데이터포털 인증키), APP_PASSWORD(앱 비밀번호), MY_BIZNO(선택, 쉼표 구분)
"""
import argparse
import calendar
import datetime as dt
import json
import os
import re
import sys
import time
from zoneinfo import ZoneInfo

from . import crypto_store as cs
from .g2b_api import ApiError, Client, QuotaExceeded
from .summarize import SUMMARY_VERSION, summarize_notices, summarize_scsbid

KST = ZoneInfo("Asia/Seoul")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(ROOT, "store")
MANIFEST = os.path.join(STORE, "manifest.json")
DIVS = {"3": "공사", "5": "용역"}


def log(*a):
    print(*a, flush=True)


def today():
    return dt.datetime.now(KST).date()


def load_manifest():
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_manifest(m):
    os.makedirs(STORE, exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=0, sort_keys=True)


def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")


def scsbid_path(div, d):
    return os.path.join(STORE, "scsbid", div, f"{d:%Y%m%d}.bin")


def notice_path(y, m):
    return os.path.join(STORE, "notice", f"{y:04d}{m:02d}.bin")


def month_iter(start, n):
    y, m = start.year, start.month
    for _ in range(n):
        yield y, m
        m -= 1
        if m == 0:
            y, m = y - 1, 12


def env(name, required=True):
    v = os.environ.get(name, "").strip()
    if required and not v:
        sys.exit(f"환경변수 {name} 가 필요합니다.")
    return v


# ---------------------------------------------------------------- collect
def collect(days_back, budget, max_minutes, refresh_days, notice_months, session=None):
    pw = env("APP_PASSWORD")
    my = [b for b in env("MY_BIZNO", False).split(",") if b.strip()]
    cur = {"label": ""}

    def progress(page, pages):
        if pages >= 25:
            log(f"    {cur['label']} … {page}/{pages} 페이지 (호출 {cli.calls})")

    cli = Client(env("SERVICE_KEY"), session=session, budget=budget, progress=progress)
    man = load_manifest()
    t0 = time.time()
    now = dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    td = today()
    deadline = t0 + max_minutes * 60

    def do_scsbid(div, d):
        cur["label"] = f"낙찰 {DIVS[div]} {d}"
        c0 = cli.calls
        rows, total = cli.scsbid_day(f"{d:%Y%m%d}", div)
        bids = summarize_scsbid(rows, my)
        p = scsbid_path(div, d)
        changed = cs.write_if_changed(p, bids, pw, man, {"n": len(bids), "rows": total, "at": now,
                                                         "calls": cli.calls - c0, "sv": SUMMARY_VERSION}, key=rel(p))
        log(f"  낙찰 {DIVS[div]} {d}  업체행 {total:>7,}  입찰 {len(bids):>5,}  {'변경' if changed else '동일'}  (호출 {cli.calls})")

    def do_notice(y, m):
        cur["label"] = f"공고 {y}-{m:02d}"
        last = calendar.monthrange(y, m)[1]
        end = min(dt.date(y, m, last), td)
        rows, total = cli.notices(f"{y:04d}{m:02d}010000", f"{end:%Y%m%d}2359")
        nts = summarize_notices(rows)
        p = notice_path(y, m)
        changed = cs.write_if_changed(p, nts, pw, man, {"n": len(nts), "rows": total, "at": now,
                                                        "complete": end == dt.date(y, m, last)}, key=rel(p))
        log(f"  공고 {y}-{m:02d}  원자료 {total:>7,}  공사·용역 {len(nts):>6,}  {'변경' if changed else '동일'}  (호출 {cli.calls})")

    def have(p, need_complete=False, need_sv=False):
        e = man.get(rel(p))
        if not e or not os.path.exists(p):
            return False
        if need_sv and e.get("sv", 1) < SUMMARY_VERSION:   # 요약 형식이 바뀌면 다시 받는다
            return False
        return e.get("complete", True) if need_complete else True

    # 작업 목록: ① 최근 공고(이번 달·지난달) ② 최근 며칠 낙찰 재수집 ③ 빈 날짜 뒤에서부터 채우기
    jobs = []
    for i, (y, m) in enumerate(month_iter(td, notice_months)):
        if i < 2 or not have(notice_path(y, m), need_complete=True):
            jobs.append(("notice", (y, m), i < 2))
    for k in range(refresh_days):
        d = td - dt.timedelta(days=k)
        for div in DIVS:
            jobs.append(("scsbid", (div, d), True))
    for k in range(refresh_days, days_back):
        d = td - dt.timedelta(days=k)
        for div in DIVS:
            if not have(scsbid_path(div, d), need_sv=True):
                jobs.append(("scsbid", (div, d), False))
    # 최근 것 먼저, 공고는 앞쪽에 두되 백필 공고는 낙찰 백필 사이에 섞는다
    pri = [j for j in jobs if j[2]]
    back = [j for j in jobs if not j[2]]
    back.sort(key=lambda j: (j[1][1] if j[0] == "scsbid" else dt.date(j[1][0], j[1][1], 28)), reverse=True)
    jobs = pri + back
    log(f"[collect] 오늘 {td} · 작업 {len(jobs)}개 (우선 {len(pri)}, 백필 {len(back)}) · 호출 예산 {budget}")

    done = 0
    stop_reason = "완료"
    remaining = list(jobs)
    try:
        for kind, arg, _ in jobs:
            if time.time() > deadline:
                stop_reason = "시간 제한"
                break
            try:
                do_notice(*arg) if kind == "notice" else do_scsbid(*arg)
                done += 1
                remaining.pop(0)
            except ApiError as e:
                log(f"  ! {kind} {arg}: {e}")
                remaining.pop(0)
            if done % 20 == 0:
                save_manifest(man)
    except QuotaExceeded as e:
        stop_reason = f"호출 한도 ({e})"
    save_manifest(man)
    left = len(remaining)
    # 남은 백필 예상: 업무구분별 하루치 평균 호출 수 × 남은 날짜 ÷ 하루 처리 능력
    avg = {}
    for k, e in man.items():
        mm = re.search(r"scsbid/(\d+)/", k)
        if mm and isinstance(e, dict) and e.get("calls"):
            avg.setdefault(mm.group(1), []).append(e["calls"])
    avg = {d: sum(v) / len(v) for d, v in avg.items()}
    est = sum(avg.get(a[0], 50) for k, a, _ in remaining if k == "scsbid") + 60 * sum(1 for k, *_ in remaining if k == "notice")
    mins = max(1e-9, (time.time() - t0) / 60)
    cap = min(budget, cli.calls / mins * max_minutes) if cli.calls > 20 else budget
    eta = 0 if not left else max(1, -(-int(est) // max(1, int(cap))))
    left_days = len({a[1] for k, a, _ in remaining if k == "scsbid"})
    log(f"[collect] {stop_reason} · 처리 {done} · 남음 {left}(낙찰 {left_days}일치) · API 호출 {cli.calls} · "
        f"{time.time() - t0:.0f}초 · 남은 예상 호출 {int(est):,} → 약 {eta}일")
    status = {"last_run": now, "calls": cli.calls, "done": done, "left": left, "left_days": left_days,
              "est_calls": int(est), "eta_days": eta, "stop": stop_reason,
              "avg_calls_per_day": {DIVS[d]: round(v, 1) for d, v in avg.items()}}
    man["_status"] = status
    save_manifest(man)
    return status


# ---------------------------------------------------------------- build
BID_COLS = ["id", "nm", "dt", "div", "inst", "dinst", "mth", "cm", "res", "fl", "fle", "ps", "bss", "pre",
            "n", "nr", "wr", "w2", "wa", "wc", "wb", "fw", "t", "ub", "my", "mr", "mq", "ind", "rgn", "rpm"]
UP_COLS = ["id", "nm", "div", "st", "ndt", "cls", "odt", "inst", "dinst", "mth", "cm", "ps", "ab", "rpm",
           "rl", "rgn", "ind", "url"]


def build(out_path, months, upcoming_days):
    pw = env("APP_PASSWORD")
    man = load_manifest()
    td = today()
    since = td - dt.timedelta(days=int(months * 30.5))

    notices = {}
    for y, m in month_iter(td, months + 2):
        p = notice_path(y, m)
        if os.path.exists(p):
            for n in cs.read(p, pw):
                notices[n["id"]] = n
    by_no = {}
    for n in notices.values():  # 같은 공고번호의 최신 차수
        if n["no"] not in by_no or n["od"] > by_no[n["no"]]["od"]:
            by_no[n["no"]] = n

    bids, days = {}, {d: 0 for d in DIVS}
    for div in DIVS:
        folder = os.path.join(STORE, "scsbid", div)
        if not os.path.isdir(folder):
            continue
        for fn in sorted(os.listdir(folder)):
            d = dt.datetime.strptime(fn[:8], "%Y%m%d").date()
            if d < since:
                continue
            days[div] += 1
            for b in cs.read(os.path.join(folder, fn), pw):
                nt = notices.get(b["id"]) or by_no.get(b["no"])
                if nt:
                    b["ind"], b["rgn"], b["rpm"] = nt["ind"], nt["rgn"], nt["rpm"]
                bids[b["id"]] = b  # 같은 공고가 여러 날 나오면 마지막(최신) 우선

    rows = sorted(bids.values(), key=lambda b: b.get("dt", ""))
    horizon = td + dt.timedelta(days=upcoming_days)
    up = {}
    for n in notices.values():
        if not n["odt"] or "취소" in n["st"]:
            continue
        od = dt.date.fromisoformat(n["odt"])
        if td <= od <= horizon:
            if n["no"] not in up or n["od"] > up[n["no"]]["od"]:
                up[n["no"]] = n
    upcoming = sorted(up.values(), key=lambda n: n["odt"])

    expected = {d: (td - since).days for d in DIVS}
    meta = {
        "built": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
        "today": td.isoformat(), "since": since.isoformat(),
        "first": rows[0]["dt"] if rows else None, "last": rows[-1]["dt"] if rows else None,
        "n_bids": len(rows), "n_upcoming": len(upcoming), "n_notices": len(notices),
        "coverage": {DIVS[d]: {"days": days[d], "expected": expected[d]} for d in DIVS},
        "status": man.get("_status", {}),
        "my_set": bool(env("MY_BIZNO", False)),
    }
    data = {
        "meta": meta,
        "bids": {"cols": BID_COLS, "rows": [[b.get(c) for c in BID_COLS] for b in rows]},
        "upcoming": {"cols": UP_COLS, "rows": [[n.get(c) for c in UP_COLS] for n in upcoming]},
    }
    blob = cs.encrypt_obj(data, pw)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(blob)
    log(f"[build] 입찰 {len(rows):,}건 · 진행공고 {len(upcoming):,}건 · {len(blob) / 1e6:.2f} MB → {out_path}")
    return meta


def rekey():
    old, new = env("OLD_PASSWORD"), env("APP_PASSWORD")
    n = 0
    for base, _, files in os.walk(STORE):
        for fn in files:
            if fn.endswith(".bin"):
                p = os.path.join(base, fn)
                obj = cs.read(p, old)
                with open(p, "wb") as f:
                    f.write(cs.encrypt_obj(obj, new))
                n += 1
    log(f"[rekey] {n}개 파일 재암호화")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--days-back", type=int, default=400)
    c.add_argument("--budget", type=int, default=8500)
    c.add_argument("--max-minutes", type=int, default=300)
    c.add_argument("--refresh-days", type=int, default=3)
    c.add_argument("--notice-months", type=int, default=14)
    b = sub.add_parser("build")
    b.add_argument("--out", default=os.path.join(ROOT, "docs", "data.bin"))
    b.add_argument("--months", type=int, default=13)
    b.add_argument("--upcoming-days", type=int, default=45)
    sub.add_parser("rekey")
    a = ap.parse_args(argv)
    if a.cmd == "collect":
        collect(a.days_back, a.budget, a.max_minutes, a.refresh_days, a.notice_months)
    elif a.cmd == "build":
        build(a.out, a.months, a.upcoming_days)
    else:
        rekey()


if __name__ == "__main__":
    main()
