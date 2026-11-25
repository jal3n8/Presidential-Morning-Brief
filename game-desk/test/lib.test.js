// Fictional fixtures only ("Example Club"). Expected instants/wall times come from Python zoneinfo (tzdata 2026e),
// an independent implementation, not from this code.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/lib.js";

const ORACLE = {
  at01: { utc: "2027-02-11T03:00:00.000Z", wall: { "san-francisco": "2027-02-10 19:00", phoenix: "2027-02-10 20:00", manila: "2027-02-11 11:00", tokyo: "2027-02-11 12:00", "sao-paulo": "2027-02-11 00:00", paris: "2027-02-11 04:00", mumbai: "2027-02-11 08:30", london: "2027-02-11 03:00", sydney: "2027-02-11 14:00", toronto: "2027-02-10 22:00", seoul: "2027-02-11 12:00", "mexico-city": "2027-02-10 21:00", auckland: "2027-02-11 16:00" } },
  at11: { utc: "2027-01-01T04:00:00.000Z", wall: { "san-francisco": "2026-12-31 20:00", phoenix: "2026-12-31 21:00", manila: "2027-01-01 12:00", tokyo: "2027-01-01 13:00", "sao-paulo": "2027-01-01 01:00", paris: "2027-01-01 05:00", mumbai: "2027-01-01 09:30" } },
  kolkataSrc: { utc: "2027-06-15T16:00:00.000Z" },
};
const fixture = (over = {}) => {
  const p = G.newPackage();
  p.game = { ...p.game, opponent: "Example Club", matchup: "home", date: "2027-02-10", time12: { hour: "7", minute: "00", ampm: "PM" }, sourceZoneId: "America/Los_Angeles", ...over };
  return p;
};
const wallStr = (ms, zone) => {
  const w = G.wallAt(ms, zone);
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
};

test("blank initial state: no game, Unspecified matchup, no source zone, six default cities", () => {
  const p = G.newPackage();
  assert.equal(p.game.opponent, "");
  assert.equal(p.game.date, "");
  assert.equal(p.game.sourceZoneId, "");
  assert.equal(p.game.matchup, "unspecified");
  assert.equal(p.verificationStatus, "user_entered_unverified");
  assert.deepEqual(p.selectedCityIds, ["san-francisco", "phoenix", "manila", "tokyo", "sao-paulo", "paris"]);
  assert.equal(G.computeBoard(p, "Intl").status, "incomplete");
});

test("AT-01: Example Club 2027-02-10 7:00 PM San Francisco -> all cities match zoneinfo oracle (Intl path)", () => {
  const p = fixture();
  p.selectedCityIds = G.CITIES.map((c) => c.id);
  const b = G.computeBoard(p, "Intl");
  assert.equal(b.status, "ok");
  assert.equal(b.resolvedInstantUtc, ORACLE.at01.utc);
  const ms = Date.parse(b.resolvedInstantUtc);
  for (const c of G.CITIES) assert.equal(wallStr(ms, c.zone), ORACLE.at01.wall[c.id], c.id);
  const by = Object.fromEntries(b.cities.map((c) => [c.id, c]));
  assert.equal(by.manila.time, "11:00 AM");
  assert.equal(by.manila.dateLabel, "Thursday, Feb 11");
  assert.equal(by.manila.offsetText, "+1 day");
  assert.equal(by.mumbai.time, "8:30 AM");
  assert.equal(by["sao-paulo"].time, "12:00 AM");
  assert.equal(by["san-francisco"].offsetText, "");
  assert.equal(b.source.dateLong, "Wednesday, February 10, 2027");
  assert.equal(b.source.dateShort, "Wednesday, Feb 10, 2027");
});

test("AT-02: spring-forward gap blocks (LA and Paris)", () => {
  assert.equal(G.computeBoard(fixture({ date: "2026-03-08", time12: { hour: "2", minute: "30", ampm: "AM" } }), "Intl").status, "gap");
  assert.equal(G.resolveIntl({ y: 2027, m: 3, d: 28, h: 2, mi: 30 }, "Europe/Paris").status, "gap");
});

test("AT-03: fall-back ambiguity requires earlier/later; both match oracle", () => {
  const p = fixture({ date: "2026-11-01", time12: { hour: "1", minute: "30", ampm: "AM" } });
  const b = G.computeBoard(p, "Intl");
  assert.equal(b.status, "ambiguous");
  assert.deepEqual(b.candidates.map((c) => c.offsetMin), [-420, -480]);
  p.game.dstDisambiguation = "earlier";
  assert.equal(G.computeBoard(p, "Intl").resolvedInstantUtc, "2026-11-01T08:30:00.000Z");
  p.game.dstDisambiguation = "later";
  assert.equal(G.computeBoard(p, "Intl").resolvedInstantUtc, "2026-11-01T09:30:00.000Z");
  assert.equal(G.resolveIntl({ y: 2027, m: 4, d: 4, h: 2, mi: 30 }, "Australia/Sydney").status, "ambiguous");
});

