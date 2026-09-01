"""Do the numbers in the fixture manifest still describe the bytes on disk?

WHY THIS EXISTS SEPARATELY FROM THE TEST SUITES. `tests/direct/` and `tests/archive-*.test.mjs`
read the manifest's declared values and assert the contract agrees with them. That makes the
manifest the reference, and a reference nobody checks is a place where a wrong number lives
forever: if `decoded_bytes` were edited to match a broken decoder, every test would go green and
the suite would be measuring the decoder against itself. This script checks the manifest against
the bytes instead, so the two directions are independent.

IT SHARES NO CODE WITH WHAT IT CHECKS. Every length, magic number, digest and hash below is
recomputed with the standard library only: `gzip`, `zlib`, `hashlib`, `base64`, `json`,
`datetime`. It does not import the contract, the spliced archive module, or the test helpers. The
one thing it does read out of `contracts/Holdfast.py` is the numeric caps, by regex, because a cap
restated here would be a second place to keep the same number in step.

WHAT IT DELIBERATELY DOES NOT CHECK. Gate outcomes, text extraction and classifications. Those
need the module under test, so checking them here would be the circularity this file exists to
avoid; they belong to `tests/direct/`. This script's whole claim is narrower and mechanical: the
payloads are the payloads that were measured, and the measurements were not typed twice.

THE OVERSIZE PAYLOAD IS COUNTED, NEVER PRINTED. `snap-gcp-deprecation-oversize.bin` is 2,044,592
bytes and exists only to be refused by a cap. It is read, measured, and discarded.
"""

from __future__ import annotations

import base64
import binascii
import datetime as dt
import gzip
import hashlib
import json
import re
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "holdfast"
CONTRACT = ROOT / "contracts" / "Holdfast.py"

STAMP_IN_URL = re.compile(r"/web/(\d{14})id_/")

failures: list[str] = []
checks = 0


def check(ok: bool, label: str, detail: str = "") -> bool:
    """Record one assertion. Returns the result so a caller can skip dependent work."""
    global checks
    checks += 1
    if not ok:
        failures.append("%s%s" % (label, (": " + detail) if detail else ""))
    return ok


def cap(name: str, source: str) -> int:
    """Read one module constant out of the contract rather than restating it here."""
    found = re.search(r"^%s = ([0-9_]+)" % re.escape(name), source, re.M)
    assert found, "%s is not a module constant in %s" % (name, CONTRACT.name)
    return int(found.group(1).replace("_", ""))


def cdx_digest(payload: bytes) -> str:
    """base32(sha1(payload)), the CDX `digest` column. The definition, in one line."""
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii")


def decode(payload: bytes) -> tuple[bytes, str]:
    """Decompress if the magic says gzip, otherwise pass through.

    Tolerant of a truncated member on purpose, because a fixture that stops mid-stream is a real
    thing the archive serves and the point of measuring it is to know how much came out. stdlib
    `gzip.decompress` raises on a short member, so the fallback finishes the job with a raw
    `decompressobj` and reports what it got.
    """
    if payload[:2] != b"\x1f\x8b":
        return payload, "identity"
    try:
        return gzip.decompress(payload), "gzip"
    except (EOFError, zlib.error, binascii.Error):
        return zlib.decompressobj(31).decompress(payload), "gzip-truncated"


source = CONTRACT.read_text(encoding="utf-8")
CDX_WARC_LENGTH_MAX = cap("CDX_WARC_LENGTH_MAX", source)
RAW_MAX_BYTES = cap("RAW_MAX_BYTES", source)
DECODED_MAX_BYTES = cap("DECODED_MAX_BYTES", source)
expansion = re.search(r"^CDX_WORST_OBSERVED_EXPANSION = ([0-9.]+)", source, re.M)
assert expansion, "CDX_WORST_OBSERVED_EXPANSION is not a module constant"
CDX_WORST_OBSERVED_EXPANSION = float(expansion.group(1))

manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
routes = manifest["routes"]

print("fixtures      ", FIXTURES)
print("routes         %d" % len(routes))
print("caps read from %s: warc %d, raw %d, decoded %d, worst expansion %.2fx"
      % (CONTRACT.name, CDX_WARC_LENGTH_MAX, RAW_MAX_BYTES, DECODED_MAX_BYTES,
         CDX_WORST_OBSERVED_EXPANSION))

