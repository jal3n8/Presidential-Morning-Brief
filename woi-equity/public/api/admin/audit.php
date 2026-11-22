<?php
/**
 * GET /api/admin/audit.php?limit=200   ADMIN only
 * Most recent audit entries (publishes, rollbacks, rejected and unauthorized attempts).
 */
declare(strict_types=1);
require dirname(__DIR__) . '/_lib/bootstrap.php';

woi_require_https();
woi_require_method('GET');
woi_rate_limit('admin-read', 120, 60);
woi_require_role('admin');

$limit = max(1, min(1000, (int)($_GET['limit'] ?? 200)));
woi_json(200, ['entries' => woi_audit_tail($limit)]);
