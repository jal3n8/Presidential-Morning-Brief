"""Build the VERIFIED dataset the dashboard reads, from the raw downloads in data/raw/.

Steps for every symbol in pipeline/symbols.json:
  1. parse the raw provider file (JSON / CSV data only, never executed)
  2. convert timestamps to New York market dates, drop missing / invalid bars (logged)
  3. validate (ordering, duplicates, positive finite prices, calendar, outlier moves)
  4. cross-check against an independent source where one exists (FRED SP500 / VIXCLS)
  5. write public/data/verified/series/<SYMBOL>.json with provenance + checksums
  6. write public/data/verified/manifest.json

Output is git-ignored because vendor data may not be republished in a public repository.
"""
from __future__ import annotations

import json
import os
import shutil
import sys

from common import (
    PUBLIC_DATA,
    RAW_DIR,
    SCHEMA_VERSION,
    parse_fred_csv,
    parse_yahoo_chart,
    cross_check,
    reconcile,
    load_symbols,
    rows_window,
    series_filename,
    utc_now_iso,
    validate_rows,
    write_json,
)

OUT = PUBLIC_DATA / "verified"
TOLERANCE = {"^GSPC": 0.05, "^VIX": 0.5}  # percent
LICENSE_NOTE = (
    "Downloaded from Yahoo Finance for private, personal research. Yahoo's terms restrict "
    "redistribution; index data is (c) S&P Dow Jones Indices / Cboe. Obtain a data licence "
    "before publishing these values publicly."
)
PRICE_NOTES = {
    "index": "Index level at the official close. Price index: excludes dividends. Not directly tradable.",
    "volatility_index": "VIX index level at close. Not tradable; VIX futures/ETPs behave differently.",
    "etf": "close = split-adjusted close; adjClose = split- and dividend-adjusted (total-return proxy). Returns use adjClose.",
    "stock": "close = split-adjusted close; adjClose = split- and dividend-adjusted. Returns use adjClose.",
}


