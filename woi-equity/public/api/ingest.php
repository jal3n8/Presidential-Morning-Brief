<?php
/**
 * POST /api/ingest.php
 *
 * Accepts one snapshot JSON from the automation job (Gemini + market data).
 *   Authorization: Bearer <ingest_token from woi-config.php>
 *   Content-Type: application/json
 *   X-WOI-Job: opening_snapshot | closing_snapshot | manual   (optional)
 *   X-WOI-Connections: gemini,marketData,...                  (optional)
 *   ?replace=1  to supersede an existing snapshot with the same id
 *
 * Order of operations (fail-safe):
 *   1. authenticate   2. validate   3. take a lock
 *   4. write the archive copy first
 *   5. update the archive index
 *   6. move the latest pointer last, and only forward in time
 * A failure at any step leaves the previous latest.json untouched and is
 * recorded in status.json and private/ingest-log.jsonl.
 */

declare(strict_types=1);
require __DIR__ . '/_lib.php';

$started = woi_now();
$job = preg_match('/^[a-z_]{1,40}$/', $_SERVER['HTTP_X_WOI_JOB'] ?? '') ? $_SERVER['HTTP_X_WOI_JOB'] : 'manual';
$connections = array_filter(array_map('trim', explode(',', (string)($_SERVER['HTTP_X_WOI_CONNECTIONS'] ?? ''))));

function fail(int $code, string $reason, array $extra = [], bool $record = true): never
{
    global $started, $job;
    if ($record) {
        try {
            woi_record_run(['job' => $job, 'startedAtUtc' => $started, 'finishedAtUtc' => woi_now(), 'result' => 'failed', 'reason' => $reason, 'snapshotId' => $extra['id'] ?? null, 'steps' => []]);
        } catch (Throwable) { /* status is best effort */ }
    }
    woi_log(['at' => woi_now(), 'job' => $job, 'result' => 'failed', 'code' => $code, 'reason' => $reason, 'ip' => $_SERVER['REMOTE_ADDR'] ?? null]);
    woi_json($code, ['ok' => false, 'error' => $reason] + $extra);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    woi_json(405, ['ok' => false, 'error' => 'Use POST']);
    exit;
}

$cfg = woi_config();
$token = $cfg['ingest_token'] ?? '';
if (!is_string($token) || strlen($token) < 32) {
    woi_json(503, ['ok' => false, 'error' => 'Ingest is not configured on this server (woi-config.php with a 32+ character ingest_token).']);
    exit;
}

$https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || ($_SERVER['SERVER_PORT'] ?? '') === '443';
if (!$https && empty($cfg['allow_http'])) {
    woi_json(403, ['ok' => false, 'error' => 'HTTPS required']);
    exit;
}

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(\S+)$/', $auth, $m) || !hash_equals($token, $m[1])) {
    usleep(750_000); // slow down guessing
    woi_log(['at' => woi_now(), 'result' => 'unauthorized', 'ip' => $_SERVER['REMOTE_ADDR'] ?? null]);
    woi_json(401, ['ok' => false, 'error' => 'Unauthorized']);
    exit;
}

if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) fail(415, 'Content-Type must be application/json');
$len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($len > WOI_MAX_BODY) fail(413, 'Body larger than 2 MB');
$body = file_get_contents('php://input', false, null, 0, WOI_MAX_BODY + 1);
if ($body === false || strlen($body) > WOI_MAX_BODY) fail(413, 'Body larger than 2 MB');

try {
    $snap = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
} catch (Throwable) {
    fail(400, 'Body is not valid JSON');
}

$v = new WoiValidator();
if (!$v->validate($snap)) fail(422, 'Snapshot failed validation', ['issues' => $v->errors]);

$id = woi_snapshot_id($snap);
if (!woi_valid_id($id)) fail(422, "Derived snapshot id \"$id\" is not allowed");
$hash = hash('sha256', woi_canonical($snap));
$replace = ($_GET['replace'] ?? '') === '1';

