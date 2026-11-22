<?php
/**
 * POST /api/admin/publish.php[?replace=1]   ADMIN only
 * Publishes a snapshot JSON uploaded from the dashboard's Import page.
 * Same validation and write order as automated ingest; every attempt is audited.
 */
declare(strict_types=1);
require dirname(__DIR__) . '/_lib/bootstrap.php';

woi_require_https();
woi_require_method('POST');
woi_rate_limit('admin-write', 30, 3600);
$actor = woi_require_role('admin');

[$assoc, $obj] = woi_read_json_body();
if (!is_array($assoc) || !($obj instanceof stdClass)) throw new WoiHttpError(422, 'Body must be a JSON object');
$issues = woi_validate_snapshot($assoc, $obj);
if ($issues) {
    woi_audit('snapshot.publish', $actor, 'rejected', ['reason' => 'validation']);
    throw new WoiHttpError(422, 'Snapshot failed validation', ['issues' => $issues]);
}
[$code, $body] = woi_publish($assoc, ($_GET['replace'] ?? '') === '1', $actor, 'admin_upload');
woi_json($code, $body);