# ---------------------------------------------------------------- pass 1: the CDX indexes
#
# Parsed as plain JSON and walked as lists of strings. A CDX response is a header row followed by
# one row per change point, so every count the manifest declares about a window is a length or an
# index into that list and needs nothing but `json`.

cdx_rows: dict[str, list[list[str]]] = {}
encodings: dict[str, str] = {}
ratios: list[tuple[str, str, int, int, float]] = []

print("\n== indexes ==")
for route in routes:
    body = route.get("body")
    if not body or not body.endswith(".json"):
        continue
    name = route["name"]
    payload = json.loads((FIXTURES / body).read_text(encoding="utf-8"))
    check(bool(payload) and payload[0][0] == "timestamp",
          "%s: first row is the header" % name, repr(payload[:1])[:120])
    rows = payload[1:]
    cdx_rows[name] = rows

    capture = route.get("capture", {})
    expect = route.get("expect", {})
    declared_bytes = capture.get("captured_bytes")
    actual_bytes = (FIXTURES / body).stat().st_size
    if declared_bytes is not None:
        check(declared_bytes == actual_bytes, "%s: captured_bytes" % name,
              "manifest %d, on disk %d" % (declared_bytes, actual_bytes))
    declared_points = capture.get("captured_change_points")
    if declared_points is not None:
        check(declared_points == len(rows), "%s: captured_change_points" % name,
              "manifest %d, in file %d" % (declared_points, len(rows)))

    stamps = [row[0] for row in rows]
    check(len(stamps) == len(set(stamps)), "%s: timestamps are unique" % name)
    check(stamps == sorted(stamps), "%s: rows are oldest first" % name)

    # `contains_timestamp` is a LIST. The one index that carries two entries is the deprecation
    # page's, whose two pinned captures are the baseline and the change point a breach cites, so
    # the declared row numbers are positional: entry 0 against `pin_at_row`, entry 1 against
    # `second_pin_at_row`.
    pins = expect.get("contains_timestamp") or []
    declared_at = [capture.get("captured_pin_row"), capture.get("captured_second_pin_row")]
    expected_at = [expect.get("pin_at_row"), expect.get("second_pin_at_row")]
    for position, pin in enumerate(pins):
        if not check(pin in stamps, "%s: contains_timestamp %s" % (name, pin)):
            continue
        at = stamps.index(pin)
        for label, declared in (("captured", declared_at[position] if position < 2 else None),
                                ("expect", expected_at[position] if position < 2 else None)):
            if declared is not None:
                check(at == declared, "%s: %s row for pin %d" % (name, label, position),
                      "manifest %d, in file %d" % (declared, at))
    check(len(pins) == len([x for x in expected_at if x is not None]),
          "%s: every pin has a declared row" % name,
          "%d pins, %d declared rows" % (len(pins), len([x for x in expected_at if x is not None])))

    # `saturated` means the window came back exactly as long as the row limit that was asked for,
    # which is the only signal the archive gives that there is more history past the end.
    limit = re.search(r"limit=(\d+)", capture.get("query", "") or "")
    if capture.get("captured_saturated") is not None and limit:
        asked = int(limit.group(1))
        check(capture["captured_saturated"] == (len(rows) == asked),
              "%s: captured_saturated" % name,
              "manifest %s, rows %d, limit %d"
              % (capture["captured_saturated"], len(rows), asked))

    print("  %-24s rows %3d  bytes %6d  pins %s"
          % (name, len(rows), actual_bytes, ",".join(pins) if pins else "-"))

# ---------------------------------------------------------------- pass 2: the payloads
#
# Every declared length is recomputed, and the two content hashes the manifest carries are
# recomputed too. `decoded_bytes` is the one that matters most: it is the number a build that
# skipped decompression could not produce.

