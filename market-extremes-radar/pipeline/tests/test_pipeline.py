"""Unit tests for the offline data pipeline. Run: npm run test:python"""
import json
import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import common  # noqa: E402
from common import (  # noqa: E402
    cross_check,
    is_trading_day,
    market_date_from_epoch,
    nyse_holidays,
    parse_fred_csv,
    parse_yahoo_chart,
    reconcile,
    validate_rows,
)


def epoch(y, m, d, hh, mm):
    return int(datetime(y, m, d, hh, mm, tzinfo=timezone.utc).timestamp())


def yahoo_payload(ts, closes, adj=None, symbol="^GSPC"):
    p = {"chart": {"result": [{"meta": {"symbol": symbol, "currency": "USD", "exchangeTimezoneName": "America/New_York"},
                                "timestamp": ts, "indicators": {"quote": [{"close": closes}]}}]}}
    if adj is not None:
        p["chart"]["result"][0]["indicators"]["adjclose"] = [{"adjclose": adj}]
    return p


class MarketDateAlignment(unittest.TestCase):
    def test_winter_open_timestamp_maps_to_same_ny_date(self):
        # 2026-11-20 09:30 EST == 14:30 UTC
        self.assertEqual(market_date_from_epoch(epoch(2026, 11, 20, 14, 30)), "2026-11-20")

    def test_summer_open_timestamp_maps_to_same_ny_date(self):
        # 2026-07-15 09:30 EDT == 13:30 UTC
        self.assertEqual(market_date_from_epoch(epoch(2026, 7, 15, 13, 30)), "2026-07-15")

    def test_midnight_exchange_stamp_does_not_shift_to_previous_day(self):
        # Some providers stamp at 00:00 New York == 05:00 UTC (winter)
        self.assertEqual(market_date_from_epoch(epoch(2026, 1, 6, 5, 0)), "2026-01-06")

    def test_late_utc_close_stamp_stays_on_session_date(self):
        # 16:00 EST close == 21:00 UTC; still the same session
        self.assertEqual(market_date_from_epoch(epoch(2026, 11, 20, 21, 0)), "2026-11-20")


class Calendar(unittest.TestCase):
    def test_known_2026_holidays(self):
        h = nyse_holidays(2026)
        for d in ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
                  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]:
            self.assertIn(date.fromisoformat(d), h, d)

    def test_weekend_and_thanksgiving_are_not_trading_days(self):
        self.assertFalse(is_trading_day(date(2026, 11, 21)))
        self.assertFalse(is_trading_day(date(2026, 11, 26)))
        self.assertTrue(is_trading_day(date(2026, 11, 27)))  # early close, still a session

    def test_saturday_new_year_not_observed_on_friday(self):
        self.assertTrue(is_trading_day(date(2021, 12, 31)))


class Parsing(unittest.TestCase):
    def test_yahoo_parse_drops_missing_and_nonpositive_closes(self):
        ts = [epoch(2026, 11, 16, 14, 30), epoch(2026, 11, 17, 14, 30), epoch(2026, 11, 18, 14, 30), epoch(2026, 11, 19, 14, 30)]
        r = parse_yahoo_chart(yahoo_payload(ts, [100.0, None, -1, 101.5]))
        self.assertEqual([x[0] for x in r.rows], ["2026-11-16", "2026-11-19"])
        self.assertEqual(len(r.dropped), 2)

    def test_yahoo_parse_uses_adjclose_when_present(self):
        ts = [epoch(2026, 11, 16, 14, 30), epoch(2026, 11, 17, 14, 30)]
        r = parse_yahoo_chart(yahoo_payload(ts, [100.0, 102.0], adj=[98.0, 100.0], symbol="SPY"))
        self.assertEqual(r.rows[1], ["2026-11-17", 102.0, 100.0])

    def test_yahoo_parse_rejects_malformed_payload(self):
        with self.assertRaises(ValueError):
            parse_yahoo_chart({"chart": {"result": None}})

    def test_yahoo_parse_rejects_length_mismatch(self):
        with self.assertRaises(ValueError):
            parse_yahoo_chart(yahoo_payload([epoch(2026, 1, 5, 14, 30)], [1.0, 2.0]))

    def test_yahoo_payload_text_is_data_not_code(self):
        ts = [epoch(2026, 11, 16, 14, 30)]
        p = yahoo_payload(ts, ["__import__('os').system('echo pwned')"])
        r = parse_yahoo_chart(p)
        self.assertEqual(r.rows, [])  # string close rejected, nothing evaluated

    def test_fred_missing_marker(self):
        r = parse_fred_csv("observation_date,VIXCLS\n2026-11-18,20.1\n2026-11-19,.\n2026-11-20,35.89\n")
        self.assertEqual([x[0] for x in r.rows], ["2026-11-18", "2026-11-20"])
        self.assertTrue(any("missing" in d for d in r.dropped))