test("half-hour source zone (Mumbai) resolves per oracle", () => {
  const r = G.resolveIntl({ y: 2027, m: 6, d: 15, h: 21, mi: 30 }, "Asia/Kolkata");
  assert.equal(new Date(r.ms).toISOString(), ORACLE.kolkataSrc.utc);
});

test("AT-11: year-boundary rollover shows 2027 on next-year cities", () => {
  const p = fixture({ date: "2026-12-31", time12: { hour: "8", minute: "00", ampm: "PM" } });
  p.selectedCityIds.push("mumbai");
  const b = G.computeBoard(p, "Intl");
  assert.equal(b.resolvedInstantUtc, ORACLE.at11.utc);
  const by = Object.fromEntries(b.cities.map((c) => [c.id, c]));
  assert.equal(by.manila.dateLabel, "Friday, Jan 1, 2027");
  assert.equal(by.manila.offsetText, "+1 day");
  assert.equal(by["san-francisco"].dateLabel, "Thursday, Dec 31");
  assert.equal(by.phoenix.time, "9:00 PM");
  for (const c of b.cities) assert.equal(wallStr(Date.parse(b.resolvedInstantUtc), G.cityById(c.id).zone), ORACLE.at11.wall[c.id]);
});

test("AT-12: invalid civil dates rejected (no overflow), leap years correct", () => {
  for (const d of ["2027-02-29", "2027-02-31", "2026-04-31", "2026-13-01", "2026-1-5", "2100-02-29"]) assert.equal(G.parseCivilDate(d), null, d);
  assert.ok(G.parseCivilDate("2028-02-29"));
  assert.ok(G.parseCivilDate("2000-02-29"));
  assert.equal(G.computeBoard(fixture({ date: "2027-02-31" }), "Intl").status, "incomplete");
});

test("ED-10: incomplete tipoff ('8' without AM/PM) does not populate a board", () => {
  const b = G.computeBoard(fixture({ time12: { hour: "8", minute: "", ampm: "" } }), "Intl");
  assert.equal(b.status, "incomplete");
  assert.ok(b.problems.some((x) => /minutes|AM or PM/.test(x)));
  assert.equal(G.computeBoard(fixture({ time12: { hour: "8", minute: "00", ampm: "" } }), "Intl").status, "incomplete");
  assert.equal(G.computeBoard(fixture({ timeMode: "24h", time24: "20:00" }), "Intl").source.time, "8:00 PM");
});

test("ED-01/ED-02: explicit matchup; venue never changes symbol", () => {
  for (const [m, g, x] of [["home", "WARRIORS vs. EXAMPLE CLUB", "Warriors vs. Example Club"], ["away", "WARRIORS @ EXAMPLE CLUB", "Warriors at Example Club"], ["unspecified", "WARRIORS • EXAMPLE CLUB", "Warriors • Example Club"]]) {
    assert.equal(G.matchupGraphic(m, "Example Club"), g);
    assert.equal(G.matchupCaption(m, "Example Club"), x);
  }
  const b = G.computeBoard(fixture({ matchup: "unspecified", venue: "Example Arena" }), "Intl");
  assert.equal(G.snapshotOf(b).matchupLine, "WARRIORS • EXAMPLE CLUB");
  assert.match(G.templateX(b), /^Warriors • Example Club\n/);
});