print("\n== payloads ==")
for route in routes:
    body = route.get("body")
    if not body or body.endswith(".json"):
        continue
    name = route["name"]
    expect = route.get("expect", {})
    payload = (FIXTURES / body).read_bytes()
    raw_len = len(payload)

    for key, declared in (("captured_raw_bytes", route.get("captured_raw_bytes")),
                          ("expect.raw_bytes", expect.get("raw_bytes"))):
        if declared is not None:
            check(declared == raw_len, "%s: %s" % (name, key),
                  "manifest %d, on disk %d" % (declared, raw_len))

    magic = payload[:2].hex()
    if expect.get("magic"):
        check(magic == expect["magic"], "%s: magic" % name,
              "manifest %s, on disk %s" % (expect["magic"], magic))

    decoded, how = decode(payload)
    encodings[name] = how
    if expect.get("decoded_bytes") is not None:
        check(len(decoded) == expect["decoded_bytes"], "%s: decoded_bytes" % name,
              "manifest %d, decoded %d (%s)" % (expect["decoded_bytes"], len(decoded), how))

    # An identity payload must decode to itself byte for byte, not merely to the same length.
    # That is what makes the decode branch a branch: five of these are gzip and two are not.
    if magic != "1f8b":
        check(decoded == payload, "%s: identity payload passes through unchanged" % name)

    if expect.get("sha256_raw"):
        actual = hashlib.sha256(payload).hexdigest()
        check(actual == expect["sha256_raw"], "%s: sha256_raw" % name,
              "manifest %s, computed %s" % (expect["sha256_raw"][:16], actual[:16]))
    if expect.get("cdx_digest"):
        actual = cdx_digest(payload)
        check(actual == expect["cdx_digest"], "%s: cdx_digest" % name,
              "manifest %s, computed %s" % (expect["cdx_digest"], actual))

    check(raw_len <= RAW_MAX_BYTES or expect.get("accepted") is not True,
          "%s: a payload declared accepted is inside the raw cap" % name)

    print("  %-30s raw %8d  %-15s decoded %8d  digest %s"
          % (name, raw_len, how, len(decoded), cdx_digest(payload)))

# ------------------------------------------- pass 3: does each payload match its own index row?
#
# The strongest check here, and the one no single file can pass on its own. The archive's digest
# column is derived from the archived bytes, so a snapshot fixture and the index fixture that
# lists it agree only if both came off the live archive unmodified. Each snapshot's timestamp is
# taken from its own URL and looked up across every index, so the pairing is discovered rather
# than written down and cannot go stale when a route is renamed.

print("\n== payload against index ==")
for route in routes:
    body = route.get("body")
    if not body or body.endswith(".json"):
        continue
    name = route["name"]
    found = STAMP_IN_URL.search(route["url"])
    if not found:
        continue
    stamp = found.group(1)
    payload = (FIXTURES / body).read_bytes()
    digest = cdx_digest(payload)

    hits = [(index_name, row) for index_name, rows in cdx_rows.items()
            for row in rows if row[0] == stamp]
    if route.get("synthetic"):
        # A derived payload must NOT agree with the real index row for the timestamp it borrows.
        # If it did, it would be the real capture and there would be no negative gate fixture.
        agrees = [n for n, row in hits if row[1] == digest]
        check(not agrees, "%s: synthetic payload must not match a real index row" % name,
              ", ".join(agrees))
        print("  %-30s SYNTHETIC, does not match %d row(s) at %s"
              % (name, len(hits), stamp))
        continue
    if not hits:
        print("  %-30s no index row at %s (nothing to cross-check)" % (name, stamp))
        continue
    for index_name, row in hits:
        ok = check(row[1] == digest, "%s: digest disagrees with %s" % (name, index_name),
                   "index %s, payload %s" % (row[1], digest))
        note = "agrees" if ok else "DISAGREES"
        print("  %-30s %s with %s at %s" % (name, note, index_name, stamp))
        # The length column is the archive's own claim about the payload, and the whole reason the
        # length cap cannot pre-flight a size gate is that this claim is sometimes far too small.
        if len(row) > 2 and row[2].isdigit():
            declared = int(row[2])
            if declared and declared != len(payload):
                ratios.append((name, encodings.get(name, "?"), declared, len(payload),
                               len(payload) / declared))
                print("      index length %d, payload %d, ratio %.2fx"
                      % (declared, len(payload), len(payload) / declared))

# -------------------------------------------------- pass 4: the three claims made in prose
#
# Each of these is a sentence in the manifest or in `06-holdfast.md` that carries a number. A
# claim with a number in it can be checked, so it is checked.

print("\n== claims that carry a number ==")

# WHAT THE `length` COLUMN ACTUALLY IS, measured rather than assumed. Across all seven payloads
# that appear in an index, the ratio of real payload to declared length splits perfectly on the
# content encoding: every gzip payload comes in slightly UNDER its declared length, and both
# identity payloads come in far over it. That is the signature of a WARC record length, which is
# the size of the record as stored and therefore already compressed at the WARC layer. A payload
# that arrived compressed cannot be compressed much again, so length tracks it; a payload that
# arrived as plain HTML compresses well, so length understates it by whatever HTML happens to
# compress by. This is the real reason the length column cannot pre-flight a size cap, and it is
# stronger than calling the column unreliable: it is reliable, it just measures something else.
for name, how, declared, actual, ratio in ratios:
    if how.startswith("gzip"):
        check(ratio < 1.0, "%s: a gzip payload should not exceed its declared length" % name,
              "%.2fx" % ratio)
    else:
        check(ratio > 1.0, "%s: an identity payload should exceed its declared length" % name,
              "%.2fx" % ratio)
