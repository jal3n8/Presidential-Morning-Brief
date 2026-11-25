# WOI Research Desk

Private, single-user company-research journal for WOI Equity drafting (Claude artifact).

Published artifact: https://claude.ai/artifact/JWu5BK16zpxwM4Lwcb1VbY (private, Only you)

- `src/lib.js` — domain logic: entities, civil dates (America/Phoenix "today"), content/thesis hashing and
  stale-analysis invalidation, AI prompts (JSON-encoded untrusted data) and strict validators, revision diff,
  Markdown publishing packet, validated import, per-key save queue.
- `src/store.js` — StorageAdapter over the artifact `db` capability (private `data/users/<id>/` only).
- `src/App.jsx`, `src/template.html` — UI in the locked Tactile Console palette; system fonts only.
- `woi-research-desk.html` — built single file.

Tests use only "Example Company (fictional placeholder)" in throwaway mocked storage.

```
npm install && npm run build && npm test
PW_PATH=$(node -e "console.log(require.resolve('playwright'))") node test/ui-smoke.mjs /tmp
```
