import os, sys, shutil, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.update(SERVICE_KEY="abc%2Bdef%3D%3D", APP_PASSWORD="test-password-only", MY_BIZNO="123-45-67890")
from collector import run, crypto_store as cs
from tests.mock_api import MockSession
import tempfile
run.STORE = tempfile.mkdtemp(prefix="g2b_store_")          # 실제 store/ 는 건드리지 않음
run.MANIFEST = os.path.join(run.STORE, "manifest.json")
s = MockSession(server_max_rows=int(os.environ.get('MOCK_PAGE', '500')))
st = run.collect(days_back=40, budget=60, max_minutes=10, refresh_days=3, notice_months=3, session=s)
assert st["left"] > 0, "예산 60회로는 다 못 받아야 함(이어받기 검증)"
st2 = run.collect(days_back=40, budget=50000, max_minutes=10, refresh_days=3, notice_months=3, session=s)
assert st2["left"] == 0, st2
assert st["avg_calls_per_day"] and st["eta_days"] >= 1, st
calls_before = s.calls
st3 = run.collect(days_back=40, budget=50000, max_minutes=10, refresh_days=3, notice_months=3, session=s)
print("3rd run calls", s.calls - calls_before, "(최근 3일 + 공고 2개월만 다시 받아야 함)")
out = os.path.join(run.STORE, "out_data.bin")
meta = run.build(out, months=2, upcoming_days=45)
d = cs.decrypt_obj(open(out, "rb").read(), "test-password-only")
print(json.dumps(d["meta"], ensure_ascii=False)[:900])
json.dump(d, open(os.environ.get("DUMP_JSON", os.devnull), "w"), ensure_ascii=False)
cols = d["bids"]["cols"]; rows = d["bids"]["rows"]
B = [dict(zip(cols, r)) for r in rows]
print("bids", len(B), "with t", sum(b["t"] is not None for b in B), "with ind", sum(bool(b.get("ind")) for b in B),
      "mine", sum(b.get("my") is not None for b in B), "유찰", sum("유찰" in b["res"] for b in B))
ok = [b for b in B if b["t"] and b["wr"]]
assert all(b["wr"] >= b["t"] - 1e-3 for b in ok), "1순위가 하한선 아래"
print("sample", {k: B[5][k] for k in ["id", "nm", "dt", "div", "fl", "bss", "pre", "n", "nr", "wr", "t", "wc", "my", "mr"]})
try:
    cs.decrypt_obj(open(out, "rb").read(), "wrong"); raise SystemExit("오답 비밀번호가 통과함")
except Exception as e:
    print("wrong password rejected:", type(e).__name__)
# store 파일이 평문이 아닌지
blob = open(os.path.join(run.STORE, "scsbid", "3", sorted(os.listdir(os.path.join(run.STORE, "scsbid", "3")))[0]), "rb").read()
assert "전기".encode() not in blob
print("OK")
shutil.rmtree(run.STORE, ignore_errors=True)
