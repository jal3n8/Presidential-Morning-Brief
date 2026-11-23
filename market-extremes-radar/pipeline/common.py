"""Shared, dependency-free helpers for the WOI Market Extremes Radar data pipeline.

Responsibilities kept here (and unit-tested in pipeline/tests):
  * NYSE trading calendar (rule based)
  * converting provider timestamps to exchange-local market dates
  * parsing Yahoo chart JSON and FRED CSV (parse only - downloaded content is never executed)
  * validating series and cross-checking two independent sources
  * writing series / manifest JSON with provenance and checksums

Only the Python standard library is used so a non-technical owner can run it
without installing packages.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
PUBLIC_DATA = ROOT / "public" / "data"
SCHEMA_VERSION = 1
SYMBOL_RE = re.compile(r"^\^?[A-Z0-9][A-Z0-9.=\-]{0,11}$")

# --------------------------------------------------------------------------------------
# NYSE calendar
# --------------------------------------------------------------------------------------


def _easter(year: int) -> date:
    """Anonymous Gregorian algorithm (Meeus/Jones/Butcher)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d + timedelta(weeks=n - 1)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    while d.weekday() != weekday:
        d -= timedelta(days=1)
    return d


def _observed(d: date) -> date:
    if d.weekday() == 5:  # Saturday -> Friday
        return d - timedelta(days=1)
    if d.weekday() == 6:  # Sunday -> Monday
        return d + timedelta(days=1)
    return d


def nyse_holidays(year: int) -> set[date]:
    """Full-day NYSE holidays from 1990 onward (rule based; one-off closures not included).

    One-off closures (e.g. 2001-09-11..14, 2012-10-29/30, presidential funerals) are not
    modelled; the provider's actual trading dates are always used for real data.
    """
    hol = set()
    ny = date(year, 1, 1)
    if ny.weekday() != 5:  # NYSE does not observe New Year's on the prior Friday
        hol.add(_observed(ny))
    if year >= 1998:
        hol.add(_nth_weekday(year, 1, 0, 3))  # MLK Day
    hol.add(_nth_weekday(year, 2, 0, 3))  # Washington's Birthday
    hol.add(_easter(year) - timedelta(days=2))  # Good Friday
    hol.add(_last_weekday(year, 5, 0))  # Memorial Day
    if year >= 2022:
        hol.add(_observed(date(year, 6, 19)))  # Juneteenth
    hol.add(_observed(date(year, 7, 4)))
    hol.add(_nth_weekday(year, 9, 0, 1))  # Labor Day
    hol.add(_nth_weekday(year, 11, 3, 4))  # Thanksgiving
    hol.add(_observed(date(year, 12, 25)))
    return hol


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in nyse_holidays(d.year)


def trading_days(start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        if is_trading_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


# --------------------------------------------------------------------------------------
# Market-date alignment
# --------------------------------------------------------------------------------------


def market_date_from_epoch(ts: int, tz_name: str = "America/New_York") -> str:
    """Convert a provider epoch timestamp for a DAILY bar into the exchange-local date.

    Yahoo stamps each daily bar at the session open (09:30 New York time = 13:30 or 14:30 UTC).
    Using the UTC calendar date would be correct here but is fragile for other providers that
    stamp bars at 00:00 exchange time (= 04:00/05:00 UTC). We therefore always convert to
    New York time. If the tz database is unavailable (some Windows installs), a fixed UTC-5
    offset gives the same calendar date for any timestamp between 05:00 and 28:59 UTC.
    """
    try:
        from zoneinfo import ZoneInfo

        return datetime.fromtimestamp(ts, ZoneInfo(tz_name)).date().isoformat()
    except Exception:  # pragma: no cover - fallback path exercised in tests via monkeypatch
        return (datetime.fromtimestamp(ts, timezone.utc) - timedelta(hours=5)).date().isoformat()


@dataclass
class ParseResult:
    rows: list[list]  # [date, close, adjClose]
    dropped: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)


