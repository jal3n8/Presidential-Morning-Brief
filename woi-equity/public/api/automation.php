<?php
/**
 * GET /api/automation.php    (scheduled automation job only, machine token)
 * Returns the current latest snapshot and the update log, so the job can
 * build the next snapshot without a user account.
 */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';

woi_require_https();
woi_require_method('GET');
woi_rate_limit('automation-read', 60, 3600);
woi_require_ingest_token();

[$path] = woi_latest_file();
woi_json(200, ['latest' => woi_read_json($path), 'status' => woi_status()]);
