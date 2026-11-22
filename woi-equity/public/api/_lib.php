<?php
/**
 * WOI Equity server library. Shared by data.php (read) and ingest.php (write).
 *
 * Layout on Hostinger (one level above the website folder, so the web can
 * never serve these files directly):
 *
 *   domains/woiequity.com/
 *     public_html/            <- the website (deployed from GitHub)
 *       api/data.php, api/ingest.php, api/_lib.php
 *     woi-config.php          <- secrets, created by hand once (see docs)
 *     woi-storage/            <- live data written by ingest.php
 *       latest.json, status.json, archive/index.json, archive/<id>.json
 *       private/ingest-log.jsonl
 */

declare(strict_types=1);

const WOI_MAX_BODY = 2_000_000;
const WOI_SESSION_ORDER = ['pre_market' => 0, 'opening' => 1, 'intraday' => 2, 'regular_close' => 3];

function woi_root(): string
{
    // public_html/api -> domains/<site>
    return dirname(__DIR__, 2);
}

function woi_config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $file = getenv('WOI_CONFIG_FILE') ?: woi_root() . '/woi-config.php';
    $loaded = is_file($file) ? require $file : [];
    $cfg = is_array($loaded) ? $loaded : [];
    $cfg['storage_dir'] = $cfg['storage_dir'] ?? (getenv('WOI_STORAGE_DIR') ?: woi_root() . '/woi-storage');
    $cfg['config_found'] = is_file($file);
    return $cfg;
}

function woi_storage(string $rel = ''): string
{
    return rtrim(woi_config()['storage_dir'], '/') . ($rel === '' ? '' : '/' . $rel);
}

function woi_json(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
}

function woi_read_json(string $path): mixed
{
    if (!is_file($path)) return null;
    $raw = file_get_contents($path);
    if ($raw === false) return null;
    try {
        return json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return null;
    }
}

/** Write to a temp file in the same folder, then rename: readers never see half a file. */
function woi_write_atomic(string $path, string $contents): void
{
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException("Cannot create $dir");
    }
    $tmp = $dir . '/.' . basename($path) . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (file_put_contents($tmp, $contents, LOCK_EX) === false) throw new RuntimeException("Cannot write $tmp");
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException("Cannot replace $path");
    }
}

function woi_encode(mixed $v): string
{
    return json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_PRESERVE_ZERO_FRACTION) . "\n";
}

/** Sorted-key JSON so formatting differences don't defeat duplicate detection. */
function woi_canonical(mixed $v): string
{
    if (is_array($v)) {
        if (array_is_list($v)) return '[' . implode(',', array_map('woi_canonical', $v)) . ']';
        ksort($v, SORT_STRING);
        $parts = [];
        foreach ($v as $k => $x) $parts[] = json_encode((string)$k) . ':' . woi_canonical($x);
        return '{' . implode(',', $parts) . '}';
    }
    return json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
}

function woi_valid_id(string $id): bool
{
    return (bool)preg_match('/^[A-Za-z0-9_.-]{1,80}$/', $id) && !str_contains($id, '..');
}

function woi_snapshot_id(array $s): string
{
    $meta = $s['snapshot'];
    if (isset($meta['snapshotId']) && is_string($meta['snapshotId']) && woi_valid_id($meta['snapshotId'])) return $meta['snapshotId'];
    $sess = $meta['equitySession'];
    if ($sess === 'regular_close') return $meta['equityTradingDate'];
    $day = (isset($meta['openingSessionDate']) && is_string($meta['openingSessionDate'])) ? $meta['openingSessionDate'] : $meta['equityTradingDate'];
    return $day . '_' . $sess;
}

/** Chronological comparison, identical to src/lib/snapshotOrder.ts. */
function woi_compare(array $a, array $b): int
{
    $x = [$a['equityTradingDate'], WOI_SESSION_ORDER[$a['equitySession']] ?? 9, $a['reportDate'], $a['runUtc'] ?? ''];
    $y = [$b['equityTradingDate'], WOI_SESSION_ORDER[$b['equitySession']] ?? 9, $b['reportDate'], $b['runUtc'] ?? ''];
    return $x <=> $y;
}

function woi_order_key_snapshot(array $s): array
{
    return [
        'equityTradingDate' => $s['snapshot']['equityTradingDate'],
        'equitySession' => $s['snapshot']['equitySession'],
        'reportDate' => $s['snapshot']['reportDate'],
        'runUtc' => $s['snapshot']['lastSuccessfulAutomatedRunUtc'] ?? null,
    ];
}

function woi_order_key_entry(array $e): array
{
    return [
        'equityTradingDate' => $e['equityTradingDate'],
        'equitySession' => $e['equitySession'],
        'reportDate' => $e['reportDate'],
        'runUtc' => $e['archivedAtUtc'] ?? null,
    ];
}

/* ------------------------------------------------------------------ */
/* Validation. Mirrors the essentials of src/lib/schema.ts so the server
 * never stores a file the dashboard would reject. The pipeline also runs
 * the full TypeScript validator before posting. */

final class WoiValidator
{
    public array $errors = [];

