<?php
/**
 * Server-side snapshot validation.
 *
 * 1. Strict JSON Schema (snapshot.schema.json, exported from the TypeScript
 *    Zod schema by scripts/export-schema.ts): unknown keys rejected, sizes
 *    capped, links limited to http(s).
 * 2. Safety rules that a schema cannot express: no value in a blocked
 *    signal field, no Club 30/30 trigger without a written rule, a bounded
 *    number of sources.
 */

declare(strict_types=1);

use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;

/** @return array<int, array{path: string, message: string}> empty when valid */
function woi_forbidden_key(mixed $v, string $path = '', int $depth = 0): ?string
{
    if ($depth > 64) return $path ?: '(root)';
    if (!is_array($v)) return null;
    foreach ($v as $k => $x) {
        $p = $path === '' ? (string)$k : "$path.$k";
        if (is_string($k) && in_array($k, ['__proto__', 'constructor', 'prototype'], true)) return $p;
        if (($r = woi_forbidden_key($x, $p, $depth + 1)) !== null) return $r;
    }
    return null;
}

function woi_validate_snapshot(array $assoc, stdClass $obj): array
{
    if (($bad = woi_forbidden_key($assoc)) !== null) return [['path' => $bad, 'message' => 'Forbidden key']];
    static $schema = null;
    $schema ??= json_decode((string)file_get_contents(__DIR__ . '/snapshot.schema.json'));
    $v = new Validator();
    $v->setMaxErrors(20);
    $result = $v->validate($obj, $schema);
    if (!$result->isValid()) {
        $out = [];
        foreach ((new ErrorFormatter())->format($result->error(), true) as $path => $messages) {
            foreach ((array)$messages as $m) {
                $out[] = ['path' => ltrim(str_replace('/', '.', (string)$path), '.') ?: '(root)', 'message' => mb_substr((string)$m, 0, 200)];
                if (count($out) >= 20) break 2;
            }
        }
        return $out ?: [['path' => '(root)', 'message' => 'Does not match the snapshot schema']];
    }

    $errors = [];
    if (count((array)($assoc['sources'] ?? [])) > 500) $errors[] = ['path' => 'sources', 'message' => 'More than 500 sources'];
    foreach ($assoc['validation']['blockedFromAutomatedTradeSignals'] as $path) {
        $val = $assoc;
        foreach (explode('.', (string)$path) as $seg) $val = is_array($val) && array_key_exists($seg, $val) ? $val[$seg] : null;
        if ($val !== null) $errors[] = ['path' => (string)$path, 'message' => 'Has a value but is on the blocked-signal list; publish the rule and unblock it first'];
    }
    if (($assoc['club3030']['triggered'] ?? null) !== null && ($assoc['club3030']['requiredRuleDefinition'] ?? null) === null) {
        $errors[] = ['path' => 'club3030.triggered', 'message' => 'A trigger value needs requiredRuleDefinition'];
    }
    return $errors;
}
