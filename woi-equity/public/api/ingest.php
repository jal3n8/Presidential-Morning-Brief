<?php
/**
 * POST /api/ingest.php       (scheduled automation job only)
 *   Authorization: Bearer <machine token; the server stores only its SHA-256>
 *   Content-Type: application/json
 *   X-WOI-Job: opening_snapshot | closing_snapshot
 *   X-WOI-Connections: gemini,marketData   (optional)
 *   ?replace=1 to supersede a snapshot with the same id
 */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';

woi_require_https();
woi_require_method('POST');
woi_rate_limit('ingest', 60, 3600);
$actor = woi_require_ingest_token();

$job = preg_match('/^(opening_snapshot|closing_snapshot|manual)$/', $_SERVER['HTTP_X_WOI_JOB'] ?? '') ? $_SERVER['HTTP_X_WOI_JOB'] : 'manual';
$connections = array_slice(array_filter(array_map('trim', explode(',', (string)($_SERVER['HTTP_X_WOI_CONNECTIONS'] ?? '')))), 0, 10);

try {
    [$assoc, $obj] = woi_read_json_body();
} catch (WoiHttpError $e) {
    woi_record_run($job, 'failed', $e->getMessage(), null, $actor, $connections);
    woi_audit('snapshot.ingest', $actor, 'rejected', ['reason' => $e->getMessage()]);
    throw $e;
}
if (!is_array($assoc) || !($obj instanceof stdClass)) {
    woi_record_run($job, 'failed', 'Body must be a JSON object', null, $actor, $connections);
    throw new WoiHttpError(422, 'Body must be a JSON object');
}
$issues = woi_validate_snapshot($assoc, $obj);
if ($issues) {
    woi_record_run($job, 'failed', 'Snapshot failed validation: ' . $issues[0]['path'] . ' ' . $issues[0]['message'], null, $actor, $connections);
    woi_audit('snapshot.ingest', $actor, 'rejected', ['reason' => 'validation']);
    throw new WoiHttpError(422, 'Snapshot failed validation', ['issues' => $issues]);
}
if ($connections) woi_record_run('connections', 'skipped', null, null, $actor, $connections);
[$code, $body] = woi_publish($assoc, ($_GET['replace'] ?? '') === '1', $actor, $job);
woi_json($code, $body);
