<?php
/**
 * GET /api/public.php
 * The public market snapshot shown on the homepage: dates, S&P 500, VIX,
 * the three regime instruments and the watchlist closes, with sources.
 * No research, no indicators beyond that. No sign-in required.
 */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';

woi_require_https();
woi_require_method('GET');
woi_rate_limit('public', 120, 60);

[$path] = woi_latest_file();
$s = woi_read_json($path);
if (!is_array($s)) throw new WoiHttpError(404, 'Not published yet');
woi_json(200, woi_public_projection($s));
