<?php
/**
 * WOI Equity server bootstrap. Every endpoint starts with:
 *     require __DIR__ . '/_lib/bootstrap.php';     (or ../_lib for admin/)
 *
 * Layout on Hostinger:
 *   domains/woiequity.com/
 *     public_html/                  website (deployed from GitHub)
 *       api/*.php                   endpoints
 *       api/_lib/                   this library + vendor/ (web access denied)
 *     woi-config.php                secrets and settings (created by hand)
 *     woi-storage/                  live data, audit log, rate-limit counters
 *
 * Security defaults: errors never reach the client, HTTPS required, every
 * response is JSON with no-store and nosniff, and anything protected is
 * denied unless the configuration and the caller's token both say otherwise.
 */

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

const WOI_MAX_BODY = 2_000_000;
const WOI_JSON_DEPTH = 64;
const WOI_SESSION_ORDER = ['pre_market' => 0, 'opening' => 1, 'intraday' => 2, 'regular_close' => 3];

require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/validate.php';
require __DIR__ . '/store.php';

/** Raised by endpoints to send a controlled error response. */
final class WoiHttpError extends RuntimeException
{
    public function __construct(public readonly int $status, string $publicMessage, public readonly array $extra = [], public readonly array $headers = [])
    {
        parent::__construct($publicMessage);
    }
}

/* ---------------- error handling: nothing internal leaks ---------------- */

function woi_ref(): string
{
    return bin2hex(random_bytes(6));
}

function woi_log_error(string $ref, Throwable $e): void
{
    // Server-side only. Messages never contain tokens: we never put them in exceptions.
    $line = json_encode(['at' => woi_now(), 'ref' => $ref, 'type' => get_class($e), 'message' => mb_substr($e->getMessage(), 0, 500), 'file' => basename($e->getFile()), 'line' => $e->getLine()], JSON_UNESCAPED_SLASHES);
    $dir = woi_storage('private');
    if (@is_dir($dir) || @mkdir($dir, 0750, true)) @file_put_contents($dir . '/error.log', $line . "\n", FILE_APPEND | LOCK_EX);
    else error_log('woi ' . $line);
}

set_exception_handler(function (Throwable $e): void {
    if ($e instanceof WoiHttpError) {
        foreach ($e->headers as $h => $v) header("$h: $v");
        woi_json($e->status, ['ok' => false, 'error' => $e->getMessage()] + $e->extra);
        return;
    }
    $ref = woi_ref();
    woi_log_error($ref, $e);
    woi_json(500, ['ok' => false, 'error' => 'Internal error', 'ref' => $ref]);
});

register_shutdown_function(function (): void {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true) && !headers_sent()) {
        $ref = woi_ref();
        woi_log_error($ref, new ErrorException($err['message'], 0, $err['type'], $err['file'], $err['line']));
        woi_json(500, ['ok' => false, 'error' => 'Internal error', 'ref' => $ref]);
    }
});

/* ---------------- config and storage ---------------- */

function woi_root(): string
{
    return dirname(__DIR__, 3); // public_html/api/_lib -> domains/<site>
}

function woi_config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $file = getenv('WOI_CONFIG_FILE') ?: woi_root() . '/woi-config.php';
    $loaded = is_file($file) ? require $file : [];
    $cfg = is_array($loaded) ? $loaded : [];
    $cfg['storage_dir'] = $cfg['storage_dir'] ?? woi_root() . '/woi-storage';
    return $cfg;
}

function woi_storage(string $rel = ''): string
{
    return rtrim((string)woi_config()['storage_dir'], '/') . ($rel === '' ? '' : '/' . $rel);
}

function woi_now(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

/* ---------------- request / response ---------------- */

function woi_json(int $status, array $body): void
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    }
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_PRESERVE_ZERO_FRACTION);
}

/** Send a stored JSON file as-is (it was validated before it was stored). */
function woi_send_file(string $path, array $extraHeaders = []): void
{
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    foreach ($extraHeaders as $h => $v) header("$h: $v");
    readfile($path);
}

