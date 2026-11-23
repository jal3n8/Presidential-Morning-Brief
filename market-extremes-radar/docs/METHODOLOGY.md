# Methodology

Every number in the Radar comes from the rules below. The thresholds live in one file (`src/lib/rules.ts`), and the Data & Method screen reads from that same file, so the published rules and the running code cannot drift apart.

## Conventions

- **Market date:** the New York trading date of the official close (`YYYY-MM-DD`). Provider timestamps are converted to New York time before the date is taken (`pipeline/common.py: market_date_from_epoch`). On screen, dates are formatted with plain string arithmetic, so a viewer in any time zone sees the same date.
- **Timestamps** (dataset built, data retrieved) are always shown in **UTC**.
- **Alignment:** the S&P 500 and VIX are joined on exact market dates. A missing value stays blank and is **never** forward-filled. The number of gaps is shown on the Overview and Data pages.
- **Missing data:** shown as "—" or "unavailable", never as 0 and never estimated. A rule with a missing input returns *unavailable*, not *false*.
- **Prices:** the S&P 500 and VIX are index levels (not tradable; the S&P 500 is a price index, so dividends are excluded). For ETFs and stocks, indicators and returns use the **split- and dividend-adjusted** close, and the "Close" column shows the split-adjusted closing price.

## Indicators (all trailing: day *t* uses data up to and including *t* only)

| Indicator | Formula |
|---|---|
| SMA *n* | mean of the last *n* closes; blank until *n* closes exist |
| RSI(14), Wilder | changes Δ = Cₜ − Cₜ₋₁; first average gain/loss = simple mean of the first 14; then avg = (prev × 13 + today) ÷ 14; RSI = 100 − 100 ÷ (1 + avgGain ÷ avgLoss) (100 if there are no losses, 50 if the series is flat). Restarts after a data gap. |
| 50-day z-score | (C − SMA50) ÷ σ, where σ is the population standard deviation of the same 50 closes |
| 5-session return | Cₜ ÷ Cₜ₋₅ − 1 |
| Month to date | Cₜ ÷ (last close of the previous calendar month) − 1 |
| Drawdown (252) | Cₜ ÷ max(last 252 closes) − 1; blank until 252 closes exist |
| Drawdown (all-time) | Cₜ ÷ max(all closes to date) − 1 |
| VIX percentile | share of all VIX closes from the first available date to *t* that are ≤ VIXₜ (expanding window, no look-ahead) |

The RSI implementation reproduces the published StockCharts worked example (70.46, 66.25, 66.48 …) and the cited reference value of 24.69 for the S&P 500 on 20 Nov 2026 (see RESEARCH_VERIFICATION.md).

## Market condition label

| Input | Extreme flag | Elevated flag |
|---|---|---|
| 50-day z-score | ≤ −2 | ≤ −1 |
| RSI(14) | ≤ 30 | ≤ 40 |
| VIX | ≥ 30 | ≥ 20 |
| 5-session return | ≤ −5% | ≤ −2.5% |
| Drawdown from 252-session high | ≤ −10% | ≤ −5% |

The first rule that matches wins:

1. **Insufficient Data:** more than 2 of the 5 inputs are unavailable.
2. **Extreme Stress:** 3 or more extreme flags.
3. **Recovery Watch:** not extreme today, Extreme Stress on any of the previous 20 sessions, and close ≥ SMA20.
4. **Elevated Stress:** at least 1 extreme flag, or at least 2 elevated flags.
5. **Upside Extension:** z50 ≥ +2 and RSI ≥ 70.
6. **Normal.**

These are descriptions of the current state, not predictions. No probabilities or confidence scores are produced.

## Scanner triggers

| Trigger | Rule |
|---|---|
| Deeply negative 50-day deviation | z50 ≤ −2 |
| Strongly positive 50-day deviation | z50 ≥ +2 |
| RSI oversold / overbought | RSI14 ≤ 30 / ≥ 70 |
| VIX at stress level | VIX ≥ 30 |
| VIX unusually low | VIX percentile ≤ 5% |
| Sharp 5-session decline / rally | 5-session return ≤ −5% / ≥ +5% |
| Oversold combination | z50 ≤ −2 AND RSI ≤ 30 |
| Capitulation combination | z50 ≤ −2 AND RSI ≤ 30 AND VIX ≥ 30 |
| Upside extension combination | z50 ≥ +2 AND RSI ≥ 70 |

An **event** is an onset: the first close on which a rule is true after being false. "Days on" counts how many consecutive sessions it stayed true.

**Validation available?** Each event shows how many *earlier, independent* events of the same rule (clusters separated by 20+ sessions) had a **completed** 20-session outcome **before** the event date. It shows **Yes** at 10 or more, **Limited** at 1–9, and **Not available** at 0. These counts never use information from after the event.

## Historical Analog Lab

- **Selection** uses only trailing indicator values on the signal date.
- **Clusters (de-duplication):** consecutive qualifying sessions form one event. A new event starts only after at least *g* sessions without the condition (*g* = "cluster gap", default 20). The table shows how many qualifying days each event absorbed.
- **Overlap disclosure:** an event is flagged when the next event begins within 60 sessions, because their outcome windows then share days. The count is shown in the summary. Choosing "every qualifying day" shows a warning that the observations are not independent.
- **Entry:** the signal-day close (default) or the next session's close.
- **Forward return** over *h* sessions: C(entry + *h*) ÷ C(entry) − 1, for *h* = 1, 5, 10, 20, 60.
- **Max adverse / favourable movement:** the lowest / highest close over the 60 sessions after entry, relative to the entry close. This is close-to-close because intraday lows are not stored.
- **Pending:** events without enough later data for a horizon are excluded from that horizon's statistics and counted as pending (never as zero).
- **Baseline:** the same statistics over *every* session in the same date range, so a signal can be compared with "any random day".
- Fewer than 10 events triggers an "anecdotal, not statistical" warning.

## Weekly brief rules

- "This week" means the last 5 sessions. Changes compare the latest close with the close 5 sessions earlier, ranked by size relative to a typical scale (RSI ÷ 10, z ÷ 1, VIX ÷ 5, drawdown ÷ 5%).
- New historical matches are trigger onsets in the last 5 sessions, each compared with earlier events of the same trigger.
- A signal **failed** when its realised 20-session return had the opposite sign to the median 20-session return of that trigger's earlier events, as known on the signal date (at least 5 earlier events). Signals from the last 120 sessions are checked.
- Research questions are fixed templates, chosen by the current condition, VIX, trend, failed signals and watchlist laggards.

## Tests that guard these rules

`tests/indicators.test.ts` (SMA, Wilder RSI, z-score), `tests/engine.test.ts` (forward returns, date alignment, missing data, de-duplication, no look-ahead), `tests/csv.test.ts` (import validation), `tests/provenance.test.tsx` (timestamps, provenance, demo labelling), `tests/data.test.ts` (dataset integrity, journal, brief, reference values), and `pipeline/tests/test_pipeline.py` (calendar, market-date conversion, parsing, validation, cross-check).