def main() -> int:
    log_path = RAW_DIR / "fetch_log.json"
    fetch_log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else {"files": {}, "failures": {}}
    start_year = int(os.environ.get("WOI_SPX_START_YEAR", "1950"))
    if OUT.exists():
        shutil.rmtree(OUT)
    manifest_series, warnings, errors, cross = [], [], [], {}
    for s in load_symbols():
        sym = s["symbol"]
        raw = RAW_DIR / "yahoo" / series_filename(sym)
        if not raw.exists():
            msg = f"{sym}: no raw download found (run fetch_data.py)"
            (errors if s["role"].startswith("core") else warnings).append(msg)
            continue
        try:
            parsed = parse_yahoo_chart(json.loads(raw.read_text(encoding="utf-8")))
        except ValueError as e:
            errors.append(f"{sym}: {e}")
            continue
        rows = parsed.rows
        if sym == "^GSPC":
            rows = rows_window(rows, f"{start_year}-01-01")
        if parsed.meta.get("symbol") and parsed.meta["symbol"] != sym:
            errors.append(f"{sym}: provider returned symbol {parsed.meta['symbol']!r}")
            continue
        v = validate_rows(rows, sym, max_daily_move=0.25 if s["assetClass"] != "volatility_index" else 1.5)
        if not v.ok:
            errors.extend(f"{sym}: {e}" for e in v.errors[:10])
            continue
        warnings.extend(f"{sym}: {w}" for w in v.warnings[:10])
        if parsed.dropped:
            warnings.append(f"{sym}: dropped {len(parsed.dropped)} provider bars (e.g. {parsed.dropped[0]})")

        verification = {"level": "single_source", "detail": "Single provider (Yahoo Finance). Not independently cross-checked.", "crossCheck": None}
        fred_id = s.get("fredCrossCheck")
        fred_file = RAW_DIR / "fred" / f"{fred_id}.csv" if fred_id else None
        if fred_file and fred_file.exists():
            fred = parse_fred_csv(fred_file.read_text(encoding="utf-8"))
            cc = cross_check(rows, fred.rows, TOLERANCE.get(sym, 0.1))
            cc["secondarySource"] = f"FRED {fred_id}"
            cc["secondaryUrl"] = f"https://fred.stlouisfed.org/series/{fred_id}"
            cross[sym] = cc
            if cc["passed"]:
                rows, corrections = reconcile(rows, fred.rows, cc["tolerancePct"], f"FRED {fred_id}")
                cc["corrections"] = corrections
                fixed = f" {len(corrections)} date(s) outside tolerance were replaced with the FRED value (logged)." if corrections else ""
                verification = {
                    "level": "cross_checked",
                    "detail": f"Closes agree with FRED {fred_id} on {cc['overlapDates'] - len(corrections)} of {cc['overlapDates']} overlapping dates (tolerance {cc['tolerancePct']}%).{fixed}",
                    "crossCheck": cc,
                }
                if corrections:
                    warnings.append(f"{sym}: {len(corrections)} close(s) replaced with FRED {fred_id} official values: " + ", ".join(c['date'] for c in corrections))
            else:
                verification = {"level": "cross_check_failed", "detail": f"{cc['breaches']} dates differ from FRED {fred_id} by more than {cc['tolerancePct']}%.", "crossCheck": cc}
                warnings.append(f"{sym}: cross-check against FRED {fred_id} FAILED ({cc['breaches']} breaches)")

        fetched = fetch_log.get("files", {}).get(f"yahoo:{sym}", {})
        doc = {
            "schemaVersion": SCHEMA_VERSION,
            "symbol": sym,
            "name": s["name"],
            "assetClass": s["assetClass"],
            "tradable": s["assetClass"] in ("etf", "stock"),
            "currency": parsed.meta.get("currency") or "USD",
            "fields": ["date", "close", "adjClose"],
            "priceNotes": PRICE_NOTES[s["assetClass"]],
            "source": {
                "provider": "Yahoo Finance (chart API, daily bars)",
                "url": f"https://finance.yahoo.com/quote/{sym.replace('^', '%5E')}/history/",
                "retrievedAt": fetched.get("retrievedAt") or utc_now_iso(),
                "license": LICENSE_NOTE,
                "method": "pipeline/fetch_data.py + pipeline/build_dataset.py",
                "marketTimezone": parsed.meta.get("exchangeTimezoneName"),
            },
            "verification": verification,
            "rows": rows,
        }
        fname = series_filename(sym)
        digest = write_json(OUT / "series" / fname, doc)
        manifest_series.append({
            "symbol": sym, "name": s["name"], "role": s["role"], "assetClass": s["assetClass"],
            "file": f"series/{fname}", "rows": len(rows), "firstDate": rows[0][0], "lastDate": rows[-1][0],
            "sha256": digest, "verificationLevel": verification["level"],
        })
        print(f"{sym:7s} {len(rows):6d} rows {rows[0][0]} -> {rows[-1][0]}  [{verification['level']}]")

    core = {m["role"]: m for m in manifest_series if m["role"].startswith("core")}
    if "core_index" not in core or "core_vol" not in core:
        print("\nERROR: core S&P 500 and VIX series are required. Dataset NOT written; the app will keep using demo data.")
        for e in errors:
            print("  -", e)
        if OUT.exists():
            shutil.rmtree(OUT)
        return 1
    all_checked = all(core[r]["verificationLevel"] == "cross_checked" for r in ("core_index", "core_vol"))
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "datasetKind": "verified",
        "label": "Source-backed end-of-day data" + (" (core series cross-checked)" if all_checked else " (cross-check incomplete)"),
        "builtAt": utc_now_iso(),
        "lastMarketDate": core["core_index"]["lastDate"],
        "isLive": False,
        "core": {"index": core["core_index"]["symbol"], "vol": core["core_vol"]["symbol"]},
        "series": manifest_series,
        "validation": {"errors": errors, "warnings": warnings, "fetchFailures": fetch_log.get("failures", {})},
        "crossChecks": cross,
        "notes": [
            "End-of-day data. Not live, not intraday.",
            f"S&P 500 history starts {start_year} (earlier Yahoo history includes six-day trading weeks and sparse data).",
            LICENSE_NOTE,
        ],
    }
    write_json(OUT / "manifest.json", manifest)
    print(f"\nWrote {len(manifest_series)} series to public/data/verified/ (last market date {manifest['lastMarketDate']}).")
    if errors:
        print("Errors:", *errors, sep="\n  - ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