    private function err(string $path, string $msg): void
    {
        if (count($this->errors) < 50) $this->errors[] = ['path' => $path, 'message' => $msg];
    }
    private function isDate(mixed $v): bool
    {
        return is_string($v) && (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $v);
    }
    private function num(array $o, string $k, string $p, bool $nullable = true): void
    {
        if (!array_key_exists($k, $o)) { $this->err("$p.$k", 'missing'); return; }
        $v = $o[$k];
        if ($v === null && $nullable) return;
        if (!is_int($v) && !is_float($v)) $this->err("$p.$k", 'expected a number' . ($nullable ? ' or null' : ''));
        elseif (is_float($v) && !is_finite($v)) $this->err("$p.$k", 'not finite');
    }
    private function str(array $o, string $k, string $p, bool $nullable = false): void
    {
        if (!array_key_exists($k, $o)) { $this->err("$p.$k", 'missing'); return; }
        if ($o[$k] === null && $nullable) return;
        if (!is_string($o[$k])) $this->err("$p.$k", 'expected text');
    }
    private function boolOrNull(array $o, string $k, string $p): void
    {
        if (!array_key_exists($k, $o)) { $this->err("$p.$k", 'missing'); return; }
        if ($o[$k] !== null && !is_bool($o[$k])) $this->err("$p.$k", 'expected true, false or null');
    }
    private function obj(mixed $o, string $p): bool
    {
        if (!is_array($o) || ($o !== [] && array_is_list($o))) { $this->err($p, 'expected an object'); return false; }
        return true;
    }

    public function validate(mixed $s): bool
    {
        if (!$this->obj($s, '(root)')) return false;
        if (!is_string($s['schemaVersion'] ?? null) || !preg_match('/^2\.\d+\.\d+$/', $s['schemaVersion'])) $this->err('schemaVersion', 'must be 2.x.x');
        foreach (['snapshot', 'marketRegime', 'washout', 'club3030', 'macroAndConfirmation', 'validation', 'sources'] as $k) {
            if (!array_key_exists($k, $s)) $this->err($k, 'missing');
        }
        if ($this->errors) return false;

        $m = $s['snapshot'];
        if ($this->obj($m, 'snapshot')) {
            foreach (['reportDate', 'equityTradingDate'] as $k) if (!$this->isDate($m[$k] ?? null)) $this->err("snapshot.$k", 'expected YYYY-MM-DD');
            foreach (['equitySession', 'equityMarketTimezone', 'displayTimezone', 'collectionMethod', 'quality'] as $k) $this->str($m, $k, 'snapshot');
            if (!is_bool($m['isLive'] ?? null)) $this->err('snapshot.isLive', 'expected true or false');
            $this->str($m, 'lastSuccessfulAutomatedRunUtc', 'snapshot', true);
        }

        $r = $s['marketRegime'];
        if ($this->obj($r, 'marketRegime')) {
            if (!is_array($r['instruments'] ?? null) || !array_is_list($r['instruments'])) $this->err('marketRegime.instruments', 'expected a list');
            else foreach ($r['instruments'] as $i => $ins) {
                if (!$this->obj($ins, "marketRegime.instruments.$i")) continue;
                $this->str($ins, 'symbol', "marketRegime.instruments.$i");
                foreach (['closeUsd', 'sma200Usd', 'pctVsSma200'] as $k) $this->num($ins, $k, "marketRegime.instruments.$i");
                if (!is_array($ins['dataSources'] ?? null)) $this->err("marketRegime.instruments.$i.dataSources", 'expected a list');
            }
            $this->boolOrNull($r, 'allBelow200DaySma', 'marketRegime');
            $this->str($r, 'label', 'marketRegime', true);
        }

        $w = $s['washout'];
        if ($this->obj($w, 'washout') && $this->obj($w['sp500'] ?? null, 'washout.sp500')) {
            foreach (['close', 'sma200', 'pctVsSma200', 'rsi14', 'previousHighestDailyClose', 'pctDrawdownFromClosingPeak', 'oneYearAgoClose', 'yearOverYearPriceReturnPct'] as $k) $this->num($w['sp500'], $k, 'washout.sp500');
            foreach (['vixClose', 'fiveDaySigma', 'score'] as $k) $this->num($w, $k, 'washout');
            $this->boolOrNull($w, 'vixRealizedStabilizing', 'washout');
        }

        $c = $s['club3030'];
        if ($this->obj($c, 'club3030')) {
            foreach (['triggered', 'isFridayClose', 'sp500YearOverYearPositive'] as $k) $this->boolOrNull($c, $k, 'club3030');
            $this->str($c, 'status', 'club3030');
            if (!array_key_exists('requiredRuleDefinition', $c)) $this->err('club3030.requiredRuleDefinition', 'missing');
        }

        $mc = $s['macroAndConfirmation'];
        if ($this->obj($mc, 'macroAndConfirmation')) {
            $this->num($mc, 'nominalUsTreasury2YearYieldPct', 'macroAndConfirmation');
            if ($this->obj($mc['nasdaqBreadth'] ?? null, 'macroAndConfirmation.nasdaqBreadth'))
                foreach (['new52WeekHighs', 'new52WeekLows', 'newHighMinusNewLow'] as $k) $this->num($mc['nasdaqBreadth'], $k, 'macroAndConfirmation.nasdaqBreadth');
            if ($this->obj($mc['bitcoin'] ?? null, 'macroAndConfirmation.bitcoin'))
                foreach (['dailyCandleCloseUsd', 'sma100Usd', 'sma200Usd'] as $k) $this->num($mc['bitcoin'], $k, 'macroAndConfirmation.bitcoin');
        }

        if (!is_array($s['watchlist'] ?? null) || !array_is_list($s['watchlist']) || count($s['watchlist']) === 0) $this->err('watchlist', 'expected a non-empty list');
        else foreach ($s['watchlist'] as $i => $x) {
            $p = "watchlist.$i";
            if (!$this->obj($x, $p)) continue;
            foreach (['symbol', 'company', 'currency'] as $k) $this->str($x, $k, $p);
            foreach (['regularSessionClose', 'oneDayChangePct'] as $k) $this->num($x, $k, $p);
            if (!$this->obj($x['technicalIndicators'] ?? null, "$p.technicalIndicators")) continue;
            foreach (['sma50Usd', 'sma200Usd', 'rsi14'] as $k) $this->num($x['technicalIndicators'], $k, "$p.technicalIndicators");
            if (!$this->obj($x['research'] ?? null, "$p.research")) continue;
            foreach (['verifiedCatalysts', 'verifiedFilings', 'unverifiedClaims', 'focus'] as $k)
                if (!is_array($x['research'][$k] ?? null)) $this->err("$p.research.$k", 'expected a list');
        }

        $v = $s['validation'];
        if ($this->obj($v, 'validation')) {
            if (!is_array($v['blockedFromAutomatedTradeSignals'] ?? null)) $this->err('validation.blockedFromAutomatedTradeSignals', 'expected a list');
            if (!is_array($v['warnings'] ?? null)) $this->err('validation.warnings', 'expected a list');
        }

        if ($this->obj($s['sources'], 'sources')) {
            foreach ($s['sources'] as $key => $src) {
                if (!$this->obj($src, "sources.$key")) continue;
                if (!is_string($src['url'] ?? null) || !preg_match('#^https?://#i', $src['url'])) $this->err("sources.$key.url", 'expected an http(s) URL');
                if (!$this->isDate($src['retrievedDate'] ?? null)) $this->err("sources.$key.retrievedDate", 'expected YYYY-MM-DD');
            }
        }
        if ($this->errors) return false;

        // Safety rules: never store a signal whose rule is undefined.
        foreach ($v['blockedFromAutomatedTradeSignals'] as $path) {
            $val = $s;
            foreach (explode('.', (string)$path) as $seg) $val = is_array($val) && array_key_exists($seg, $val) ? $val[$seg] : null;
            if ($val !== null) $this->err((string)$path, 'has a value but is on the blocked-signal list; publish the rule and unblock it first');
        }
        if (($c['triggered'] ?? null) !== null && ($c['requiredRuleDefinition'] ?? null) === null)
            $this->err('club3030.triggered', 'a trigger value needs requiredRuleDefinition');

        return !$this->errors;
    }
}

