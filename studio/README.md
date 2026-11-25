# Research-to-Publish Studio

Private, single-user Claude artifact for turning pasted research into drafts for
WOI Equity, DubNationGlobal and Agent Skills101.

Published artifact: https://claude.ai/artifact/6Qk9LMvuvHSfRTERQ4FiCL (private, Only you)

- `src/lib.js` — pure logic: hashing, sources, staleness, quote checks, hashtag rule, prompt,
  model-output validation, exports, safe import, request fence, monotonic save queue.
- `src/store.js` — Personal storage over the artifact `db` capability, under the viewer's private
  `data/users/<id>/` subtree, written as chunk docs + head doc so a failed write never corrupts the last good copy.
- `src/App.jsx` — React UI. `src/template.html` — page shell and styles (system fonts only).
- `research-to-publish-studio.html` — the built single file (React, ReactDOM and twitter-text bundled inline; no CDN).

Runtime capabilities declared: `db`, `user`, `sample` (Claude generation, real AbortController),
`downloads` (.md/.json), `desktop` with an empty permission manifest (installable, no OS permissions).

```
npm install
npm run build                      # -> dist/research-to-publish-studio.html
npm test                           # unit tests (node:test)
PW_PATH=$(node -e "console.log(require.resolve('playwright'))") node test/ui-smoke.mjs /tmp   # browser checks with a mocked runtime
```
