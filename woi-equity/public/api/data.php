<?php
/**
 * GET /api/data.php?file=latest|manifest|status
 * GET /api/data.php?file=archive&id=<snapshot id>
 *
 * Full research data. SUBSCRIBER or ADMIN only, verified on every request.
 */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';

woi_require_https();
woi_require_method('GET');
woi_rate_limit('data', 240, 60);
woi_require_role('subscriber');

switch ($_GET['file'] ?? '') {
    case 'latest':
        [$path, $origin] = woi_latest_file();
        if (!is_file($path)) throw new WoiHttpError(404, 'Not published yet');
        woi_send_file($path, ['X-WOI-Origin' => $origin]);
        break;
    case 'manifest':
        woi_json(200, woi_manifest());
        break;
    case 'status':
        woi_json(200, woi_status());
        break;
    case 'archive':
        $id = (string)($_GET['id'] ?? '');
        if (!woi_valid_id($id)) throw new WoiHttpError(400, 'Invalid id');
        $f = woi_archive_file($id);
        if ($f === null) throw new WoiHttpError(404, 'Not found');
        woi_send_file($f);
        break;
    default:
        throw new WoiHttpError(400, 'Unknown file');
}
