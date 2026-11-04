# -*- coding: utf-8 -*-
"""조달청 공공데이터개방표준서비스(PubDataOpnStdService) v1.2 클라이언트.

- 낙찰정보  getDataSetOpnStdScsbidInfo : 개찰일시 범위 1일, 업무구분코드 필수(1 물품, 2 외자, 3 공사, 5 용역)
- 입찰공고  getDataSetOpnStdBidPblancInfo : 공고일시 범위 1개월
- 일일 트래픽 10,000회(기능별)
"""
import json
import time

import requests

ENDPOINT = "https://apis.data.go.kr/1230000/ao/PubDataOpnStdService"
OP_SCSBID = "getDataSetOpnStdScsbidInfo"
OP_NOTICE = "getDataSetOpnStdBidPblancInfo"
DEFAULT_ROWS = 999


class QuotaExceeded(Exception):
    """일일 트래픽 초과(22) — 오늘은 그만 받고 내일 이어받는다."""


class ApiError(Exception):
    pass


class Client:
    def __init__(self, service_key, session=None, sleep=0.05, budget=8000):
        # 포털의 Encoding 키든 Decoding 키든 받아서 디코딩 키로 통일 (requests가 다시 인코딩)
        self.key = requests.utils.unquote(service_key.strip())
        self.s = session or requests.Session()
        self.sleep = sleep
        self.budget = budget
        self.calls = 0

    # ------------------------------------------------------------ 저수준
    def _get(self, op, params):
        if self.calls >= self.budget:
            raise QuotaExceeded(f"이번 실행 호출 예산 {self.budget}회 소진")
        q = {"serviceKey": self.key, "type": "json", **params}
        last = None
        for attempt in range(5):
            try:
                self.calls += 1
                r = self.s.get(f"{ENDPOINT}/{op}", params=q, timeout=90)
                txt = r.text.strip()
                if self.sleep:
                    time.sleep(self.sleep)
                return self._parse(txt)
            except (requests.RequestException, json.JSONDecodeError) as e:
                last = e
                time.sleep(3 * (attempt + 1))
        raise ApiError(f"{op} 재시도 실패: {last}")

    @staticmethod
    def _parse(txt):
        if txt.startswith("<"):  # 인증 오류 등은 XML(OpenAPI_ServiceResponse)로 온다
            code = "??"
            for tag in ("returnReasonCode", "resultCode"):
                if f"<{tag}>" in txt:
                    code = txt.split(f"<{tag}>")[1].split("<")[0].strip()
                    break
            if code == "22":
                raise QuotaExceeded(txt[:200])
            if code in ("03",):
                return [], 0
            if code == "00":
                raise ApiError("XML 응답은 지원하지 않음(type=json 확인)")
            raise ApiError(f"API 오류 코드 {code}: {txt[:300]}")
        js = json.loads(txt)
        root = js.get("response", js)
        head = root.get("header", {})
        rc = str(head.get("resultCode", "00"))
        if rc == "03":
            return [], 0
        if rc == "22":
            raise QuotaExceeded(str(head))
        if rc not in ("00", "0"):
            raise ApiError(f"resultCode={rc} {head.get('resultMsg')}")
        body = root.get("body", {}) or {}
        items = body.get("items") or []
        if isinstance(items, dict):
            items = items.get("item", [])
        if isinstance(items, dict):
            items = [items]
        return items, int(body.get("totalCount") or 0)

    def _paged(self, op, params):
        rows = DEFAULT_ROWS
        items, total = self._get(op, {**params, "numOfRows": rows, "pageNo": 1})
        out = list(items)
        if total and 0 < len(items) < min(rows, total):  # 서버 최대 페이지 크기가 더 작음
            rows = len(items)
        pages = -(-total // rows) if total else 1
        for p in range(2, pages + 1):
            it, _ = self._get(op, {**params, "numOfRows": rows, "pageNo": p})
            out.extend(it)
        return out, total

    # ------------------------------------------------------------ 오퍼레이션
    def scsbid_day(self, yyyymmdd, bsns_div_cd):
        """하루치 낙찰정보(업체별 행)."""
        return self._paged(OP_SCSBID, {
            "bsnsDivCd": bsns_div_cd,
            "opengBgnDt": f"{yyyymmdd}0000",
            "opengEndDt": f"{yyyymmdd}2359",
        })

    def notices(self, bgn_yyyymmddhhmm, end_yyyymmddhhmm):
        """입찰공고정보(공고일시 범위 ≤ 1개월)."""
        return self._paged(OP_NOTICE, {
            "bidNtceBgnDt": bgn_yyyymmddhhmm,
            "bidNtceEndDt": end_yyyymmddhhmm,
        })