function woi_require_method(string ...$methods): void
{
    $m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($m, $methods, true)) throw new WoiHttpError(405, 'Method not allowed', [], ['Allow' => implode(', ', $methods)]);
}

function woi_require_https(): void
{
    $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['SERVER_PORT'] ?? '') === '443'
        || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    if (!$https && empty(woi_config()['allow_http'])) throw new WoiHttpError(403, 'HTTPS required');
}

/** Read a JSON request body with size and depth limits. Returns [assoc array, stdClass, raw]. */
function woi_read_json_body(): array
{
    if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) throw new WoiHttpError(415, 'Content-Type must be application/json');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > WOI_MAX_BODY) throw new WoiHttpError(413, 'Body larger than 2 MB');
    $raw = file_get_contents('php://input', false, null, 0, WOI_MAX_BODY + 1);
    if ($raw === false || strlen($raw) > WOI_MAX_BODY) throw new WoiHttpError(413, 'Body larger than 2 MB');
    try {
        $assoc = json_decode($raw, true, WOI_JSON_DEPTH, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        $obj = json_decode($raw, false, WOI_JSON_DEPTH, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
    } catch (JsonException) {
        throw new WoiHttpError(400, 'Body is not valid JSON (or nested too deeply)');
    }
    return [$assoc, $obj, $raw];
}

/** Keyed hash of the client address: lets us rate-limit and audit without storing IPs. */
function woi_client_hash(): string
{
    $salt = (string)(woi_config()['log_salt'] ?? woi_config()['ingest_token_sha256'] ?? 'woi');
    return substr(hash_hmac('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), $salt), 0, 16);
}

/* ---------------- rate limiting (fixed window, per client) ---------------- */

function woi_rate_limit(string $bucket, int $limit, int $windowSeconds): void
{
    $dir = woi_storage('private/ratelimit');
    if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) return; // storage not ready: fail open only for counting
    $window = intdiv(time(), $windowSeconds);
    $file = $dir . '/' . hash('sha256', $bucket . '|' . woi_client_hash()) . '.json';
    $fh = @fopen($file, 'c+');
    if ($fh === false) return;
    flock($fh, LOCK_EX);
    $state = json_decode((string)stream_get_contents($fh), true);
    if (!is_array($state) || ($state['w'] ?? null) !== $window) $state = ['w' => $window, 'n' => 0];
    $state['n']++;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($state));
    flock($fh, LOCK_UN);
    fclose($fh);
    if (mt_rand(1, 200) === 1) woi_rate_limit_gc($dir);
    if ($state['n'] > $limit) {
        $retry = ($window + 1) * $windowSeconds - time();
        throw new WoiHttpError(429, 'Too many requests', [], ['Retry-After' => (string)max(1, $retry)]);
    }
}

function woi_rate_limit_gc(string $dir): void
{
    foreach (glob($dir . '/*.json') ?: [] as $f) if (@filemtime($f) < time() - 86400) @unlink($f);
}

/* ---------------- audit log ---------------- */

/**
 * Append-only audit trail of administrative actions and data updates.
 * Records who (token subject for admins, "automation" for the machine
 * token), what, and the outcome. Never tokens, emails or raw IP addresses.
 */
function woi_audit(string $action, array $actor, string $result, array $details = []): void
{
    $entry = [
        'at' => woi_now(),
        'action' => $action,
        'actor' => mb_substr((string)($actor['sub'] ?? 'unknown'), 0, 120),
        'role' => $actor['role'] ?? null,
        'client' => woi_client_hash(),
        'result' => $result,
    ] + array_intersect_key($details, array_flip(['id', 'sha256', 'reason', 'latestUpdated', 'previousLatest']));
    $dir = woi_storage('private');
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    @file_put_contents($dir . '/audit.jsonl', json_encode($entry, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
}

function woi_audit_tail(int $n): array
{
    $file = woi_storage('private/audit.jsonl');
    if (!is_file($file)) return [];
    $lines = array_slice(file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [], -$n);
    return array_values(array_filter(array_map(fn($l) => json_decode($l, true), $lines)));
}
