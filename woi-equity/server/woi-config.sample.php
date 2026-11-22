<?php
/**
 * WOI Equity server secrets.
 *
 * Copy this file to the folder ABOVE public_html on Hostinger and name it
 * woi-config.php, e.g.  domains/woiequity.com/woi-config.php
 * Never put it inside public_html, and never commit the real file to GitHub.
 */
return [
    // Long random secret shared only with the automation job (GitHub secret
    // WOI_INGEST_TOKEN). 32+ characters. Generate one in START_HERE.md, step 6.
    'ingest_token' => 'REPLACE_WITH_A_LONG_RANDOM_TOKEN',

    // Where ingested snapshots are stored. Default: woi-storage next to this file.
    // 'storage_dir' => __DIR__ . '/woi-storage',
];