$storage = woi_storage();
if (!is_dir($storage) && !mkdir($storage, 0750, true) && !is_dir($storage)) fail(500, 'Storage folder cannot be created', ['id' => $id]);
$lock = fopen($storage . '/.ingest.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX)) fail(500, 'Could not lock storage', ['id' => $id]);

try {
    $manifestPath = woi_storage('archive/index.json');
    $manifest = woi_read_json($manifestPath);
    if (!is_array($manifest) || ($manifest['schemaVersion'] ?? null) !== 1) $manifest = ['schemaVersion' => 1, 'updatedAtUtc' => null, 'snapshots' => []];

    $existing = null;
    foreach ($manifest['snapshots'] as $e) if (($e['id'] ?? null) === $id) $existing = $e;

    if ($existing !== null && ($existing['sha256'] ?? null) === $hash) {
        flock($lock, LOCK_UN);
        woi_record_run(['job' => $job, 'startedAtUtc' => $started, 'finishedAtUtc' => woi_now(), 'result' => 'skipped', 'reason' => 'Duplicate of an archived snapshot', 'snapshotId' => $id, 'steps' => []], $connections);
        woi_json(200, ['ok' => true, 'action' => 'duplicate', 'id' => $id, 'latestUpdated' => false]);
        exit;
    }
    if ($existing !== null && !$replace) {
        flock($lock, LOCK_UN);
        fail(409, "Snapshot \"$id\" already exists with different content. Send ?replace=1 to supersede it (the old file is kept).", ['id' => $id]);
    }

    $now = woi_now();
    $archiveFile = woi_storage("archive/$id.json");
    // 1) archive first (keep any superseded version)
    if ($existing !== null && is_file($archiveFile)) {
        $revDir = woi_storage('archive/revisions');
        if (!is_dir($revDir)) mkdir($revDir, 0750, true);
        copy($archiveFile, $revDir . "/$id." . gmdate('Ymd\THis\Z') . '.json');
    }
    woi_write_atomic($archiveFile, woi_encode($snap));

    // 2) index
    $entry = [
        'id' => $id,
        'path' => "archive/$id.json",
        'equityTradingDate' => $snap['snapshot']['equityTradingDate'],
        'equitySession' => $snap['snapshot']['equitySession'],
        'reportDate' => $snap['snapshot']['reportDate'],
        'quality' => $snap['snapshot']['quality'],
        'archivedAtUtc' => $now,
        'sha256' => $hash,
    ];
    $entries = array_values(array_filter($manifest['snapshots'], fn($e) => ($e['id'] ?? null) !== $id));
    $entries[] = $entry;
    usort($entries, fn($a, $b) => woi_compare(woi_order_key_entry($a), woi_order_key_entry($b)));
    woi_write_atomic($manifestPath, woi_encode(['schemaVersion' => 1, 'updatedAtUtc' => $now, 'snapshots' => $entries]));

    // 3) latest pointer, forward only
    $latestPath = woi_storage('latest.json');
    $latest = woi_read_json($latestPath);
    $updateLatest = !is_array($latest) || !isset($latest['snapshot'])
        || woi_compare(woi_order_key_snapshot($snap), woi_order_key_snapshot($latest)) >= 0;
    if ($updateLatest) woi_write_atomic($latestPath, woi_encode($snap));

    woi_record_run(['job' => $job, 'startedAtUtc' => $started, 'finishedAtUtc' => woi_now(), 'result' => 'success',
        'reason' => $updateLatest ? null : 'Archived as history; it is older than the current latest', 'snapshotId' => $id, 'steps' => []], $connections);
    woi_log(['at' => woi_now(), 'job' => $job, 'result' => 'success', 'id' => $id, 'latestUpdated' => $updateLatest]);
    flock($lock, LOCK_UN);
    woi_json(201, ['ok' => true, 'action' => $existing ? 'replaced' : 'added', 'id' => $id, 'latestUpdated' => $updateLatest]);
} catch (Throwable $e) {
    flock($lock, LOCK_UN);
    fail(500, 'Storage write failed: ' . $e->getMessage(), ['id' => $id]);
}