/* ------------------------------------------------------------------ */
/* Status file */

function woi_status_default(): array
{
    return [
        'schemaVersion' => 1,
        'automationEnabled' => false,
        'configuredConnections' => ['ingestEndpoint' => true, 'gemini' => false, 'marketData' => false, 'secEdgar' => false, 'googleDrive' => false, 'googleSheets' => false],
        'lastRun' => null,
        'lastSuccessUtc' => null,
        'consecutiveFailures' => 0,
        'recentRuns' => [],
    ];
}

function woi_record_run(array $run, array $connections = []): void
{
    $path = woi_storage('status.json');
    $st = woi_read_json($path);
    if (!is_array($st) || ($st['schemaVersion'] ?? null) !== 1) $st = woi_status_default();
    $st['configuredConnections']['ingestEndpoint'] = true;
    foreach ($connections as $k) {
        if (preg_match('/^[A-Za-z]{2,32}$/', $k)) $st['configuredConnections'][$k] = true;
    }
    if (in_array($run['job'], ['opening_snapshot', 'closing_snapshot'], true)) $st['automationEnabled'] = true;
    $st['lastRun'] = $run;
    if ($run['result'] === 'success') {
        $st['lastSuccessUtc'] = $run['finishedAtUtc'];
        $st['consecutiveFailures'] = 0;
    } elseif ($run['result'] === 'failed') {
        $st['consecutiveFailures'] = (int)$st['consecutiveFailures'] + 1;
    }
    $st['recentRuns'][] = $run;
    $st['recentRuns'] = array_slice($st['recentRuns'], -50);
    woi_write_atomic($path, woi_encode($st));
}

function woi_log(array $entry): void
{
    $dir = woi_storage('private');
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    @file_put_contents($dir . '/ingest-log.jsonl', json_encode($entry, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
}

function woi_now(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}
