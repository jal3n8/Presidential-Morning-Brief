<?php
/**
 * GET /api/me.php  ->  {"role": "public"|"subscriber"|"admin", "subject": ...}
 * Lets the dashboard ask the SERVER what the signed-in user may see.
 * The browser's own reading of the token is only used for layout.
 */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';

woi_require_https();
woi_require_method('GET');
woi_rate_limit('me', 60, 60);
if (woi_auth_config() === null) throw new WoiHttpError(503, 'Sign-in is not configured on this server');
$p = woi_principal();
woi_json(200, ['role' => $p['role'], 'subject' => $p['sub']]);
