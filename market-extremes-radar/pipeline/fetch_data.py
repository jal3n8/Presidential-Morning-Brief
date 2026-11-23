"""Download end-of-day history for the symbols in pipeline/symbols.json.

Sources (public endpoints, no API key):
  * Yahoo Finance chart API  - primary daily closes (personal-use terms; do not republish)
  * FRED (St. Louis Fed)     - independent cross-check for S&P 500 (SP500) and VIX (VIXCLS)

Raw responses are saved untouched under data/raw/ (git-ignored) together with the
retrieval time, so every derived number can be traced back to a file.
Downloaded content is parsed as JSON/CSV data only and is never executed.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from common import RAW_DIR, load_symbols, series_filename, utc_now_iso

UA = "Mozilla/5.0 (X11; Linux x86_64) WOI-Radar-Research/0.1"
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1=-1325635200&period2={now}&interval=1d&includeAdjustedClose=true&events=div%2Csplit"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"
MAX_BYTES = 20 * 1024 * 1024


def get(url: str, attempts: int = 5) -> bytes:
    delay = 3.0
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/csv,*/*"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise ValueError("response larger than 20 MB - refusing")
                return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < attempts - 1:
                print(f"    HTTP {e.code}; retrying in {delay:.0f}s")
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except urllib.error.URLError as e:
            if i < attempts - 1:
                print(f"    network error {e.reason}; retrying in {delay:.0f}s")
                time.sleep(delay)
                delay *= 2
                continue
            raise
    raise RuntimeError("unreachable")


def main() -> int:
    (RAW_DIR / "yahoo").mkdir(parents=True, exist_ok=True)
    (RAW_DIR / "fred").mkdir(parents=True, exist_ok=True)
    log = {"startedAt": utc_now_iso(), "files": {}, "failures": {}}
    now = int(time.time())
    for s in load_symbols():
        sym = s["symbol"]
        url = YAHOO.format(sym=urllib.parse.quote(sym, safe=""), now=now)
        print(f"Yahoo  {sym}")
        try:
            body = get(url)
            json.loads(body)  # must be valid JSON before we keep it
            out = RAW_DIR / "yahoo" / series_filename(sym)
            out.write_bytes(body)
            log["files"][f"yahoo:{sym}"] = {"url": url, "retrievedAt": utc_now_iso(), "bytes": len(body), "path": str(out.relative_to(RAW_DIR.parent.parent))}
        except Exception as e:  # keep going; build step reports what is missing
            print(f"    FAILED: {e}")
            log["failures"][f"yahoo:{sym}"] = str(e)
        time.sleep(1.5)  # be polite
        sid = s.get("fredCrossCheck")
        if sid:
            url = FRED.format(sid=sid)
            print(f"FRED   {sid}")
            try:
                body = get(url)
                if not body.lower().startswith((b"observation_date", b"date")):
                    raise ValueError("unexpected FRED CSV header")
                out = RAW_DIR / "fred" / f"{sid}.csv"
                out.write_bytes(body)
                log["files"][f"fred:{sid}"] = {"url": url, "retrievedAt": utc_now_iso(), "bytes": len(body), "path": str(out.relative_to(RAW_DIR.parent.parent))}
            except Exception as e:
                print(f"    FAILED: {e}")
                log["failures"][f"fred:{sid}"] = str(e)
    log["finishedAt"] = utc_now_iso()
    (RAW_DIR / "fetch_log.json").write_text(json.dumps(log, indent=2), encoding="utf-8")
    print(f"\nDownloaded {len(log['files'])} files, {len(log['failures'])} failures. Log: data/raw/fetch_log.json")
    core_failed = [k for k in log["failures"] if k in ("yahoo:^GSPC", "yahoo:^VIX")]
    # A failed watchlist symbol is reported but does not stop the build step.
    return 1 if core_failed else 0


if __name__ == "__main__":
    sys.exit(main())