test("ED-03/04/05: templates — X has no city list; IG lists cities; no abbreviations, IANA, hashtags, relative days", () => {
  const p = fixture({ venue: "Example Arena" });
  p.selectedCityIds.push("mumbai");
  const b = G.computeBoard(p, "Intl");
  const x = G.templateX(b);
  const ig = G.templateIG(b);
  assert.equal(x, "Warriors vs. Example Club\nWednesday, Feb 10, 2027 · 7:00 PM in San Francisco\nat Example Arena");
  assert.ok(!x.includes("Manila") && !x.includes("Tokyo"));
  assert.match(ig, /Local tipoff times\nSan Francisco — 7:00 PM, Wednesday, Feb 10\nPhoenix — 8:00 PM, Wednesday, Feb 10\nManila — 11:00 AM, Thursday, Feb 11 · \+1 day/);
  assert.match(ig, /Mumbai — 8:30 AM, Thursday, Feb 11 · \+1 day$/);
  for (const t of [x, ig]) {
    assert.deepEqual(G.lintCaption(t, "x" === t ? "x" : "ig", b), []);
    assert.doesNotMatch(t, /America\/|Asia\/|UTC|PST|PHT|JST|CET|MST|#|tonight|today|tomorrow/i);
  }
  assert.deepEqual(G.lintCaption(x, "x", b), []);
  const bad = "Who's up? #DubNation tonight 7 PM PST America/Los_Angeles UTC-08:00 https://x.co";
  assert.equal(G.lintCaption(bad, "x", b).length, 7);
});

test("AI time check flags times not on the deterministic board", () => {
  const b = G.computeBoard(fixture(), "Intl");
  assert.deepEqual(G.aiTimeMismatches("Manila 11:00 AM, Tokyo 1:00 PM", b), ["1:00 PM"]);
  assert.deepEqual(G.aiTimeMismatches(G.templateIG(b), b), []);
  assert.throws(() => G.validateCaptionReply({ x: "a" }));
  const prompt = G.captionPrompt(b);
  assert.ok(prompt.includes("Example Club") && !prompt.includes("excerpt"));
});

test("AT-05: SVG escapes hostile text; graphic carries no forbidden terms", () => {
  const p = fixture({ opponent: "<img src=x onerror=alert(1)>", venue: '"><script>alert(1)</script>' });
  const b = G.computeBoard(p, "Intl");
  const svg = G.renderSvg(G.layoutCard(G.snapshotOf(b), (t, s) => t.length * s * 0.6));
  assert.ok(!svg.includes("<img") && !svg.includes("<script") && !svg.includes("foreignObject"));
  assert.ok(svg.includes("&lt;IMG SRC=X") && svg.includes("ONERROR=ALERT(1)&gt;"));
  assert.ok(svg.includes("&quot;&gt;&lt;script&gt;"));
  assert.ok(svg.includes("Times from manually entered schedule"));
  for (const term of ["America/", "UTC", "PST", "untrusted", "schema", "inputRevision", "User-entered", "DST", "sandbox"]) assert.ok(!svg.includes(term), term);
});

test("graphic layout: 2 columns only at 8+ cities; long opponent wraps instead of truncating", () => {
  const m = (t, s) => t.length * s * 0.62;
  const p = fixture({ opponent: "An Extremely Long Fictional Opponent Name For Wrapping Tests" });
  const b6 = G.computeBoard(p, "Intl");
  const ops6 = G.layoutCard(G.snapshotOf(b6), m);
  const xs6 = new Set(ops6.filter((o) => o.t === "text" && o.color === G.COLORS.white && o.align === "left").map((o) => o.x));
  assert.equal(xs6.size, 1);
  const joined = ops6.filter((o) => o.t === "text" && o.weight === 800).map((o) => o.text).join(" ");
  assert.equal(joined, "WARRIORS vs. AN EXTREMELY LONG FICTIONAL OPPONENT NAME FOR WRAPPING TESTS");
  p.selectedCityIds = G.CITIES.slice(0, 8).map((c) => c.id);
  const ops8 = G.layoutCard(G.snapshotOf(G.computeBoard(p, "Intl")), m);
  assert.equal(new Set(ops8.filter((o) => o.t === "text" && o.align === "left" && o.weight === 600).map((o) => o.x)).size, 2);
  assert.ok(ops8.every((o) => o.t !== "text" || (o.y > 0 && o.y < G.CARD.h)));
});

test("AT-06: import rejects bad URL, malformed JSON, unknown keys/zones, proto keys, >1MB; valid import recomputes instant", () => {
  const p = fixture();
  p.resolvedInstantUtc = "1999-01-01T00:00:00.000Z"; // tampered derived value
  const good = G.backupJson([p]);
  const r = G.validateImport(good);
  assert.ok(r.ok, r.error);
  assert.equal(r.packages[0].resolvedInstantUtc, ORACLE.at01.utc);
  const mutate = (fn) => { const d = JSON.parse(good); fn(d); return G.validateImport(JSON.stringify(d)); };
  assert.match(mutate((d) => (d.packages[0].game.referenceUrl = "javascript:alert(1)")).error, /http/);
  assert.match(mutate((d) => (d.packages[0].game.sourceZoneId = "Mars/Olympus")).error, /curated/);
  assert.match(mutate((d) => (d.packages[0].game.sourceZoneId = "Europe/Berlin")).error, /curated/);
  assert.match(mutate((d) => (d.packages[0].extra = 1)).error, /unknown key/);
  assert.match(mutate((d) => (d.schemaVersion = 2)).error, /schemaVersion/);
  assert.match(mutate((d) => (d.packages[0].game.date = "2027-02-31")).error, /calendar/);
  assert.match(mutate((d) => (d.packages[0].selectedCityIds = ["berlin"])).error, /city/);
  assert.match(G.validateImport("{oops").error, /Not valid JSON/);
  assert.match(G.validateImport(good.replace('"app"', '"__proto__": {"x":1}, "app"')).error, /forbidden/);
  assert.match(G.validateImport(" ".repeat(1024 * 1024 + 1)).error, /1 MB/);
  assert.equal({}.x, undefined);
});

test("URL safety and 12h validation", () => {
  assert.equal(G.safeHttpUrl("javascript:alert(1)").ok, false);
  assert.equal(G.safeHttpUrl("data:text/html,x").ok, false);
  assert.equal(G.safeHttpUrl("https://example.com/schedule").ok, true);
  assert.deepEqual(G.parseTime({ timeMode: "12h", time12: { hour: "12", minute: "00", ampm: "AM" } }), { h: 0, mi: 0 });
  assert.deepEqual(G.parseTime({ timeMode: "12h", time12: { hour: "12", minute: "30", ampm: "PM" } }), { h: 12, mi: 30 });
});
