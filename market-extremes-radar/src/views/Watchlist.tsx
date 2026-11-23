import { useMemo, useState } from "react";
import { Badge, Button, Card, inputCls, Notice, SortableTable, VerificationBadge, type Column } from "../components/ui";
import { fmtMarketDate, fmtNum, fmtPct, fmtSigned, provenanceLine } from "../lib/format";
import type { Series } from "../lib/types";
import { DEFAULT_WATCHLIST, normaliseSymbol, RS_BENCHMARK, RS_LOOKBACK, watchRow, type WatchRow } from "../lib/watchlist";
import { useData } from "../state";

const pct = (x: number | null) => <span className={x === null ? "text-muted" : x >= 0 ? "text-gain" : "text-risk"}>{fmtPct(x, 2)}</span>;

function typeBadge(s: Series | null) {
  if (!s) return <Badge>No data</Badge>;
  if (s.assetClass === "index") return <Badge tone="paper" title="Index level: not directly tradable">Index</Badge>;
  if (s.assetClass === "volatility_index") return <Badge tone="paper">Vol index</Badge>;
  if (s.assetClass === "etf") return <Badge tone="gold" title="Exchange-traded fund: tradable">ETF</Badge>;
  return <Badge tone="gold" title="Common stock: tradable">Stock</Badge>;
}

