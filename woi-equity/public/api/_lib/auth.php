<?php
/**
 * Authentication and authorization.
 *
 * Users sign in with an established identity provider (Auth0 by default)
 * using Authorization Code + PKCE. The browser sends the provider-issued
 * access token; this file verifies it on EVERY protected request:
 *   - RS256 signature against the provider's published keys (JWKS)
 *   - algorithm pinned to RS256 (no "none", no HS256 key confusion)
 *   - issuer and audience must match configuration exactly
 *   - exp required; exp / nbf / iat checked with 60 s leeway
 * Roles come from the token's permissions claim:
 *   woi:admin -> admin, woi:subscriber -> subscriber, otherwise public.
 * Deny by default: no configuration or no valid token means no access.
 *
 * No passwords are handled here or anywhere in WOI Equity.
 */

declare(strict_types=1);

use Firebase\JWT\JWK;
use Firebase\JWT\JWT;

const WOI_ROLES = ['public' => 0, 'subscriber' => 1, 'admin' => 2];

function woi_auth_config(): ?array
{
    $a = woi_config()['auth'] ?? null;
    if (!is_array($a) || empty($a['issuer']) || empty($a['audience'])) return null;
    if (!preg_match('#^https://[^/\s]+/$#', (string)$a['issuer']) || str_contains((string)$a['issuer'], 'REPLACE')) return null; // e.g. https://tenant.us.auth0.com/
    return $a + [
        'jwks_url' => $a['issuer'] . '.well-known/jwks.json',
        'permissions_claim' => 'permissions',
        'admin_permission' => 'woi:admin',
        'subscriber_permission' => 'woi:subscriber',
    ];
}

/** JWKS, cached on disk. Refreshed every 6 h, or sooner (max once a minute) when a key id is unknown. */
function woi_jwks(array $a, bool $forceRefresh = false): array
{
    if (!empty(woi_config()['jwks_file'])) { // test configuration only
        return json_decode((string)file_get_contents((string)woi_config()['jwks_file']), true) ?: [];
    }
    $cache = woi_storage('private/jwks-cache.json');
    $cached = is_file($cache) ? json_decode((string)file_get_contents($cache), true) : null;
    $age = is_array($cached) ? time() - (int)($cached['fetchedAt'] ?? 0) : PHP_INT_MAX;
    if (is_array($cached) && ($age < 21600) && !($forceRefresh && $age > 60)) return $cached['jwks'];

    $url = (string)$a['jwks_url'];
    if (!str_starts_with($url, 'https://')) throw new RuntimeException('JWKS URL must be https');
    $body = null;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_MAXFILESIZE => 200_000]);
        $body = curl_exec($ch);
        $ok = curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
        curl_close($ch);
        if (!$ok) $body = null;
    } else {
        $body = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 5, 'follow_location' => 0]]));
    }
    $jwks = is_string($body) ? json_decode($body, true) : null;
    if (!is_array($jwks) || !isset($jwks['keys'])) {
        if (is_array($cached)) return $cached['jwks']; // provider briefly unreachable: keep last known keys
        throw new RuntimeException('Could not load signing keys');
    }
    $dir = dirname($cache);
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    @file_put_contents($cache, json_encode(['fetchedAt' => time(), 'jwks' => $jwks]), LOCK_EX);
    return $jwks;
}

/** Only RSA signing keys meant for RS256 are accepted. */
function woi_keyset(array $jwks): array
{
    $keys = array_values(array_filter($jwks['keys'] ?? [], fn($k) => is_array($k)
        && ($k['kty'] ?? '') === 'RSA' && (!isset($k['alg']) || $k['alg'] === 'RS256') && (!isset($k['use']) || $k['use'] === 'sig') && !empty($k['kid'])));
    return JWK::parseKeySet(['keys' => $keys], 'RS256');
}

function woi_bearer(): ?string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '') return null;
    if (!preg_match('/^Bearer ([A-Za-z0-9._~+\/=-]{20,8192})$/', $h, $m)) throw new WoiHttpError(401, 'Invalid authorization header', [], ['WWW-Authenticate' => 'Bearer']);
    return $m[1];
}

