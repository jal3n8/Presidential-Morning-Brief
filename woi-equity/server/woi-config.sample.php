<?php
/**
 * WOI Equity server settings. Copy to the folder ABOVE public_html on
 * Hostinger as woi-config.php (e.g. domains/woiequity.com/woi-config.php).
 * Never put it in public_html and never commit the real file to GitHub.
 */
return [
    // From `npm run make-secret`. Only the SHA-256 of the automation token is
    // stored here; the token itself lives only in the GitHub secret.
    'ingest_token_sha256' => 'REPLACE_WITH_HASH_FROM_MAKE_SECRET',
    'log_salt'            => 'REPLACE_WITH_SALT_FROM_MAKE_SECRET',

    // Sign-in (Auth0). Leave as-is until Auth0 is set up: the terminal stays locked.
    'auth' => [
        'issuer'   => 'https://REPLACE-WITH-YOUR-AUTH0-DOMAIN/',   // note the final /
        'audience' => 'https://woiequity.com/api',
        // Optional overrides (defaults shown):
        // 'jwks_url' => 'https://REPLACE-WITH-YOUR-AUTH0-DOMAIN/.well-known/jwks.json',
        // 'permissions_claim' => 'permissions',
        // 'admin_permission' => 'woi:admin',
        // 'subscriber_permission' => 'woi:subscriber',
    ],

    // Where live data and logs are stored. Default: woi-storage next to this file.
    // 'storage_dir' => __DIR__ . '/woi-storage',
];
