# Margot's Owner Brief

Private, single-owner Claude artifact for Bawpli: raw brand updates, owner-confirmed objectives,
blockers, conflicts, decisions, weekly review, and copy-ready assignment handoffs.

Published artifact: https://claude.ai/artifact/PRMwrpbceNQaUrkmSM2YUn (private, Only you)

- `src/lib.js` — pure domain logic (dates/Phoenix, sorting, typed refs, staleness, blockers, conflicts,
  decisions, assignments, brief compilation, AI-output validation, import validation, save queue).
- `src/store.js` — Personal storage via the artifact `db` capability under the private `data/users/<id>/` subtree.
- `src/App.jsx` — React UI; `src/template.html` — page shell and styles (system fonts, no remote assets).
- `margots-owner-brief.html` — built single file (React bundled inline).

Capabilities declared: `db`, `user`, `sample` (AI, only on click), `downloads` (.json export). No connectors, no OS permissions.

```
npm install && npm run build && npm test
PW_PATH=$(node -e "console.log(require.resolve('playwright'))") node test/ui-smoke.mjs /tmp
```
