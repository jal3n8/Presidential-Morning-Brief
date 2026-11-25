# DNG Global Game Desk

Private, single-user Claude artifact for DubNationGlobal: manual game setup → deterministic global tipoff
board → final review → 1080×1350 time card (PNG/SVG/Screenshot Mode) → X and Instagram/Facebook captions.

Published artifact: https://claude.ai/artifact/WjDfezWGobmA9CBSX6uYyj (private, Only you)

- `src/lib.js` — curated zones/cities, strict civil-date and time validation, Temporal + Intl resolvers
  (gap/ambiguity detection), formatting, templates, caption lint, shared card layout + SVG renderer, strict import.
- `src/store.js` — Personal storage via the artifact `db` capability (private `data/users/<id>/`).
- `src/App.jsx`, `src/template.html` — UI. System fonts only; nothing remote.
- `dng-game-desk.html` — built single file.

Tests use fictional fixtures only (`Example Club`); expected times come from Python zoneinfo (tzdata 2026e).

```
npm install && npm run build && npm test
PW_PATH=$(node -e "console.log(require.resolve('playwright'))") node test/ui-smoke.mjs /tmp
```
