/**
 * The boundary between the invented bonds and the measured captures, enforced from both sides.
 *
 * WHY THIS FILE EXISTS. `archive-evidence.ts` published four byte counts as measurements of named
 * real pages. They had been copied out of `mock-data.ts`, which holds invented bonds, and eighteen
 * tests passed over them because every one of those tests compared the numbers to each other rather
 * than to a capture. `TABLE_CORRECTION` carries that retraction and `archive-evidence.test.mjs` now
 * re-derives its table from the payloads on disk.
 *
 * That closes the leak in one direction. This file closes it in the other. The reason a raw count
 * could be lifted out of `mock-data.ts` and read as a measurement is that the file mixed measured
 * decoded lengths with invented raw lengths and said in its own header that both were measured. So
 * the rule now is: wherever a record in `mock-data.ts` carries a decoded length that a real capture
 * has, it carries that capture's real raw length too. The tests below read the captures off disk and
 * check it, which is the check that was missing.
 *
 * A CONSTRUCTED NUMBER STILL HAS TO BE POSSIBLE. The records that are not tied to a capture are
 * invented on purpose, and the header commits them to landing inside the inflation span the archive
 * actually produces. That is a claim about a range, so it is tested against the range as measured
 * from the same eight files rather than against a range typed into a comment.
 */

import { readFileSync } from "node:fs";
import { gunzipSync, inflateSync } from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";

const MOCK_PATH = new URL("../src/lib/mock-data.ts", import.meta.url);
const MOCK_SOURCE = readFileSync(MOCK_PATH, "utf8");

const FIXTURE_DIR = new URL("../../_build/fixtures/holdfast/", import.meta.url);
const MANIFEST = JSON.parse(readFileSync(new URL("manifest.json", FIXTURE_DIR), "utf8"));

/**
 * Every captured payload on disk, measured. Same three-branch dispatch the contract uses.
 *
 * The `.bin` filter is what separates a capture from an index. Six manifest routes carry a `.json`
 * body, which is a CDX response: four columns of digits and base32, uncompressed, and two of them
 * happen to be exactly the same length. They are not documents and they have no place in a table of
 * inflation ratios.
 */
function measured() {
  const out = [];
  for (const route of MANIFEST.routes) {
    if (!route.body || !route.body.endsWith(".bin")) continue;
    const raw = readFileSync(new URL(route.body, FIXTURE_DIR));
    const magic = raw.subarray(0, 2).toString("hex");
    let encoding = "identity";
    let decoded = raw.length;
    if (magic === "1f8b") {
      encoding = "gzip";
      decoded = gunzipSync(raw).length;
    } else if (raw[0] === 0x78) {
      encoding = "zlib";
      decoded = inflateSync(raw).length;
    }
    out.push({ name: route.name, file: route.body, raw: raw.length, decoded, encoding });
  }
  return out;
}

const CAPTURES = measured();

/** The `Bytes` records in `mock-data.ts`, parsed out of the TypeScript rather than restated. */
function bytesRecords() {
  const found = [];
  const pattern = /const (\w+): Bytes = \{([\s\S]*?)\n\};/g;
  let match = pattern.exec(MOCK_SOURCE);
  while (match) {
    const [, name, body] = match;
    const raw = /rawLen: "(\d+)"/.exec(body);
    const decoded = /decodedLen: (\d+)/.exec(body);
    const encoding = /encoding: "(\w+)"/.exec(body);
    assert.ok(raw && decoded && encoding, `${name} is missing one of rawLen, decodedLen, encoding`);
    found.push({
      name,
      raw: Number(raw[1]),
      decoded: Number(decoded[1]),
      encoding: encoding[1],
    });
    match = pattern.exec(MOCK_SOURCE);
  }
  return found;
}

const RECORDS = bytesRecords();

test("the fixture set and the mock byte records both parsed, so the rest of this file means something", () => {
  assert.equal(CAPTURES.length, 8, "eight payloads are expected on disk");
  assert.ok(RECORDS.length >= 15, `only ${RECORDS.length} Bytes records parsed out of mock-data.ts`);
});

test("a mock record that borrows a real decoded length borrows that capture's raw length too", () => {
  const byDecoded = new Map();
  for (const capture of CAPTURES) {
    // Two captures could in principle decode to the same length. None do, and if two ever did the
    // pairing would be ambiguous and this test should say so rather than pick one.
    assert.ok(!byDecoded.has(capture.decoded), `two captures decode to ${capture.decoded}`);
    byDecoded.set(capture.decoded, capture);
  }

  let tied = 0;
  for (const record of RECORDS) {
    const capture = byDecoded.get(record.decoded);
    if (!capture) continue;
    tied += 1;
    assert.equal(
      record.raw,
      capture.raw,
      `${record.name} decodes to ${record.decoded}, which is ${capture.file}, but reports ` +
        `${record.raw} raw where that file is ${capture.raw} bytes. This is the defect ` +
        `TABLE_CORRECTION was written about: an invented raw count sitting next to a measured ` +
        `decoded one, which reads as a measurement and was cited as one.`,
    );
    assert.equal(record.encoding, capture.encoding, `${record.name} reports the wrong encoding`);
  }
  // Eight records borrow a capture's magnitudes, and two of those share one capture: B1 and B7 both
  // sit on the GitHub terms page. Asserted as a floor rather than an exact count so adding a fixture
  // bond does not fail here, and as a floor above zero so the pairing cannot silently stop happening.
  assert.ok(tied >= 8, `only ${tied} mock records are tied to a capture; the header claims more`);
});