def _num(x) -> float | None:
    if x is None or isinstance(x, bool):
        return None
    if isinstance(x, (int, float)) and math.isfinite(x):
        return float(x)
    return None


def parse_yahoo_chart(payload: dict) -> ParseResult:
    """Parse a Yahoo v8 chart JSON payload. Pure data parsing; nothing is evaluated."""
    try:
        result = payload["chart"]["result"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError(f"Unexpected Yahoo payload shape: {exc}") from exc
    meta = result.get("meta", {}) or {}
    tz_name = meta.get("exchangeTimezoneName") or "America/New_York"
    ts = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    adj_list = result.get("indicators", {}).get("adjclose") or [{}]
    adj = (adj_list[0] or {}).get("adjclose") or [None] * len(ts)
    if not (len(ts) == len(closes)):
        raise ValueError("Yahoo payload: timestamp/close length mismatch")
    rows, dropped, seen = [], [], set()
    for i, t in enumerate(ts):
        if not isinstance(t, int):
            dropped.append(f"index {i}: non-integer timestamp")
            continue
        d = market_date_from_epoch(t, tz_name)
        c = _num(closes[i])
        a = _num(adj[i]) if i < len(adj) else None
        if c is None or c <= 0:
            dropped.append(f"{d}: missing or non-positive close")
            continue
        if d in seen:
            dropped.append(f"{d}: duplicate bar (kept first)")
            continue
        seen.add(d)
        rows.append([d, round(c, 4), round(a, 4) if a is not None and a > 0 else round(c, 4)])
    rows.sort(key=lambda r: r[0])
    clean_meta = {
        "symbol": meta.get("symbol"),
        "currency": meta.get("currency"),
        "exchangeTimezoneName": tz_name,
        "instrumentType": meta.get("instrumentType"),
        "longName": meta.get("longName") or meta.get("shortName"),
    }
    return ParseResult(rows=rows, dropped=dropped, meta=clean_meta)


def parse_fred_csv(text: str) -> ParseResult:
    """Parse a FRED fredgraph.csv (header: observation_date/DATE, SERIES). '.' = missing."""
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header or len(header) < 2:
        raise ValueError("FRED CSV: missing header")
    rows, dropped = [], []
    for line in reader:
        if len(line) < 2:
            continue
        d, v = line[0].strip(), line[1].strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
            dropped.append(f"bad date {d!r}")
            continue
        if v in ("", "."):
            dropped.append(f"{d}: missing ('.')")
            continue
        try:
            x = float(v)
        except ValueError:
            dropped.append(f"{d}: non-numeric {v!r}")
            continue
        if not math.isfinite(x) or x <= 0:
            dropped.append(f"{d}: non-positive")
            continue
        rows.append([d, x, x])
    rows.sort(key=lambda r: r[0])
    return ParseResult(rows=rows, dropped=dropped, meta={"series": header[1]})


# --------------------------------------------------------------------------------------
# Validation and cross-checking
# --------------------------------------------------------------------------------------


@dataclass
class Validation:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def validate_rows(rows: list[list], symbol: str, max_daily_move: float = 0.25, check_calendar: bool = True) -> Validation:
    v = Validation()
    if not SYMBOL_RE.match(symbol):
        v.errors.append(f"invalid symbol {symbol!r}")
    if len(rows) < 2:
        v.errors.append("fewer than 2 rows")
        return v
    prev_d, prev_c = None, None
    weekend = 0
    for r in rows:
        d, c = r[0], r[1]
        try:
            dd = date.fromisoformat(d)
        except (TypeError, ValueError):
            v.errors.append(f"bad date {d!r}")
            continue
        if prev_d is not None and d <= prev_d:
            v.errors.append(f"dates not strictly increasing at {d} (prev {prev_d})")
        if not isinstance(c, (int, float)) or not math.isfinite(c) or c <= 0:
            v.errors.append(f"{d}: invalid close {c!r}")
        if check_calendar and dd.weekday() >= 5:
            weekend += 1
        if prev_c and isinstance(c, (int, float)) and c > 0:
            move = c / prev_c - 1
            if abs(move) > max_daily_move:
                v.warnings.append(f"{d}: unusually large one-day move {move:+.1%} (check for splits or bad ticks)")
        prev_d, prev_c = d, c
    if weekend:
        v.warnings.append(f"{weekend} weekend-dated rows")
    if rows and date.fromisoformat(rows[-1][0]) > datetime.now(timezone.utc).date() + timedelta(days=1):
        v.errors.append("last date is in the future")
    return v


def cross_check(primary: list[list], secondary: list[list], tolerance_pct: float) -> dict:
    """Compare closes on overlapping dates. Returns summary stats and the worst mismatches."""
    sec = {r[0]: r[1] for r in secondary}
    overlap, diffs = 0, []
    only_primary = 0
    for d, c, *_ in primary:
        s = sec.get(d)
        if s is None:
            only_primary += 1
            continue
        overlap += 1
        diffs.append((abs(c / s - 1) * 100, d, c, s))
    prim_dates = {r[0] for r in primary}
    only_secondary = sum(1 for d in sec if d not in prim_dates and d >= (primary[0][0] if primary else ""))
    diffs.sort(reverse=True)
    breaches = [x for x in diffs if x[0] > tolerance_pct]
    return {
        "overlapDates": overlap,
        "tolerancePct": tolerance_pct,
        "maxAbsDiffPct": round(diffs[0][0], 5) if diffs else None,
        "meanAbsDiffPct": round(sum(x[0] for x in diffs) / len(diffs), 6) if diffs else None,
        "breaches": len(breaches),
        "worst": [{"date": d, "primary": c, "secondary": s, "absDiffPct": round(p, 4)} for p, d, c, s in diffs[:5]],
        "datesOnlyInPrimary": only_primary,
        "datesOnlyInSecondary": only_secondary,
        "passed": overlap > 0 and len(breaches) <= max(1, overlap // 1000),
    }


# --------------------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------------------


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def write_json(path: Path, obj) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    path.write_bytes(data)
    return sha256_bytes(data)


def series_filename(symbol: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", symbol).strip("_").upper() + ".json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_symbols() -> list[dict]:
    cfg = json.loads((ROOT / "pipeline" / "symbols.json").read_text(encoding="utf-8"))
    out = []
    for s in cfg["symbols"]:
        if not SYMBOL_RE.match(s["symbol"]):
            raise ValueError(f"symbols.json: invalid symbol {s['symbol']!r}")
        out.append(s)
    return out


def rows_window(rows: Iterable[list], start: str) -> list[list]:
    return [r for r in rows if r[0] >= start]


def reconcile(primary: list[list], secondary: list[list], tolerance_pct: float, secondary_name: str) -> tuple[list[list], list[dict]]:
    """Resolve disagreements: where both sources have a date and differ by more than the
    tolerance, use the secondary (official-distributor) value and log the correction.

    The secondary source (FRED) republishes the index owner's official close (S&P DJI, Cboe),
    so it is treated as closer to primary evidence than the commercial aggregator.
    """
    sec = {r[0]: r[1] for r in secondary}
    out, corrections = [], []
    for r in primary:
        d, c = r[0], r[1]
        s = sec.get(d)
        if s is not None and abs(c / s - 1) * 100 > tolerance_pct:
            corrections.append({"date": d, "replaced": c, "with": s, "absDiffPct": round(abs(c / s - 1) * 100, 4), "source": secondary_name})
            ratio = r[2] / r[1] if r[1] else 1.0
            out.append([d, s, round(s * ratio, 4)])
        else:
            out.append(list(r))
    return out, corrections