gzip_ratios = [r for _n, how, _d, _a, r in ratios if how.startswith("gzip")]
identity_ratios = [r for _n, how, _d, _a, r in ratios if not how.startswith("gzip")]
check(bool(gzip_ratios) and bool(identity_ratios),
      "the ratio split has examples on both sides",
      "%d gzip, %d identity" % (len(gzip_ratios), len(identity_ratios)))
if gzip_ratios and identity_ratios:
    check(max(gzip_ratios) < min(identity_ratios),
          "the two groups do not overlap",
          "gzip max %.2fx, identity min %.2fx" % (max(gzip_ratios), min(identity_ratios)))
    print("  index length is a WARC record length: %d gzip payloads run %.2fx to %.2fx of it,"
          % (len(gzip_ratios), min(gzip_ratios), max(gzip_ratios)))
    print("  %d identity payloads run %.2fx to %.2fx. No overlap, so the column tracks stored"
          % (len(identity_ratios), min(identity_ratios), max(identity_ratios)))
    print("  size and not payload size, and only looks trustworthy on already-compressed captures.")

oversize = next(r for r in routes if r["name"] == "snap-gcp-deprecation-oversize")
declared_length = oversize["expect"]["cdx_length"]
oversize_bytes = (FIXTURES / oversize["body"]).stat().st_size
ratio = oversize_bytes / declared_length
check(round(ratio, 2) == CDX_WORST_OBSERVED_EXPANSION,
      "CDX_WORST_OBSERVED_EXPANSION matches the payload it was measured from",
      "constant %.2f, measured %.4f" % (CDX_WORST_OBSERVED_EXPANSION, ratio))
print("  worst observed expansion  %d / %d = %.4fx, constant says %.2fx"
      % (oversize_bytes, declared_length, ratio, CDX_WORST_OBSERVED_EXPANSION))

over_by = declared_length / CDX_WARC_LENGTH_MAX - 1
check(declared_length > CDX_WARC_LENGTH_MAX,
      "the oversize capture's index length exceeds the warc cap")
check(oversize_bytes <= RAW_MAX_BYTES,
      "the oversize capture's real payload is inside the raw cap")
print("  index length clears the warc cap by %.1f%% (%d against %d), while the real payload is"
      % (over_by * 100, declared_length, CDX_WARC_LENGTH_MAX))
print("  %.1f%% UNDER the raw cap (%d against %d). That gap is why length cannot pre-flight size."
      % ((1 - oversize_bytes / RAW_MAX_BYTES) * 100, oversize_bytes, RAW_MAX_BYTES))

never = next(r for r in routes if r["name"] == "cdx-never-archived")
body_bytes = never["text"].encode("utf-8")
check(int(never["status"]) == 200 and len(body_bytes) == 3,
      "the never-archived route is 200 with a 3-byte body",
      "status %s, %d bytes" % (never["status"], len(body_bytes)))
check(json.loads(never["text"]) == [],
      "the never-archived body parses as an empty index")
print("  never archived            HTTP %s with %d bytes, parses to an empty list"
      % (never["status"], len(body_bytes)))

inexact = next(r for r in routes if r["name"] == "snap-inexact-timestamp")
asked = STAMP_IN_URL.search(inexact["url"]).group(1)
offered = STAMP_IN_URL.search(inexact["headers"]["location"]).group(1)
fmt = "%Y%m%d%H%M%S"
delta = dt.datetime.strptime(asked, fmt) - dt.datetime.strptime(offered, fmt)
check(int(inexact["status"]) == 302, "the inexact route is a redirect")
check(delta == dt.timedelta(seconds=1),
      "the substituted snapshot is exactly one second off", str(delta))
check(asked != offered, "the redirect target is a different capture")
print("  inexact timestamp         asked %s, offered %s, %s apart"
      % (asked, offered, delta))

# ---------------------------------------------------------------------------------- the verdict

print("\n%d checks" % checks)
if failures:
    print("FAILED %d:" % len(failures))
    for line in failures:
        print("  " + line)
    sys.exit(1)
print("every declared number in the manifest matches the bytes on disk")