export default function Watchlist() {
  const { dataset, watchlist, setWatchlist } = useData();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ds = dataset!;
  const bench = ds.watchlist[RS_BENCHMARK] ?? null;

  const rows = useMemo(() => watchlist.map((sym) => watchRow(sym, ds.watchlist[sym] ?? null, bench)), [watchlist, ds, bench]);
  const indexRow = useMemo(() => watchRow(ds.index.symbol, ds.index, null), [ds]);

  const add = () => {
    const s = normaliseSymbol(input);
    if (!s) return setError("Use a ticker such as AAPL, BRK.B or ^NDX (letters, digits, . = -; max 12).");
    if (watchlist.includes(s)) return setError(`${s} is already on the watchlist.`);
    if (watchlist.length >= 50) return setError("Watchlist is limited to 50 symbols.");
    setWatchlist([...watchlist, s]);
    setInput("");
    setError(null);
  };

  const columns: Column<WatchRow>[] = [
    {
      key: "symbol",
      header: "Symbol",
      value: (r) => r.symbol,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold text-paper">{r.symbol}</span>
          {typeBadge(r.series)}
        </div>
      ),
    },
    { key: "price", header: "Close", value: (r) => r.close, render: (r) => <span className="text-paper">{fmtNum(r.close)}</span>, align: "right" },
    { key: "date", header: "Date", value: (r) => r.lastDate, render: (r) => <span className="text-muted">{r.lastDate ?? "—"}</span> },
    { key: "r1", header: "1d", value: (r) => r.ret1, render: (r) => pct(r.ret1), align: "right" },
    { key: "r5", header: "5d", value: (r) => r.ret5, render: (r) => pct(r.ret5), align: "right" },
    { key: "r21", header: "1m", value: (r) => r.ret21, render: (r) => pct(r.ret21), align: "right" },
    { key: "ytd", header: "YTD", value: (r) => r.ytd, render: (r) => pct(r.ytd), align: "right" },
    { key: "rsi", header: "RSI14", value: (r) => r.rsi14, render: (r) => <span className={r.rsi14 !== null && (r.rsi14 <= 30 || r.rsi14 >= 70) ? "text-gold" : ""}>{fmtNum(r.rsi14, 1)}</span>, align: "right" },
    { key: "v50", header: "vs SMA50", value: (r) => (r.close !== null && r.sma50 !== null ? r.close / r.sma50 - 1 : null), render: (r) => pct(r.close !== null && r.sma50 !== null ? r.close / r.sma50 - 1 : null), align: "right" },
    { key: "v200", header: "vs SMA200", value: (r) => (r.close !== null && r.sma200 !== null ? r.close / r.sma200 - 1 : null), render: (r) => pct(r.close !== null && r.sma200 !== null ? r.close / r.sma200 - 1 : null), align: "right" },
    {
      key: "trend",
      header: "Trend", info: "Uptrend: close > SMA50 > SMA200. Downtrend: close < SMA50 < SMA200. Otherwise Mixed. Uses split- and dividend-adjusted closes.",
      value: (r) => r.trend,
      render: (r) => <span className={r.trend === "Uptrend" ? "text-gain" : r.trend === "Downtrend" ? "text-risk" : "text-muted"}>{r.trend}</span>,
    },
    {
      key: "rs",
      header: `RS vs ${RS_BENCHMARK}`, info: `Relative strength: the symbol's ${RS_LOOKBACK}-session total return minus ${RS_BENCHMARK}'s over the same sessions, in percentage points. Only computed when both end on the same market date.`,
      value: (r) => r.rs63,
      render: (r) => (r.symbol === RS_BENCHMARK ? <span className="text-muted">benchmark</span> : <span className={r.rs63 === null ? "text-muted" : r.rs63 >= 0 ? "text-gain" : "text-risk"}>{r.rs63 === null ? "—" : `${fmtSigned(r.rs63 * 100, 1)} pts`}</span>),
      align: "right",
    },
    { key: "ver", header: "Data", value: (r) => r.series?.verification.level ?? null, render: (r) => (r.series ? <VerificationBadge level={r.series.verification.level} /> : <Badge>None</Badge>) },
    {
      key: "rm",
      header: "",
      value: () => null,
      render: (r) => (
        <button type="button" aria-label={`Remove ${r.symbol}`} className="text-xs text-muted hover:text-risk" onClick={() => setWatchlist(watchlist.filter((s) => s !== r.symbol))}>
          Remove
        </button>
      ),
    },
  ];

  const missing = rows.filter((r) => !r.series);
  const withNotes = rows.filter((r) => r.series && r.notes.length);

  return (
    <div className="space-y-4">
      <Card title="Reference index (not tradable)" subtitle="Index levels are calculations, not prices you can trade. The tradable proxy is an ETF such as SPY.">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <span className="font-semibold text-paper">{ds.index.name}</span>
          <span className="num text-xl text-paper">{fmtNum(indexRow.close)}</span>
          <span className="num">1d {pct(indexRow.ret1)}</span>
          <span className="num">5d {pct(indexRow.ret5)}</span>
          <span className="num">YTD {pct(indexRow.ytd)}</span>
          <span className="num">RSI {fmtNum(indexRow.rsi14, 1)}</span>
          <span className="text-muted">{fmtMarketDate(indexRow.lastDate)}</span>
        </div>
      </Card>

      <Card
        title="WOI Equity watchlist"
        subtitle="Tradable ETFs and stocks. Returns and indicators use split- and dividend-adjusted closes; the Close column is the split-adjusted closing price."
        right={
          <Button variant="ghost" onClick={() => setWatchlist(DEFAULT_WATCHLIST)} title="Restore SPY, QQQ, NVDA, TSLA, GOOGL">
            Reset
          </Button>
        }
      >
        <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input aria-label="Add symbol" className={`${inputCls} max-w-[200px] uppercase`} placeholder="Add symbol, e.g. AAPL" value={input} maxLength={13} onChange={(e) => setInput(e.target.value)} />
          <Button type="submit" variant="primary">Add</Button>
          {error && <span className="self-center text-xs text-risk">{error}</span>}
        </form>
        <SortableTable rows={rows} columns={columns} rowKey={(r) => r.symbol} initialSort={{ key: "symbol", dir: "asc" }} empty="Your watchlist is empty. Add a symbol above." />
        <div className="mt-4 space-y-2">
          {missing.length > 0 && (
            <Notice>
              No validated data for <strong>{missing.map((r) => r.symbol).join(", ")}</strong>. Nothing is shown rather than guessed. To add data: put the symbol in <code className="text-gold">pipeline/symbols.json</code> and run <code className="text-gold">npm run data:update</code>, or import a CSV on the Data &amp; Method page.
            </Notice>
          )}
          {withNotes.map((r) => (
            <p key={r.symbol} className="text-xs text-muted">{r.symbol}: {r.notes.join(" ")}</p>
          ))}
          {rows.filter((r) => r.series).map((r) => (
            <p key={`p-${r.symbol}`} className="text-[11px] text-muted">{r.symbol}: {provenanceLine(r.series!)}</p>
          ))}
        </div>
      </Card>
    </div>
  );
}