class Validation(unittest.TestCase):
    def test_duplicate_and_unsorted_dates_are_errors(self):
        v = validate_rows([["2026-11-18", 1, 1], ["2026-11-18", 2, 2]], "SPY")
        self.assertFalse(v.ok)
        v = validate_rows([["2026-11-19", 1, 1], ["2026-11-18", 2, 2]], "SPY")
        self.assertFalse(v.ok)

    def test_nonpositive_price_is_error(self):
        self.assertFalse(validate_rows([["2026-11-18", 1, 1], ["2026-11-19", 0, 0]], "SPY").ok)

    def test_bad_symbol_rejected(self):
        self.assertFalse(validate_rows([["2026-11-18", 1, 1], ["2026-11-19", 1, 1]], "rm -rf /").ok)

    def test_large_move_is_warning_not_error(self):
        v = validate_rows([["2026-11-18", 100, 100], ["2026-11-19", 50, 50]], "TSLA")
        self.assertTrue(v.ok)
        self.assertTrue(v.warnings)

    def test_future_date_rejected(self):
        self.assertFalse(validate_rows([["2026-11-18", 1, 1], ["2099-01-02", 1, 1]], "SPY").ok)


class CrossCheckAndReconcile(unittest.TestCase):
    def test_cross_check_counts_breaches(self):
        a = [["2026-11-18", 100.0, 100.0], ["2026-11-19", 101.0, 101.0], ["2026-11-20", 90.0, 90.0]]
        b = [["2026-11-18", 100.0, 100.0], ["2026-11-19", 101.01, 101.01], ["2026-11-20", 99.0, 99.0]]
        cc = cross_check(a, b, 0.05)
        self.assertEqual(cc["overlapDates"], 3)
        self.assertEqual(cc["breaches"], 1)
        self.assertEqual(cc["worst"][0]["date"], "2026-11-20")

    def test_reconcile_replaces_only_breaches_and_logs(self):
        a = [["2026-11-18", 100.0, 100.0], ["2026-11-20", 90.0, 90.0]]
        b = [["2026-11-18", 100.01, 100.01], ["2026-11-20", 99.0, 99.0]]
        rows, corr = reconcile(a, b, 0.05, "FRED TEST")
        self.assertEqual(rows[0][1], 100.0)
        self.assertEqual(rows[1][1], 99.0)
        self.assertEqual(corr[0]["replaced"], 90.0)
        self.assertEqual(corr[0]["source"], "FRED TEST")


class DemoDataset(unittest.TestCase):
    def test_committed_demo_is_labelled_synthetic(self):
        m = json.loads((common.PUBLIC_DATA / "demo" / "manifest.json").read_text())
        self.assertEqual(m["datasetKind"], "demo")
        self.assertFalse(m["isLive"])
        self.assertTrue(all(s["verificationLevel"] == "synthetic" for s in m["series"]))
        for s in m["series"]:
            doc = json.loads((common.PUBLIC_DATA / "demo" / s["file"]).read_text())
            self.assertEqual(doc["verification"]["level"], "synthetic")
            self.assertIn("synthetic", doc["name"].lower())
            v = validate_rows(doc["rows"], doc["symbol"], max_daily_move=1.5)
            self.assertTrue(v.ok, v.errors[:3])


if __name__ == "__main__":
    unittest.main()
