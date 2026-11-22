<?php
/**
 * POST /api/admin/rollback.php  {"id": "<archived snapshot id>"}   ADMIN only
 * Points "latest" back at an archived snapshot. The replaced file is kept.
 */
declare(strict_types=1);
require dirname(__DIR__) . '/_lib/bootstrap.php';

woi_require_https();
woi_require_method('POST');
woi_rate_limit('admin-write', 30, 3600);
$actor = woi_require_role('admin');

[$assoc] = woi_read_json_body();
$id = is_array($assoc) && is_string($assoc['id'] ?? null) ? $assoc['id'] : '';
if (!woi_valid_id($id)) throw new WoiHttpError(400, 'Invalid id');
[$code, $body] = woi_rollback($id, $actor);
woi_json($code, $body);