test("no record carries a raw length from one capture and a decoded length from another", () => {
  const byRaw = new Map();
  for (const capture of CAPTURES) {
    if (!byRaw.has(capture.raw)) byRaw.set(capture.raw, []);
    byRaw.get(capture.raw).push(capture);
  }
  for (const record of RECORDS) {
    const candidates = byRaw.get(record.raw);
    if (!candidates) continue;
    assert.ok(
      candidates.some((capture) => capture.decoded === record.decoded),
      `${record.name} reports ${record.raw} raw, which is ${candidates
        .map((capture) => capture.file)
        .join(" or ")}, but decodes to ${record.decoded} rather than ${candidates
        .map((capture) => capture.decoded)
        .join(" or ")}. A crossed pair is how the withdrawn table came to exist.`,
    );
  }
});

test("the five raw counts that were invented are gone from the file entirely", () => {
  // 47,441 and 134,882 and 108,224 and 74,405 were published on the method page as measurements of
  // real pages. 88,117 was not published but was invented the same way. Pinned by value because the
  // pairing tests above only look at records whose decoded length matches a capture, and a sixth
  // invented count could be introduced against a constructed decoded length and go unnoticed.
  for (const wrong of ["47441", "134882", "108224", "74405", "88117"]) {
    assert.ok(
      !MOCK_SOURCE.includes(wrong),
      `${wrong} is back in mock-data.ts; it is not a measurement of anything`,
    );
  }
});

test("the constructed pairs land inside the inflation span the archive actually produces", () => {
  const compressed = CAPTURES.filter((capture) => capture.encoding !== "identity");
  const ratios = compressed.map((capture) => capture.decoded / capture.raw);
  const low = Math.min(...ratios);
  const high = Math.max(...ratios);
  // The header states this span. Read from the files so the two cannot drift.
  assert.ok(low > 4.4 && low < 4.5, `measured floor moved to ${low.toFixed(2)}x`);
  assert.ok(high > 11.4 && high < 11.5, `measured ceiling moved to ${high.toFixed(2)}x`);

  const tiedDecoded = new Set(CAPTURES.map((capture) => capture.decoded));
  for (const record of RECORDS) {
    if (record.encoding === "identity") {
      assert.equal(record.raw, record.decoded, `${record.name} is identity but inflates`);
      continue;
    }
    const ratio = record.decoded / record.raw;
    assert.ok(
      ratio >= low && ratio <= high,
      `${record.name} inflates ${ratio.toFixed(2)}x, outside the measured ${low.toFixed(2)}x to ` +
        `${high.toFixed(2)}x. A fixture that teaches a magnitude the archive never produces is ` +
        `worse than one that teaches none.`,
    );
    if (!tiedDecoded.has(record.decoded)) {
      // A constructed record. It has to be possible, which the assertion above covers, and it has to
      // not be a capture, which is what keeps the two categories separate.
      assert.ok(
        !CAPTURES.some((capture) => capture.raw === record.raw),
        `${record.name} is constructed but reuses a real raw length`,
      );
    }
  }
});

test("mock-data still says in its own header that it is invented and points at the retraction", () => {
  // The header is the only thing standing between these numbers and the next person who needs a
  // byte count. It said the raw counts were measured, and one was copied out on that basis.
  for (const phrase of [
    "are constructed",
    "not measurements",
    "TABLE_CORRECTION",
    "example domain",
  ]) {
    assert.ok(MOCK_SOURCE.includes(phrase), `the header no longer says "${phrase}"`);
  }
});

test("the derived text ratio sits between the only two text counts that were measured", () => {
  const match = /Math\.round\(bytes\.decodedLen \* ([0-9.]+)\)/.exec(MOCK_SOURCE);
  assert.ok(match, "textLenOf no longer derives text_len from decodedLen");
  const ratio = Number(match[1]);
  // 569 characters out of 35,640 bytes for the chrome-only shell, 48,934 out of 372,058 for the
  // decoded GitHub terms page. Both are in the fixture manifest, so both are read from it.
  const shell = MANIFEST.routes.find((route) => route.name === "snap-github-tos-chrome-only");
  const source = MANIFEST.routes.find((route) => route.name === "snap-github-tos-gzip");
  const floor = shell.expect.visible_text_chars / 35640;
  const ceiling = shell.expect.source_visible_text_chars / 372058;
  assert.ok(floor < ratio && ratio < ceiling,
    `${ratio} is outside ${floor.toFixed(4)} to ${ceiling.toFixed(4)}`);
  assert.ok(source, "the capture the ceiling was measured from is gone from the manifest");
});