/**
 * Who is calling. Returns ['role' => public|subscriber|admin, 'sub' => ?string].
 * No token -> public. A token that fails ANY check -> 401 (never silently public).
 */
function woi_principal(): array
{
    $token = woi_bearer();
    if ($token === null) return ['role' => 'public', 'sub' => null];
    $a = woi_auth_config();
    if ($a === null) throw new WoiHttpError(503, 'Sign-in is not configured on this server');

    // Shape check before any parsing: three base64url parts, RS256 header.
    $parts = explode('.', $token);
    if (count($parts) !== 3) throw new WoiHttpError(401, 'Invalid token', [], ['WWW-Authenticate' => 'Bearer error="invalid_token"']);
    $header = json_decode((string)JWT::urlsafeB64Decode($parts[0]), true);
    if (!is_array($header) || ($header['alg'] ?? '') !== 'RS256' || empty($header['kid'])) throw new WoiHttpError(401, 'Invalid token', [], ['WWW-Authenticate' => 'Bearer error="invalid_token"']);

    JWT::$leeway = 60;
    $payload = null;
    foreach ([false, true] as $refresh) {
        try {
            $keys = woi_keyset(woi_jwks($a, $refresh));
            if (!isset($keys[$header['kid']])) continue;
            $payload = JWT::decode($token, $keys);
            break;
        } catch (Firebase\JWT\ExpiredException) {
            throw new WoiHttpError(401, 'Token expired', [], ['WWW-Authenticate' => 'Bearer error="invalid_token"']);
        } catch (Throwable) {
            throw new WoiHttpError(401, 'Invalid token', [], ['WWW-Authenticate' => 'Bearer error="invalid_token"']);
        }
    }
    if (!$payload) throw new WoiHttpError(401, 'Invalid token', [], ['WWW-Authenticate' => 'Bearer error="invalid_token"']);

    $c = (array)$payload;
    $aud = $c['aud'] ?? null;
    $audOk = is_string($aud) ? hash_equals((string)$a['audience'], $aud) : (is_array($aud) && in_array($a['audience'], $aud, true));
    if (($c['iss'] ?? null) !== $a['issuer'] || !$audOk || !isset($c['exp']) || !is_int($c['exp']) || empty($c['sub']) || !is_string($c['sub'])) {
        throw new WoiHttpError(401, 'Invalid token', [], ['WWW-Authenticate' => 'Bearer error="invalid_token"']);
    }
    $perms = $c[$a['permissions_claim']] ?? [];
    $perms = is_array($perms) ? array_filter($perms, 'is_string') : [];
    $role = in_array($a['admin_permission'], $perms, true) ? 'admin' : (in_array($a['subscriber_permission'], $perms, true) ? 'subscriber' : 'public');
    return ['role' => $role, 'sub' => mb_substr($c['sub'], 0, 200)];
}

/** Require at least `$min` role. Admin includes subscriber. */
function woi_require_role(string $min): array
{
    if (woi_auth_config() === null) throw new WoiHttpError(503, 'Sign-in is not configured on this server'); // deny by default
    $p = woi_principal();
    if ($p['sub'] === null) throw new WoiHttpError(401, 'Sign in required', [], ['WWW-Authenticate' => 'Bearer']);
    if (WOI_ROLES[$p['role']] < WOI_ROLES[$min]) throw new WoiHttpError(403, 'Your account does not have access to this');
    return $p;
}

/** Machine credential for the scheduled automation job. Config stores only its SHA-256. */
function woi_require_ingest_token(): array
{
    $want = (string)(woi_config()['ingest_token_sha256'] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $want)) throw new WoiHttpError(503, 'Automated ingest is not configured on this server');
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    $ok = preg_match('/^Bearer (\S{32,256})$/', $h, $m) === 1 && hash_equals($want, hash('sha256', $m[1]));
    if (!$ok) {
        woi_rate_limit('ingest-auth-failed', 10, 3600); // 10 bad attempts per hour, then 429
        usleep(500_000);
        woi_audit('ingest.auth_failed', ['sub' => 'unknown', 'role' => null], 'denied');
        throw new WoiHttpError(401, 'Unauthorized', [], ['WWW-Authenticate' => 'Bearer']);
    }
    return ['role' => 'automation', 'sub' => 'automation'];
}
