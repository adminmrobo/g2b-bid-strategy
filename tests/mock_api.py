# -*- coding: utf-8 -*-
"""모의 조달청 API: 매뉴얼 v1.2 응답 형식으로 가짜 데이터를 만든다(테스트 전용)."""
import datetime as dt, hashlib, json, random

CATS = [("공사", "OO초등학교 전기공사", "전기공사업", 87.745),
        ("공사", "OO청사 소방시설 보수공사", "소방시설공사업", 87.745),
        ("공사", "OO도로 포장공사", "토목공사업", 87.745),
        ("용역", "OO복합센터 전기감리 용역", "전력기술관리업", 82.995),
        ("용역", "OO아파트 소방감리 용역", "소방공사감리업", 82.995),
        ("공사", "OO정보통신 설비공사", "정보통신공사업", 87.745)]
MY = "1234567890"

def rng_for(*k):
    return random.Random(int(hashlib.md5("|".join(map(str, k)).encode()).hexdigest()[:8], 16))

def sj_draw(r, span):
    pts = [1 - span + (2 * span) * (i + r.random()) / 15 for i in range(15)]
    return sum(r.sample(pts, 4)) / 4

def day_bids(day, div):
    r = rng_for(day, div)
    rows = []
    nb = r.randint(4, 9)
    for b in range(nb):
        cat = r.choice([c for c in CATS if c[0] == {"3": "공사", "5": "용역"}[div]])
        no = f"R{day[2:4]}BK{int(day[4:]) * 100 + b + int(div) * 7:08d}"
        bss = r.choice([8e7, 2.3e8, 5.1e8, 1.2e9]) * (0.8 + 0.4 * r.random())
        bss = round(bss, -3)
        sj = sj_draw(r, 0.02 if div == "5" else 0.03)
        pre = round(bss * sj)
        fl = cat[3]
        target = fl * sj  # % of 기초
        n = r.choice([0, 1] + [r.randint(20, 400)] * 6)
        res = "개찰완료" if n >= 2 else "유찰"
        base = dict(bidNtceNo=no, bidNtceOrd="000", bidNtceNm=cat[1].replace("OO", r.choice(["서울", "부산", "대전", "광주"])),
                    bsnsDivNm=cat[0], cntrctCnclsSttusNm="총액계약", cntrctCnclsMthdNm="제한경쟁",
                    bidwinrDcsnMthdNm="적격심사제", ntceInsttNm=r.choice(["조달청", "OO시", "OO교육청"]),
                    ntceInsttCd="1234567", dmndInsttNm="수요기관", dmndInsttCd="7654321",
                    sucsfLwstlmtRt=str(fl), presmptPrce=str(round(bss / 1.1)), rsrvtnPrce=str(pre), bssAmt=str(int(bss)),
                    opengDate=f"{day[:4]}-{day[4:6]}-{day[6:]}", opengTm="11:00", opengRsltDivNm=res,
                    dataBssDate=f"{day[:4]}-{day[4:6]}-{day[6:]}")
        if n == 0:
            rows.append({**base, "opengRank": "", "bidprcAmt": "", "bidprcRt": ""})
            continue
        xs = [r.gauss(target + 0.1, 0.6) for _ in range(n)]
        if r.random() < 0.3:
            xs[0] = target + r.uniform(-0.3, 0.6); mine = 0
        else:
            mine = None
        bidders = []
        for i, x in enumerate(xs):
            amt = round(bss * x / 100)
            rt = amt / pre * 100
            bidders.append([i, amt, rt])
        valid = sorted([b for b in bidders if b[2] >= fl], key=lambda b: b[1])
        rank = {b[0]: k + 1 for k, b in enumerate(valid)}
        for i, amt, rt in bidders:
            biz = MY if (mine is not None and i == mine) else f"{r.randint(1000000000, 9999999999)}"
            rows.append({**base, "opengRank": str(rank.get(i, "")), "bidprcCorpBizrno": biz,
                         "bidprcCorpNm": "우리회사(주)" if biz == MY else f"업체{r.randint(1, 60)}",
                         "bidprcCorpCeoNm": "홍길동", "bidprcAmt": str(amt), "bidprcRt": f"{rt:.3f}",
                         "sucsfYn": "Y" if rank.get(i) == 1 else "N", "dqlfctnRsn": "정상" if i in rank else "하한율미만",
                         "fnlSucsfCorpNm": "", "fnlSucsfAmt": ""})
    return rows

def month_notices(bgn, end):
    """공고일 nd 에 나온 공고 = nd+10일에 개찰되는 입찰(같은 공고번호)."""
    d0 = dt.datetime.strptime(bgn[:8], "%Y%m%d").date(); d1 = dt.datetime.strptime(end[:8], "%Y%m%d").date()
    out = []
    nd = d0
    while nd <= d1:
        od = nd + dt.timedelta(days=10)
        for div in ("3", "5"):
            seen = set()
            for row in day_bids(f"{od:%Y%m%d}", div):
                if row["bidNtceNo"] in seen:
                    continue
                seen.add(row["bidNtceNo"])
                cat = next(c for c in CATS if c[1].split()[-1] in row["bidNtceNm"] and c[0] == row["bsnsDivNm"])
                out.append(dict(bidNtceNo=row["bidNtceNo"], bidNtceOrd="000", bidNtceNm=row["bidNtceNm"],
                                bsnsDivNm=row["bsnsDivNm"], bidNtceSttusNm="일반공고", bidNtceDate=nd.isoformat(),
                                bidClseDate=(od - dt.timedelta(days=1)).isoformat(), opengDate=od.isoformat(),
                                ntceInsttNm=row["ntceInsttNm"], dmndInsttNm=row["dmndInsttNm"],
                                bidwinrDcsnMthdNm="적격심사제", cntrctCnclsMthdNm="제한경쟁",
                                presmptPrce=row["presmptPrce"], asignBdgtAmt="", rsrvtnPrceDcsnMthdNm="복수예가",
                                rgnLmtYn="Y", prtcptPsblRgnNm="인천광역시", indstrytyLmtYn="Y",
                                bidprcPsblIndstrytyNm=cat[2],
                                bidNtceUrl=f"https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo={row['bidNtceNo']}&bidPbancOrd=000"))
        nd += dt.timedelta(days=1)
    out.append(dict(bidNtceNo="X1", bsnsDivNm="물품", bidNtceNm="물품 구매"))
    return out

class Resp:
    def __init__(self, t): self.text = t

class MockSession:
    def __init__(self, server_max_rows=500):
        self.calls = 0; self.server_max_rows = server_max_rows
    def get(self, url, params, timeout):
        self.calls += 1
        assert "%" not in params["serviceKey"], "키가 이중 인코딩됨"
        op = url.rsplit("/", 1)[1]
        if op == "getDataSetOpnStdScsbidInfo":
            assert params["opengBgnDt"][:8] == params["opengEndDt"][:8], "1일 제한 위반"
            allr = day_bids(params["opengBgnDt"][:8], str(params["bsnsDivCd"]))
        else:
            allr = month_notices(params["bidNtceBgnDt"], params["bidNtceEndDt"])
        nr = min(int(params["numOfRows"]), self.server_max_rows); p = int(params["pageNo"])
        it = allr[(p - 1) * nr: p * nr]
        if not allr:
            return Resp(json.dumps({"response": {"header": {"resultCode": "03", "resultMsg": "NODATA"}}}))
        return Resp(json.dumps({"response": {"header": {"resultCode": "00", "resultMsg": "정상"},
                                             "body": {"items": it, "numOfRows": nr, "pageNo": p, "totalCount": len(allr)}}},
                               ensure_ascii=False))
