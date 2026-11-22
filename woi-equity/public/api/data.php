<?php
/**
 * GET /api/data.php?file=latest|manifest|status
 * GET /api/data.php?file=archive&id=<snapshot id>
 *
 * Serves the live data store to the dashboard. Read-only. Answers 404 when
 * nothing has been ingested yet; the dashboard then uses the bundled files.
 *
 * Member-only content later: add a session check where marked below. The
 * browser already sends its session cookie with these requests.
 */

declare(strict_types=1);
require __DIR__ . '/_lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    woi_json(405, ['error' => 'Method not allowed']);
    exit;
}

// AUTH HOOK: when subscriber content exists, require a signed-in member here, e.g.
// if (!woi_member_signed_in()) { woi_json(401, ['error' => 'Sign in required']); exit; }

$file = $_GET['file'] ?? '';
$path = match ($file) {
    'latest' => woi_storage('latest.json'),
    'manifest' => woi_storage('archive/index.json'),
    'status' => woi_storage('status.json'),
    'archive' => (function () {
        $id = (string)($_GET['id'] ?? '');
        return woi_valid_id($id) ? woi_storage("archive/$id.json") : null;
    })(),
    default => null,
};

if ($path === null) {
    woi_json(400, ['error' => 'Unknown file']);
    exit;
}
if (!is_file($path)) {
    woi_json(404, ['error' => 'Not published yet']);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
readfile($path);
