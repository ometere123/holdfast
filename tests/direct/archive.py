"""The captured Wayback responses, served to the contract under the real SDK.

WHY THE BYTES ARE ON DISK. Every payload in `tests/fixtures/holdfast/` came off the live archive
while the decoding path was being built, and six of the eight are gzip members. That is the whole
subject of this project: Wayback's `id_` replay hands back the archived bytes verbatim, so a page
served compressed in 2019 replays as compressed in 2026, and those compressed bytes are identical
for every validator. A synthesised body would be plain text and would therefore pass a pipeline
that skips decompression, which is exactly the bug these fixtures exist to make impossible to
reintroduce. Nothing here is generated.

THE FIRST MATCH WINS, SO EVERY REGISTRATION CLEARS THE TABLE. `direct_vm._match_web_mock` returns
the first pattern that matches, so registering a second answer for a URL already mocked is silently
ignored: the contract keeps reading the first one. A check that walks two change points, or a
settlement that re-verifies two captures, would then read one capture twice and pass for the wrong
reason. `Archive.serve()` clears the mock table on every call so that mistake is unavailable.

WHAT THE CDX PATTERNS MATCH ON, AND WHY NOT THE WHOLE URL. `cdx_query_url` fixes its parameter
order so two validators build one string, but the order is the contract's business and not this
module's. Matching on two order-independent lookaheads, the target page and the `from=` anchor,
means a test fails when the contract queries the wrong page or the wrong window, and does not fail
when the contract reorders its own query string.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "holdfast"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))

ROUTES = {route["name"]: route for route in MANIFEST["routes"]}

#: The payload that is deliberately never loaded into a reader's context or a test's assertion
#: message. It is 2,044,592 bytes on disk and its only job is to be refused by the raw cap, so the
#: test that uses it checks the refusal and never the contents.
OVERSIZE_ROUTE = "snap-gcp-deprecation-oversize"

_RAW_CACHE: dict[str, bytes] = {}


def raw(route_name: str) -> bytes:
    """The captured bytes for a route, read once and cached for the session."""
    route = ROUTES[route_name]
    body = route.get("body")
    assert body, f"{route_name} has no body file; it is served inline"
    if body not in _RAW_CACHE:
        _RAW_CACHE[body] = (FIXTURES / body).read_bytes()
    return _RAW_CACHE[body]


def expectation(route_name: str) -> dict:
    """What was measured off this route when it was captured.

    Read rather than restated for the same reason the constants are: a decoded byte count typed a
    second time into a test proves only that it was typed twice.
    """
    return ROUTES[route_name].get("expect", {})


def _snapshot_pattern(url: str) -> str:
    """An exact-URL pattern, anchored at both ends.

    Anchored because `.../terms` is a prefix of `.../terms/deprecation`, so an unanchored pattern
    for the terms page would answer a deprecation-page request with the terms bytes and the test
    would report a digest mismatch that has nothing to do with the contract.
    """
    return "^" + re.escape(url) + "$"


def cdx_digest(raw: bytes) -> str:
    """base32(sha1(raw)), the CDX `digest` column, recomputed here from the bytes on disk.

    Reimplemented rather than imported because the contract's copy of it lives inside the spliced
    region and this module deliberately does not import the contract. It is one line and it is the
    definition, so a divergence would mean one of the two stopped being base32 of sha1, which the
    offline archive suite would catch first.

    IT MUST BE COMPUTED, NEVER TYPED. A synthetic CDX row whose digest was written by hand would
    make `verify_digest` fail with `[TRANSIENT]`, and the test would report a mismatch that says
    nothing about the contract. Computing it from the same bytes the mock will serve is what makes
    the index and the payload agree the way the real archive's do.
    """
    return base64.b32encode(hashlib.sha1(raw).digest()).decode("ascii")


def snapshot_url(stamp: str, target: str) -> str:
    """The `id_` replay URL for one capture, matching what `snapshot_url` in the contract builds.

    `id_` is the whole subject of this project: it is the modifier that makes Wayback replay the
    archived bytes verbatim, headers and content-encoding included, rather than rewriting the page
    for a browser. Drop it and every validator gets a rewritten document with the archive's own
    toolbar injected into it.
    """
    return "https://web.archive.org/web/%sid_/%s" % (stamp, target)


def _cdx_pattern(target: str, anchor: str) -> str:
    """Two order-independent lookaheads: the page, and the window's `from=` anchor.

    The target goes in with its slashes intact. `_percent_encode`'s query-safe set includes `/` and
    `:`, so the contract emits `url=https://cloud.google.com/terms` literally rather than
    percent-encoded, and the captured patterns in the manifest match on the literal form for the same
    reason. Escaping the slashes here produced a pattern that could never match any URL the contract
    builds, so every synthetic index went unserved.
    """
    return (r"^https://web\.archive\.org/cdx/search/cdx\?(?=.*"
            + re.escape(target.replace("https://", "").split("?")[0])
            + r")(?=.*from=" + re.escape(anchor) + r")")


class Archive:
    """Registers captured routes as web mocks, clearing the table each time.

    Deliberately not a fixture that serves everything. A test names the routes it depends on, so
    the set of captures a behaviour needs is visible at the test rather than global, and a contract
    that starts fetching something new fails with an unmocked-URL error instead of quietly finding
    a body some other test needed.
    """

    def __init__(self, vm):
        self._vm = vm
        self.served: list[str] = []

    def serve(self, *route_names: str) -> "Archive":
        """Replace the whole mock table with these routes, in order."""
        self._vm.clear_mocks()
        self.served = []
        for name in route_names:
            self._register(ROUTES[name])
            self.served.append(name)
        return self

    def _register(self, route: dict) -> None:
        pattern = route.get("pattern") or _snapshot_pattern(route["url"])
        body = raw(route["name"]) if route.get("body") else route.get("text", "")
        headers = route.get("headers")
        if headers:
            # The full mock shape, because the flat one reports no headers at all and the one route
            # that carries a `location` is the whole point of that route.
            self._vm.mock_web(pattern, {
                "method": route.get("method", "GET"),
                "response": {
                    "status": int(route["status"]),
                    "headers": dict(headers),
                    "body": body.encode("utf-8") if isinstance(body, str) else body,
                },
            })
            return
        self._vm.mock_web(pattern, {
            "method": route.get("method", "GET"),
            "status": int(route["status"]),
            "body": body,
        })

    def serve_cdx(self, target: str, anchor: str, rows: list[list[str]]) -> "Archive":
        """Replace the table with one synthetic CDX index for `target`, anchored at `anchor`.

        The only synthesised bodies in this suite, and they are an index rather than a document. A
        CDX response is four fixed columns of digits and base32, so writing one costs nothing in
        fidelity, and the tests that need a specific row count (one change point too few, a window
        that saturates) cannot get one from a real page whose history is whatever it is.
        """
        self._vm.clear_mocks()
        self.served = ["synthetic-cdx"]
        header = [list(("timestamp", "digest", "length", "statuscode"))]
        body = json.dumps(header + [list(row) for row in rows])
        self._vm.mock_web(_cdx_pattern(target, anchor),
                          {"method": "GET", "status": 200, "body": body})
        return self

    def add(self, *route_names: str) -> "Archive":
        """Append routes without clearing, for the two-capture paths.

        Separate from `serve` and used sparingly. Appending is only safe when the added routes
        cannot match a URL an already-registered pattern would match, which for the snapshot routes
        is guaranteed by the anchored exact-URL patterns.
        """
        for name in route_names:
            self._register(ROUTES[name])
            self.served.append(name)
        return self

    def snapshots(self, target: str, rows: list[tuple[str, str]]) -> "Archive":
        """Replay captures at chosen timestamps with NO index at all.

        For `settle_breach`, which re-fetches both cited captures using the digest and index length
        it recorded at claim time and makes no fresh CDX call. Serving no index is how this test
        proves that: if settlement ever started re-querying the index, it would fail here with an
        unmocked-URL error rather than passing on a row a helper happened to leave lying around.
        """
        self._vm.clear_mocks()
        self.served = []
        return self.add_snapshots(target, rows)

    def add_snapshots(self, target: str, rows: list[tuple[str, str]]) -> "Archive":
        """The same registration without clearing, for pairing with a hand-built `serve_cdx` index.

        Two tests need an index row whose length column is not `len(payload)`: the oversize capture's
        real CDX row understates its payload by 7.84x, and that discrepancy is the whole reason the
        length cap cannot be trusted as a size gate. `window` computes its lengths from the bytes, so
        those cases build the index with `serve_cdx` and add the payload here.
        """
        for stamp, route_name in rows:
            self._vm.mock_web(_snapshot_pattern(snapshot_url(stamp, target)), {
                "method": "GET", "status": 200, "body": raw(route_name),
            })
            self.served.append("%s@%s" % (route_name, stamp))
        return self

    def window(self, target: str, rows: list[tuple[str, str]], *, cursor: str = "") -> "Archive":
        """One forward window over `target`, with real captured bytes replayed at chosen timestamps.

        This is what makes the lifecycle testable at all, and it is worth being explicit about what
        is real here and what is not. The timestamps are invented, because a run of two consecutive
        weakened captures followed by a settlement is a sequence no real page's history happens to
        contain on demand. The BYTES ARE NOT INVENTED: every row serves a payload that came off the
        live archive, so the decode, the gates and the text extraction all run over the same evidence
        they run over in the offline suite. A synthesised document would be plain text and would pass
        a pipeline that never learned to decompress anything.

        The digests are computed from those bytes rather than written down, so the index agrees with
        the payload the way the real archive's does. The lengths likewise. That leaves the timestamp
        as the only fabricated column, which is the one column the contract treats as an opaque key.

        `rows` is `[(timestamp, route_name), ...]` oldest first. `from=` is INCLUSIVE in CDX, so the
        cursor's own row comes back in a real response and `check_commitment` filters it out; pass
        `cursor` to have that row included the way the archive would include it.
        """
        self._vm.clear_mocks()
        self.served = ["synthetic-window"]

        table = []
        if cursor:
            # The cursor row carries no payload mock on purpose. The contract must filter it out
            # before fetching anything, so a build that re-examined the cursor fails here with an
            # unmocked-URL error rather than silently paying for a retrieval it already did.
            table.append([cursor, "CURSORROWDIGESTNOTFETCHED0000000", "1000", "200"])
        for stamp, route_name in rows:
            raw_bytes = raw(route_name)
            table.append([stamp, cdx_digest(raw_bytes), str(len(raw_bytes)), "200"])
            self._vm.mock_web(_snapshot_pattern(snapshot_url(stamp, target)), {
                "method": "GET", "status": 200, "body": raw_bytes,
            })
            self.served.append("%s@%s" % (route_name, stamp))

        anchor = cursor or rows[0][0]
        self._vm.mock_web(_cdx_pattern(target, anchor), {
            "method": "GET", "status": 200,
            "body": json.dumps([["timestamp", "digest", "length", "statuscode"]] + table),
        })
        return self


def holds(excerpt: str = "", rationale: str = "the document still makes this commitment") -> str:
    """A HOLDS answer, as the raw JSON string `mock_llm` takes."""
    return json.dumps({"classification": "HOLDS", "excerpt": excerpt, "rationale": rationale})


def finding(classification: str, excerpt: str, rationale: str = "quoted above") -> str:
    """A WEAKENED or ABSENT answer with a quote the contract will try to locate."""
    return json.dumps({"classification": classification, "excerpt": excerpt,
                       "rationale": rationale})


#: The fragment `_judge_block` writes into the prompt for the capture being read, so a test that
#: walks several change points in one call can answer each one differently. First match wins in
#: `_match_llm_mock`, so a per-stamp answer must be registered before any general fallback.
def judged_at(stamp: str) -> str:
    return "taken at " + str(stamp)
