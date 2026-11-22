<?php
/**
 * Snapshot store: archive-first writes, atomic replace, forward-only latest
 * pointer, idempotent ids, revisions kept on replace, admin rollback.
 *
 * woi-storage/
 *   latest.json            what subscribers see
 *   status.json            update log (last 50 runs)
 *   archive/index.json     list of archived snapshots
 *   archive/<id>.json      immutable copies
 *   archive/revisions/     superseded copies (replace and rollback)
 *   private/               audit log, error log, rate limits, key cache
 *
 * Until something is published, reads fall back to the bundled seed
 * (_lib/seed/latest.json = the verified Nov 20, 2026 baseline).
 */

declare(strict_types=1);

function woi_seed_path(): string
{
    return __DIR__ . '/seed/latest.json';
}

function woi_read_json(string $path): mixed
{
    if (!is_file($path)) return null;
    $raw = file_get_contents($path);
    if ($raw === false) return null;
    try {
        return json_decode($raw, true, WOI_JSON_DEPTH, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        return null;
    }
}

function woi_write_atomic(string $path, string $contents): void
{
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) throw new RuntimeException('Cannot create storage folder');
    $tmp = $dir . '/.' . basename($path) . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (file_put_contents($tmp, $contents, LOCK_EX) === false) throw new RuntimeException('Cannot write temp file');
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException('Cannot replace file');
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
    return (bool)preg_match('/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}$/', $id) && !str_contains($id, '..');
}

function woi_snapshot_id(array $s): string
{
    $m = $s['snapshot'];
    if (isset($m['snapshotId']) && is_string($m['snapshotId']) && woi_valid_id($m['snapshotId'])) return $m['snapshotId'];
    if ($m['equitySession'] === 'regular_close') return $m['equityTradingDate'];
    $day = isset($m['openingSessionDate']) && is_string($m['openingSessionDate']) ? $m['openingSessionDate'] : $m['equityTradingDate'];
    return $day . '_' . $m['equitySession'];
}

/** Chronological comparison; identical to src/lib/snapshotOrder.ts. */
function woi_compare(array $a, array $b): int
{
    return [$a['d'], WOI_SESSION_ORDER[$a['s']] ?? 9, $a['r'], $a['u'] ?? ''] <=> [$b['d'], WOI_SESSION_ORDER[$b['s']] ?? 9, $b['r'], $b['u'] ?? ''];
}
function woi_key_snapshot(array $s): array
{
    return ['d' => $s['snapshot']['equityTradingDate'], 's' => $s['snapshot']['equitySession'], 'r' => $s['snapshot']['reportDate'], 'u' => $s['snapshot']['lastSuccessfulAutomatedRunUtc'] ?? null];
}
function woi_key_entry(array $e): array
{
    return ['d' => $e['equityTradingDate'], 's' => $e['equitySession'], 'r' => $e['reportDate'], 'u' => $e['archivedAtUtc'] ?? null];
}

function woi_entry(array $s, string $id, string $now, string $hash): array
{
    return [
        'id' => $id, 'path' => "archive/$id.json",
        'equityTradingDate' => $s['snapshot']['equityTradingDate'], 'equitySession' => $s['snapshot']['equitySession'],
        'reportDate' => $s['snapshot']['reportDate'], 'quality' => $s['snapshot']['quality'],
        'archivedAtUtc' => $now, 'sha256' => $hash,
    ];
}

/** Latest snapshot file: live store first, bundled seed otherwise. */
function woi_latest_file(): array
{
    $live = woi_storage('latest.json');
    if (is_file($live)) return [$live, 'live'];
    return [woi_seed_path(), 'seed'];
}

function woi_manifest(): array
{
    $m = woi_read_json(woi_storage('archive/index.json'));
    if (is_array($m) && ($m['schemaVersion'] ?? null) === 1) return $m;
    $seed = woi_read_json(woi_seed_path());
    return ['schemaVersion' => 1, 'updatedAtUtc' => null, 'snapshots' => is_array($seed) ? [array_merge(woi_entry($seed, woi_snapshot_id($seed), '', ''), ['archivedAtUtc' => null, 'sha256' => null])] : []];
}

function woi_archive_file(string $id): ?string
{
    if (!woi_valid_id($id)) return null;
    $f = woi_storage("archive/$id.json");
    if (is_file($f)) return $f;
    $seed = woi_read_json(woi_seed_path());
    return is_array($seed) && woi_snapshot_id($seed) === $id ? woi_seed_path() : null;
}

