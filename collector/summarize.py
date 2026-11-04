# -*- coding: utf-8 -*-
"""API 원자료(업체별 행) → 입찰 1건 = 1레코드 요약.

개인정보(대표자명·담당자명·전화·이메일)는 저장하지 않는다.
업체는 상호와 사업자번호만 남긴다(낙찰 1순위·최종낙찰).
"""
import re


def num(v):
    if v is None:
        return None
    s = str(v).replace(",", "").strip()
    if s == "" or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def digits(v):
    return re.sub(r"\D", "", str(v or ""))


def r4(x):
    return None if x is None else round(x, 4)


def summarize_scsbid(rows, my_biznos=()):
    """하루치 낙찰정보 행들을 공고번호+차수로 묶어 입찰 요약을 만든다."""
    my = {digits(b) for b in my_biznos if digits(b)}
    groups = {}
    for r in rows:
        key = (str(r.get("bidNtceNo") or "").strip(), str(r.get("bidNtceOrd") or "000").strip())
        if not key[0]:
            continue
        groups.setdefault(key, []).append(r)

    out = []
    for (no, od), g in groups.items():
        f = g[0]
        bss = num(f.get("bssAmt"))
        pre = num(f.get("rsrvtnPrce"))
        fl = num(f.get("sucsfLwstlmtRt"))
        bidders = []
        for r in g:
            amt = num(r.get("bidprcAmt"))
            if not amt or amt <= 0:
                continue
            rk = num(r.get("opengRank"))
            bidders.append({
                "amt": amt,
                "rk": int(rk) if rk is not None else None,
                "rt": num(r.get("bidprcRt")),
                "biz": digits(r.get("bidprcCorpBizrno")),
                "nm": (r.get("bidprcCorpNm") or "").strip(),
                "dq": (r.get("dqlfctnRsn") or "").strip(),
            })
        ranked = sorted([b for b in bidders if b["rk"] is not None], key=lambda b: (b["rk"], b["amt"]))
        win = ranked[0] if ranked else None
        sec = ranked[1] if len(ranked) > 1 else None

        # 하한율이 비어 있으면 순위권 최저 투찰율(예정가 대비)로 근사
        fl_est = False
        if fl is None and ranked:
            rts = [b["rt"] for b in ranked if b["rt"]]
            if rts:
                fl, fl_est = min(rts), True

        def rb(b):
            return (b["amt"] / bss * 100) if (b and bss) else None

        rec = {
            "id": f"{no}-{od}", "no": no, "od": od,
            "nm": (f.get("bidNtceNm") or "").strip(),
            "dt": (f.get("opengDate") or "")[:10],
            "div": (f.get("bsnsDivNm") or "").strip(),
            "inst": (f.get("ntceInsttNm") or "").strip(),
            "dinst": (f.get("dmndInsttNm") or "").strip(),
            "mth": (f.get("bidwinrDcsnMthdNm") or "").strip(),
            "cm": (f.get("cntrctCnclsMthdNm") or "").strip(),
            "res": (f.get("opengRsltDivNm") or "").strip(),
            "fl": r4(fl), "fle": 1 if fl_est else 0,
            "ps": num(f.get("presmptPrce")), "bss": bss, "pre": pre,
            "n": len(bidders), "nr": len(ranked),
            "wr": r4(rb(win)), "w2": r4(rb(sec)),
            "wc": win["nm"] if win else "", "wb": win["biz"] if win else "",
            "fw": (f.get("fnlSucsfCorpNm") or "").strip(),
        }
        # 하한선(기초금액 대비 %) = 하한율 × 사정률
        rec["t"] = r4(fl * pre / bss) if (fl and pre and bss) else None
        if my:
            mine = [b for b in bidders if b["biz"] in my]
            if mine:
                m = min(mine, key=lambda b: b["amt"])
                rec["my"] = r4(rb(m))
                rec["mr"] = m["rk"] if m["rk"] is not None else -1
                rec["mq"] = m["dq"][:30]
        out.append(rec)
    return out


NOTICE_KEEP_DIV = ("공사", "용역")


def summarize_notices(rows):
    out = {}
    for r in rows:
        div = (r.get("bsnsDivNm") or "").strip()
        if div not in NOTICE_KEEP_DIV:
            continue
        no = str(r.get("bidNtceNo") or "").strip()
        od = str(r.get("bidNtceOrd") or "000").strip()
        if not no:
            continue
        out[f"{no}-{od}"] = {
            "id": f"{no}-{od}", "no": no, "od": od,
            "nm": (r.get("bidNtceNm") or "").strip(),
            "div": div,
            "st": (r.get("bidNtceSttusNm") or "").strip(),
            "ndt": (r.get("bidNtceDate") or "")[:10],
            "cls": (r.get("bidClseDate") or "")[:10],
            "odt": (r.get("opengDate") or "")[:10],
            "inst": (r.get("ntceInsttNm") or "").strip(),
            "dinst": (r.get("dmndInsttNm") or "").strip(),
            "mth": (r.get("bidwinrDcsnMthdNm") or "").strip(),
            "cm": (r.get("cntrctCnclsMthdNm") or "").strip(),
            "ps": num(r.get("presmptPrce")), "ab": num(r.get("asignBdgtAmt")),
            "rpm": (r.get("rsrvtnPrceDcsnMthdNm") or "").strip(),
            "rl": (r.get("rgnLmtYn") or "").strip(),
            "rgn": (r.get("prtcptPsblRgnNm") or "").strip()[:80],
            "ind": (r.get("bidprcPsblIndstrytyNm") or "").strip()[:200],
            "url": (r.get("bidNtceUrl") or "").strip(),
        }
    return list(out.values())