function woi_with_lock(callable $fn): mixed
{
    $dir = woi_storage();
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) throw new RuntimeException('Storage folder cannot be created');
    $lock = fopen($dir . '/.write.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) throw new RuntimeException('Could not lock storage');
    try {
        return $fn();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/**
 * Publish a validated snapshot. Returns [httpStatus, responseBody].
 * Order: archive copy -> index -> latest (only if not older).
 */
function woi_publish(array $snap, bool $replace, array $actor, string $job): array
{
    $id = woi_snapshot_id($snap);
    if (!woi_valid_id($id)) return [422, ['ok' => false, 'error' => 'Snapshot id not allowed']];
    $hash = hash('sha256', woi_canonical($snap));

    return woi_with_lock(function () use ($snap, $replace, $actor, $job, $id, $hash) {
        $manifest = woi_read_json(woi_storage('archive/index.json'));
        if (!is_array($manifest) || ($manifest['schemaVersion'] ?? null) !== 1) $manifest = ['schemaVersion' => 1, 'updatedAtUtc' => null, 'snapshots' => []];
        $existing = null;
        foreach ($manifest['snapshots'] as $e) if (($e['id'] ?? null) === $id) $existing = $e;

        if ($existing !== null && ($existing['sha256'] ?? null) === $hash) {
            woi_record_run($job, 'skipped', 'Duplicate of an archived snapshot', $id, $actor);
            woi_audit('snapshot.publish', $actor, 'duplicate', ['id' => $id, 'sha256' => $hash]);
            return [200, ['ok' => true, 'action' => 'duplicate', 'id' => $id, 'latestUpdated' => false]];
        }
        if ($existing !== null && !$replace) {
            woi_record_run($job, 'failed', "Snapshot $id already exists with different content", $id, $actor);
            woi_audit('snapshot.publish', $actor, 'conflict', ['id' => $id, 'sha256' => $hash]);
            return [409, ['ok' => false, 'error' => "Snapshot \"$id\" already exists with different content. Use replace to supersede it; the old copy is kept.", 'id' => $id]];
        }

        $now = woi_now();
        $file = woi_storage("archive/$id.json");
        if ($existing !== null && is_file($file)) woi_keep_revision($file, $id);
        woi_write_atomic($file, woi_encode($snap));                                     // 1. archive first

        $entries = array_values(array_filter($manifest['snapshots'], fn($e) => ($e['id'] ?? null) !== $id));
        $entries[] = woi_entry($snap, $id, $now, $hash);
        usort($entries, fn($a, $b) => woi_compare(woi_key_entry($a), woi_key_entry($b)));
        woi_write_atomic(woi_storage('archive/index.json'), woi_encode(['schemaVersion' => 1, 'updatedAtUtc' => $now, 'snapshots' => $entries])); // 2. index

        $latest = woi_read_json(woi_storage('latest.json'));
        $update = !is_array($latest) || !isset($latest['snapshot']) || woi_compare(woi_key_snapshot($snap), woi_key_snapshot($latest)) >= 0;
        if ($update) woi_write_atomic(woi_storage('latest.json'), woi_encode($snap));       // 3. latest, forward only

        woi_record_run($job, 'success', $update ? null : 'Archived as history; older than the current latest', $id, $actor);
        woi_audit('snapshot.publish', $actor, $existing ? 'replaced' : 'added', ['id' => $id, 'sha256' => $hash, 'latestUpdated' => $update]);
        return [201, ['ok' => true, 'action' => $existing ? 'replaced' : 'added', 'id' => $id, 'latestUpdated' => $update]];
    });
}

function woi_keep_revision(string $file, string $id): void
{
    $dir = woi_storage('archive/revisions');
    if (!is_dir($dir)) mkdir($dir, 0750, true);
    copy($file, $dir . "/$id." . gmdate('Ymd\THis\Z') . '.' . bin2hex(random_bytes(3)) . '.json');
}

/** Admin rollback: point latest at an archived snapshot (may be older). The replaced latest is kept. */
function woi_rollback(string $id, array $actor): array
{
    $src = woi_archive_file($id);
    if ($src === null) return [404, ['ok' => false, 'error' => 'No archived snapshot with that id']];
    $snap = woi_read_json($src);
    $obj = json_decode((string)file_get_contents($src));
    if (!is_array($snap) || !($obj instanceof stdClass) || woi_validate_snapshot($snap, $obj)) {
        woi_audit('snapshot.rollback', $actor, 'rejected', ['id' => $id, 'reason' => 'Archived file no longer validates']);
        return [422, ['ok' => false, 'error' => 'That archived snapshot no longer passes validation']];
    }
    return woi_with_lock(function () use ($snap, $id, $actor) {
        $current = woi_storage('latest.json');
        $prev = is_file($current) ? woi_snapshot_id((array)woi_read_json($current)) : 'seed';
        if (is_file($current)) woi_keep_revision($current, 'latest-before-rollback');
        woi_write_atomic($current, woi_encode($snap));
        woi_record_run('admin_rollback', 'success', "Latest set back to $id", $id, $actor);
        woi_audit('snapshot.rollback', $actor, 'success', ['id' => $id, 'previousLatest' => $prev]);
        return [200, ['ok' => true, 'action' => 'rolled_back', 'id' => $id, 'previousLatest' => $prev]];
    });
}

/* ---------------- update log (status.json) ---------------- */

function woi_status(): array
{
    $st = woi_read_json(woi_storage('status.json'));
    if (is_array($st) && ($st['schemaVersion'] ?? null) === 1) return $st;
    return ['schemaVersion' => 1, 'automationEnabled' => false, 'configuredConnections' => ['ingestEndpoint' => !empty(woi_config()['ingest_token_sha256']), 'gemini' => false, 'marketData' => false, 'secEdgar' => false, 'googleDrive' => false, 'googleSheets' => false],
        'lastRun' => null, 'lastSuccessUtc' => null, 'consecutiveFailures' => 0, 'recentRuns' => []];
}

function woi_record_run(string $job, string $result, ?string $reason, ?string $id, array $actor, array $connections = []): void
{
    $st = woi_status();
    foreach ($connections as $k) if (is_string($k) && preg_match('/^[A-Za-z]{2,32}$/', $k)) $st['configuredConnections'][$k] = true;
    if (in_array($job, ['opening_snapshot', 'closing_snapshot'], true)) $st['automationEnabled'] = true;
    $now = woi_now();
    $run = ['job' => $job, 'startedAtUtc' => $now, 'finishedAtUtc' => $now, 'result' => $result, 'reason' => $reason === null ? null : mb_substr($reason, 0, 500), 'snapshotId' => $id,
        'actor' => $actor['role'] === 'automation' ? 'automation' : ($actor['role'] ?? 'unknown'), 'steps' => []];
    $st['lastRun'] = $run;
    if ($result === 'success') { $st['lastSuccessUtc'] = $now; $st['consecutiveFailures'] = 0; }
    if ($result === 'failed') $st['consecutiveFailures'] = (int)$st['consecutiveFailures'] + 1;
    $st['recentRuns'] = array_slice([...$st['recentRuns'], $run], -50);
    woi_write_atomic(woi_storage('status.json'), woi_encode($st));
}

/* ---------------- public projection (homepage) ---------------- */

function woi_public_projection(array $s): array
{
    $keys = [];
    $pick = function (?string $k) use (&$keys) { if ($k !== null) $keys[$k] = true; };
    foreach ($s['washout']['sp500']['dataSources'] as $k) $pick($k);
    $pick($s['washout']['vixSource'] ?? null);
    foreach ($s['marketRegime']['instruments'] as $i) foreach ($i['dataSources'] as $k) $pick($k);
    foreach ($s['watchlist'] as $w) $pick($w['marketDataSource'] ?? null);
    $sources = [];
    foreach (array_keys($keys) as $k) {
        if (!isset($s['sources'][$k])) continue;
        $src = $s['sources'][$k];
        $sources[] = ['key' => (string)$k, 'url' => $src['url'], 'description' => $src['description'], 'retrievedDate' => $src['retrievedDate']];
    }
    return [
        'schemaVersion' => 1,
        'snapshot' => [
            'equityTradingDate' => $s['snapshot']['equityTradingDate'], 'equitySession' => $s['snapshot']['equitySession'],
            'reportDate' => $s['snapshot']['reportDate'], 'isLive' => $s['snapshot']['isLive'],
            'lastSuccessfulAutomatedRunUtc' => $s['snapshot']['lastSuccessfulAutomatedRunUtc'], 'collectionMethod' => $s['snapshot']['collectionMethod'],
        ],
        'sp500Close' => $s['washout']['sp500']['close'],
        'vixClose' => $s['washout']['vixClose'],
        'regimeInstruments' => array_map(fn($i) => ['symbol' => $i['symbol'], 'closeUsd' => $i['closeUsd'], 'sma200Usd' => $i['sma200Usd']], $s['marketRegime']['instruments']),
        'watchlist' => array_map(fn($w) => ['symbol' => $w['symbol'], 'company' => $w['company'], 'regularSessionClose' => $w['regularSessionClose'],
            'oneDayChangePct' => $w['oneDayChangePct'], 'closeDate' => $w['closeDate'], 'focus' => $w['research']['focus']], $s['watchlist']),
        'sources' => $sources,
    ];
}
